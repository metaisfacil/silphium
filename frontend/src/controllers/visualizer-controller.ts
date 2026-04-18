import type { AudioPlaybackState, AudioVisualizationFrame, PlayerEqualizerPosition, PlayerVisualizerMode } from '../types/app-types';
import { runBackgroundBridgeCall, shouldDeferBackgroundBridgeCall } from '../utils/bridge-load-gate';
import { deriveShareImageAccentPalette } from '../utils/cover-accent-palette';

type VisualizerControllerOptions = {
    canvas: HTMLCanvasElement;
    getPlaybackState: () => AudioPlaybackState;
    fetchVisualizationFrame: (frameCount: number) => Promise<AudioVisualizationFrame>;
    getCoverArtImageSource?: () => CanvasImageSource | undefined;
};

type RgbColor = {
    r: number;
    g: number;
    b: number;
};

type VisualizerWasmExports = {
    memory: WebAssembly.Memory;
    max_frames: () => number;
    max_bands?: () => number;
    input_ptr: () => number;
    output_ptr: () => number;
    band_output_ptr?: () => number;
    render_lissajous: (frameCount: number, width: number, height: number, gain: number, scale: number) => number;
    render_equalizer?: (frameCount: number, sampleRate: number, sampleStride: number) => number;
};

const lissajousTargetFrameCount = 192;
const equalizerTargetFrameCount = 320;
const equalizerFallbackBandCount = 40;
const visualizationFetchIntervalMs = 75;
const maxCanvasDevicePixelRatio = 1.5;
const pointSmoothingTimeMs = 72;
const equalizerRiseSmoothingTimeMs = 70;
const equalizerFallSmoothingTimeMs = 188;
const equalizerPeakDropPerMs = 0.00115;
const activeVisualizerClass = 'is-visualizer-active';
const defaultVisualizerMode: PlayerVisualizerMode = 'lissajous';
const defaultEqualizerPosition: PlayerEqualizerPosition = 'bottom';
const minLissajousScale = 0.05;
const maxLissajousScale = 1.0;
const defaultLissajousScale = 0.25;
const wasmUrl = new URL('../assets/wasm/visualizer_bg.wasm', import.meta.url);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const parseHexColor = (value: string): RgbColor | null => {
    const match = /^#([0-9a-fA-F]{6})$/.exec(value.trim());
    if (!match) {
        return null;
    }

    const packed = Number.parseInt(match[1], 16);
    return {
        r: (packed >> 16) & 255,
        g: (packed >> 8) & 255,
        b: packed & 255,
    };
};

const mixRgb = (from: RgbColor, to: RgbColor, ratio: number): RgbColor => {
    const t = clamp(ratio, 0, 1);
    return {
        r: Math.round(from.r + ((to.r - from.r) * t)),
        g: Math.round(from.g + ((to.g - from.g) * t)),
        b: Math.round(from.b + ((to.b - from.b) * t)),
    };
};

const createJsProjection = (samples: number[], frameCount: number, width: number, height: number, gain: number, scale: number): Float32Array => {
    const projected = new Float32Array(frameCount * 2);
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const radius = Math.min(width, height) * 0.34 * gain * clamp(scale, minLissajousScale, maxLissajousScale);
    for (let index = 0; index < frameCount; index += 1) {
        const left = (samples[index * 2] || 0) / 32768;
        const right = (samples[(index * 2) + 1] || 0) / 32768;
        projected[index * 2] = centerX + (left * radius);
        projected[(index * 2) + 1] = centerY - (right * radius);
    }
    return projected;
};

const createWindowedMonoSamples = (samples: number[], frameCount: number): Float32Array => {
    const mono = new Float32Array(frameCount);
    const denominator = frameCount > 1 ? frameCount - 1 : 1;
    for (let index = 0; index < frameCount; index += 1) {
        const left = (samples[index * 2] || 0) / 32768;
        const right = (samples[(index * 2) + 1] || 0) / 32768;
        const window = frameCount > 1
            ? 0.5 - (0.5 * Math.cos((Math.PI * 2 * index) / denominator))
            : 1;
        mono[index] = ((left + right) * 0.5) * window;
    }
    return mono;
};

const goertzelMagnitude = (samples: Float32Array, sampleRate: number, targetFrequency: number): number => {
    if (samples.length < 2 || sampleRate <= 1 || targetFrequency <= 0 || targetFrequency >= sampleRate * 0.5) {
        return 0;
    }

    const omega = (Math.PI * 2 * targetFrequency) / sampleRate;
    const coefficient = 2 * Math.cos(omega);
    let q1 = 0;
    let q2 = 0;

    for (let index = 0; index < samples.length; index += 1) {
        const q0 = (coefficient * q1) - q2 + samples[index];
        q2 = q1;
        q1 = q0;
    }

    const power = Math.max(0, (q1 * q1) + (q2 * q2) - (coefficient * q1 * q2));
    return Math.sqrt(power) / samples.length;
};

const equalizerBandFrequency = (bandIndex: number, bandCount: number, minFrequency: number, maxFrequency: number): number => {
    if (bandCount <= 1 || minFrequency <= 0 || maxFrequency <= minFrequency) {
        return Math.max(1, minFrequency);
    }

    const exponent = bandIndex / (bandCount - 1);
    return minFrequency * ((maxFrequency / minFrequency) ** exponent);
};

const normalizeEqualizerMagnitude = (magnitude: number, bandIndex: number, bandCount: number): number => {
    const highBandEmphasis = bandCount > 1
        ? 1 + ((bandIndex / (bandCount - 1)) * 0.45)
        : 1;
    return clamp(Math.log1p(magnitude * highBandEmphasis * 28) / 3.45, 0, 1);
};

const createJsEqualizerBands = (
    samples: number[],
    frameCount: number,
    sampleRate: number,
    sampleStride: number,
    bandCount: number,
): Float32Array => {
    if (frameCount < 8 || bandCount < 1) {
        return new Float32Array(0);
    }

    const mono = createWindowedMonoSamples(samples, frameCount);
    const effectiveSampleRate = Math.max(64, sampleRate / Math.max(1, sampleStride || 1));
    const nyquist = effectiveSampleRate * 0.5;
    const minFrequency = Math.max(12, Math.min(26, nyquist * 0.14));
    const maxFrequency = Math.max(minFrequency * 2.2, nyquist * 0.975);
    const taps: Array<[number, number]> = [
        [0.78, 0.22],
        [0.92, 0.36],
        [1.0, 0.56],
        [1.08, 0.36],
        [1.24, 0.22],
    ];
    const bands = new Float32Array(bandCount);

    for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
        const centerFrequency = equalizerBandFrequency(bandIndex, bandCount, minFrequency, maxFrequency);
        let weightedMagnitude = 0;
        let totalWeight = 0;
        for (const [ratio, weight] of taps) {
            const frequency = Math.min(maxFrequency, centerFrequency * ratio);
            weightedMagnitude += goertzelMagnitude(mono, effectiveSampleRate, frequency) * weight;
            totalWeight += weight;
        }

        const magnitude = totalWeight > 0 ? weightedMagnitude / totalWeight : 0;
        bands[bandIndex] = normalizeEqualizerMagnitude(magnitude, bandIndex, bandCount);
    }

    return bands;
};

export const createVisualizerController = (options: VisualizerControllerOptions) => {
    const { canvas } = options;
    const context = canvas.getContext('2d');
    let animationFrameId = 0;
    let disposed = false;
    let enabled = true;
    let mode: PlayerVisualizerMode = defaultVisualizerMode;
    let equalizerPosition: PlayerEqualizerPosition = defaultEqualizerPosition;
    let lissajousScale = defaultLissajousScale;
    let fetchInFlight = false;
    let activeFetchRequestId = 0;
    let frameRequestVersion = 0;
    let lastFetchAtMs = 0;
    let lastRenderAtMs = 0;
    let latestFrame: AudioVisualizationFrame | null = null;
    let priorityFetchPending = false;
    let playbackActive = false;
    let activePlaybackSourcePath = '';
    let targetPoints: Float32Array | null = null;
    let renderedPoints: Float32Array | null = null;
    let targetBands: Float32Array | null = null;
    let renderedBands: Float32Array | null = null;
    let peakBands: Float32Array | null = null;
    let targetPeak = 0;
    let renderedPeak = 0;
    let projectedSourcePath = '';
    let projectedWidth = 0;
    let projectedHeight = 0;
    let projectionRevision = 0;
    let wasmReady: Promise<VisualizerWasmExports | null> | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let cachedCoverKey = '';
    let cachedLissajousColor: RgbColor | null = null;

    const syncCanvasSize = (): boolean => {
        const bounds = canvas.getBoundingClientRect();
        const devicePixelRatio = Math.min(maxCanvasDevicePixelRatio, Math.max(1, window.devicePixelRatio || 1));
        const nextWidth = Math.max(1, Math.round(bounds.width * devicePixelRatio));
        const nextHeight = Math.max(1, Math.round(bounds.height * devicePixelRatio));
        if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
            canvas.width = nextWidth;
            canvas.height = nextHeight;
            return true;
        }
        return false;
    };

    const clear = (): void => {
        if (!context) {
            return;
        }
        context.clearRect(0, 0, canvas.width, canvas.height);
    };

    const ensureWasm = async (): Promise<VisualizerWasmExports | null> => {
        if (wasmReady) {
            return await wasmReady;
        }

        wasmReady = (async () => {
            try {
                const response = await fetch(wasmUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch wasm renderer: ${response.status}`);
                }
                const module = await WebAssembly.instantiate(await response.arrayBuffer(), {});
                return module.instance.exports as unknown as VisualizerWasmExports;
            } catch (error) {
                console.debug(error);
                return null;
            }
        })();

        return await wasmReady;
    };

    const setCanvasMode = (): void => {
        canvas.dataset.visualizerMode = mode;
        canvas.dataset.equalizerPosition = equalizerPosition;
    };

    const resolveCoverKey = (source: CanvasImageSource): string | null => {
        if (source instanceof HTMLImageElement) {
            return source.currentSrc || source.src || null;
        }

        return null;
    };

    const resolveLissajousColor = (): RgbColor | null => {
        const coverImage = options.getCoverArtImageSource?.();
        if (!coverImage) {
            cachedCoverKey = '';
            cachedLissajousColor = null;
            return null;
        }

        const coverKey = resolveCoverKey(coverImage);
        if (coverKey && coverKey === cachedCoverKey) {
            return cachedLissajousColor;
        }

        const palette = deriveShareImageAccentPalette(coverImage);
        const primary = parseHexColor(palette.primary);
        cachedCoverKey = coverKey || '';
        cachedLissajousColor = primary;
        return primary;
    };

    const resetProjectionState = (): void => {
        projectionRevision += 1;
        targetPoints = null;
        renderedPoints = null;
        targetBands = null;
        renderedBands = null;
        peakBands = null;
        targetPeak = 0;
        renderedPeak = 0;
        projectedSourcePath = '';
        projectedWidth = 0;
        projectedHeight = 0;
        lastRenderAtMs = 0;
    };

    const writeFrameSamplesToWasm = (wasm: VisualizerWasmExports, frame: AudioVisualizationFrame): number => {
        const maxFrames = wasm.max_frames();
        const safeCount = Math.min(frame.frameCount, maxFrames);
        const input = new Int16Array(wasm.memory.buffer, wasm.input_ptr(), maxFrames * 2);
        for (let index = 0; index < safeCount * 2; index += 1) {
            input[index] = frame.samples[index] || 0;
        }
        return safeCount;
    };

    const updateLissajousProjection = async (frame: AudioVisualizationFrame, revision: number, sourceChanged: boolean, sizeChanged: boolean): Promise<void> => {
        const width = canvas.width;
        const height = canvas.height;
        const gain = clamp(0.48 + (frame.peak * 1.6), 0.38, 1.08);
        const scale = clamp(lissajousScale, minLissajousScale, maxLissajousScale);
        const wasm = await ensureWasm();
        let points: Float32Array;

        if (wasm) {
            const safeCount = writeFrameSamplesToWasm(wasm, frame);
            const renderedCount = wasm.render_lissajous(safeCount, width, height, gain, scale);
            points = new Float32Array(wasm.memory.buffer, wasm.output_ptr(), renderedCount * 2).slice();
        } else {
            points = createJsProjection(frame.samples, frame.frameCount, width, height, gain, scale);
        }

        if (disposed || revision !== projectionRevision) {
            return;
        }

        if (points.length < 4) {
            resetProjectionState();
            return;
        }

        targetPoints = points;
        targetPeak = frame.peak;
        projectedSourcePath = frame.sourcePath;
        projectedWidth = width;
        projectedHeight = height;

        if (!renderedPoints || renderedPoints.length !== points.length || sourceChanged || sizeChanged) {
            renderedPoints = points.slice();
            renderedPeak = frame.peak;
        }
    };

    const updateEqualizerProjection = async (frame: AudioVisualizationFrame, revision: number, sourceChanged: boolean, sizeChanged: boolean): Promise<void> => {
        const wasm = await ensureWasm();
        let bands: Float32Array;

        if (wasm && wasm.render_equalizer && wasm.max_bands && wasm.band_output_ptr) {
            const safeCount = writeFrameSamplesToWasm(wasm, frame);
            const renderedCount = clamp(wasm.render_equalizer(safeCount, frame.sampleRate || 44100, frame.sampleStride || 1), 0, wasm.max_bands());
            bands = new Float32Array(wasm.memory.buffer, wasm.band_output_ptr(), renderedCount).slice();
        } else {
            bands = createJsEqualizerBands(
                frame.samples,
                frame.frameCount,
                frame.sampleRate || 44100,
                frame.sampleStride || 1,
                wasm?.max_bands?.() || equalizerFallbackBandCount,
            );
        }

        if (disposed || revision !== projectionRevision) {
            return;
        }

        if (bands.length === 0) {
            resetProjectionState();
            return;
        }

        targetBands = bands;
        targetPeak = frame.peak;
        projectedSourcePath = frame.sourcePath;
        projectedWidth = canvas.width;
        projectedHeight = canvas.height;

        if (
            !renderedBands
            || renderedBands.length !== bands.length
            || !peakBands
            || peakBands.length !== bands.length
            || sourceChanged
            || sizeChanged
        ) {
            renderedBands = bands.slice();
            peakBands = bands.slice();
            renderedPeak = frame.peak;
        }
    };

    const updateTargetProjection = async (): Promise<void> => {
        if (!enabled) {
            resetProjectionState();
            return;
        }

        const frame = latestFrame;
        if (!frame || !frame.loaded || frame.frameCount < 2 || frame.samples.length < frame.frameCount * 2) {
            resetProjectionState();
            return;
        }

        syncCanvasSize();
        const sourceChanged = projectedSourcePath !== frame.sourcePath;
        const sizeChanged = projectedWidth !== canvas.width || projectedHeight !== canvas.height;
        const revision = ++projectionRevision;

        if (mode === 'equalizer') {
            await updateEqualizerProjection(frame, revision, sourceChanged, sizeChanged);
            return;
        }

        await updateLissajousProjection(frame, revision, sourceChanged, sizeChanged);
    };

    const handleWindowResize = (): void => {
        if (syncCanvasSize() && latestFrame?.loaded) {
            void updateTargetProjection();
        }
    };

    const drawLissajous = (nowMs: number): void => {
        if (!context || !targetPoints || targetPoints.length < 4) {
            canvas.classList.remove(activeVisualizerClass);
            return;
        }

        if (!renderedPoints || renderedPoints.length !== targetPoints.length) {
            renderedPoints = targetPoints.slice();
            renderedPeak = targetPeak;
        }

        const deltaMs = lastRenderAtMs > 0 ? Math.min(34, nowMs - lastRenderAtMs) : 16.67;
        lastRenderAtMs = nowMs;
        const interpolationFactor = clamp(1 - Math.exp(-deltaMs / pointSmoothingTimeMs), 0.14, 0.45);

        for (let index = 0; index < targetPoints.length; index += 1) {
            renderedPoints[index] += (targetPoints[index] - renderedPoints[index]) * interpolationFactor;
        }

        renderedPeak += (targetPeak - renderedPeak) * interpolationFactor;

        const peak = clamp(renderedPeak, 0, 1.2);
        const alpha = clamp(0.16 + (peak * 0.55), 0.18, 0.74);
        const lineWidth = Math.max(1.2, Math.min(canvas.width, canvas.height) * 0.0032);
        const accent = resolveLissajousColor();
        const baseColor = accent || { r: 255, g: 255, b: 255 };
        const glowColor = mixRgb(baseColor, { r: 255, g: 255, b: 255 }, 0.24);

        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineWidth = lineWidth * 2.1;
        context.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha * 0.16})`;
        context.shadowBlur = Math.max(12, Math.min(canvas.width, canvas.height) * 0.03);
        context.shadowColor = `rgba(${glowColor.r}, ${glowColor.g}, ${glowColor.b}, ${alpha * 0.45})`;
        context.beginPath();
        context.moveTo(renderedPoints[0], renderedPoints[1]);
        for (let index = 2; index < renderedPoints.length; index += 2) {
            context.lineTo(renderedPoints[index], renderedPoints[index + 1]);
        }
        context.stroke();

        context.shadowBlur = 0;
        context.lineWidth = lineWidth;
        context.strokeStyle = `rgba(${baseColor.r}, ${baseColor.g}, ${baseColor.b}, ${alpha})`;
        context.beginPath();
        context.moveTo(renderedPoints[0], renderedPoints[1]);
        for (let index = 2; index < renderedPoints.length; index += 2) {
            context.lineTo(renderedPoints[index], renderedPoints[index + 1]);
        }
        context.stroke();
        canvas.classList.add(activeVisualizerClass);
    };

    const drawEqualizer = (nowMs: number): void => {
        if (!context || !targetBands || targetBands.length === 0) {
            canvas.classList.remove(activeVisualizerClass);
            return;
        }

        if (!renderedBands || renderedBands.length !== targetBands.length) {
            renderedBands = targetBands.slice();
        }
        if (!peakBands || peakBands.length !== targetBands.length) {
            peakBands = targetBands.slice();
        }

        const deltaMs = lastRenderAtMs > 0 ? Math.min(34, nowMs - lastRenderAtMs) : 16.67;
        lastRenderAtMs = nowMs;
        const riseFactor = clamp(1 - Math.exp(-deltaMs / equalizerRiseSmoothingTimeMs), 0.18, 0.54);
        const fallFactor = clamp(1 - Math.exp(-deltaMs / equalizerFallSmoothingTimeMs), 0.05, 0.24);

        for (let index = 0; index < targetBands.length; index += 1) {
            const target = targetBands[index];
            const current = renderedBands[index];
            const smoothing = target >= current ? riseFactor : fallFactor;
            const nextValue = current + ((target - current) * smoothing);
            renderedBands[index] = nextValue;

            if (nextValue >= peakBands[index]) {
                peakBands[index] = nextValue;
            } else {
                peakBands[index] = Math.max(nextValue, peakBands[index] - (deltaMs * equalizerPeakDropPerMs));
            }
        }

        renderedPeak += (targetPeak - renderedPeak) * riseFactor;

        const peak = clamp(renderedPeak, 0, 1.2);
        const width = canvas.width;
        const height = canvas.height;
        const insetX = width * 0.075;
        const insetTop = height * 0.1;
        const insetBottom = height * 0.085;
        const usableWidth = Math.max(1, width - (insetX * 2));
        const usableHeight = Math.max(1, height - insetTop - insetBottom);
        const barCount = renderedBands.length;
        const gap = Math.max(2, Math.floor(usableWidth * 0.008));
        const barWidth = Math.max(2.5, (usableWidth - (gap * Math.max(0, barCount - 1))) / barCount);
        const segmentCount = Math.max(16, Math.round(usableHeight / 18));
        const segmentGap = Math.max(1.2, usableHeight * 0.01);
        const segmentHeight = Math.max(2.2, (usableHeight - ((segmentCount - 1) * segmentGap)) / segmentCount);
        const gradient = context.createLinearGradient(0, insetTop + usableHeight, 0, insetTop);

        gradient.addColorStop(0, `rgba(94, 188, 255, ${0.18 + (peak * 0.12)})`);
        gradient.addColorStop(0.48, `rgba(113, 255, 181, ${0.32 + (peak * 0.2)})`);
        gradient.addColorStop(0.78, `rgba(255, 224, 102, ${0.5 + (peak * 0.16)})`);
        gradient.addColorStop(1, `rgba(255, 132, 92, ${0.64 + (peak * 0.14)})`);

        context.fillStyle = `rgba(255, 255, 255, ${0.05 + (peak * 0.08)})`;
        context.fillRect(insetX, insetTop + usableHeight, usableWidth, Math.max(1.5, height * 0.0024));
        context.shadowBlur = Math.max(10, usableHeight * 0.05);
        context.shadowColor = `rgba(138, 244, 214, ${0.18 + (peak * 0.24)})`;
        context.fillStyle = gradient;

        for (let bandIndex = 0; bandIndex < barCount; bandIndex += 1) {
            const normalizedHeight = clamp(renderedBands[bandIndex], 0, 1);
            const curvedHeight = normalizedHeight ** 0.84;
            const activeSegments = Math.round(curvedHeight * segmentCount);
            if (activeSegments <= 0) {
                continue;
            }

            const x = insetX + (bandIndex * (barWidth + gap));
            for (let segmentIndex = 0; segmentIndex < activeSegments; segmentIndex += 1) {
                const y = insetTop + usableHeight - ((segmentIndex + 1) * segmentHeight) - (segmentIndex * segmentGap);
                context.globalAlpha = clamp(0.18 + ((segmentIndex / Math.max(1, segmentCount - 1)) * 0.82), 0.18, 1);
                context.fillRect(x, y, barWidth, segmentHeight);
            }

            const capHeight = clamp(peakBands[bandIndex], 0, 1);
            const capY = insetTop + usableHeight - (capHeight * usableHeight);
            context.globalAlpha = clamp(0.48 + (peak * 0.28), 0.48, 0.88);
            context.fillStyle = `rgba(255, 255, 255, ${0.54 + (peak * 0.24)})`;
            context.fillRect(x - 0.5, capY - 1.5, barWidth + 1, Math.max(2, segmentHeight * 0.42));
            context.fillStyle = gradient;
        }

        context.globalAlpha = 1;
        context.shadowBlur = 0;
        canvas.classList.add(activeVisualizerClass);
    };

    const draw = (nowMs: number): void => {
        if (!context) {
            return;
        }

        if (!enabled) {
            canvas.classList.remove(activeVisualizerClass);
            clear();
            return;
        }

        clear();

        if (mode === 'equalizer') {
            drawEqualizer(nowMs);
            return;
        }

        drawLissajous(nowMs);
    };

    const stopLoop = (): void => {
        if (animationFrameId !== 0) {
            window.cancelAnimationFrame(animationFrameId);
            animationFrameId = 0;
        }
    };

    const clearVisualizer = (): void => {
        activeFetchRequestId += 1;
        frameRequestVersion += 1;
        fetchInFlight = false;
        lastFetchAtMs = 0;
        latestFrame = null;
        priorityFetchPending = false;
        playbackActive = false;
        activePlaybackSourcePath = '';
        resetProjectionState();
        canvas.classList.remove(activeVisualizerClass);
        clear();
        stopLoop();
    };

    const tick = (): void => {
        if (disposed) {
            return;
        }

        const playbackState = options.getPlaybackState();
        if (!playbackState.playing) {
            clearVisualizer();
            return;
        }

        const nowMs = performance.now();
        const prioritizeFetch = priorityFetchPending;
        const shouldFetch = enabled
            && playbackState.loaded
            && !fetchInFlight
            && (prioritizeFetch || !shouldDeferBackgroundBridgeCall())
            && (playbackState.playing || latestFrame === null || latestFrame.sourcePath !== playbackState.sourcePath)
            && (prioritizeFetch || (nowMs - lastFetchAtMs >= visualizationFetchIntervalMs));

        if (shouldFetch) {
            fetchInFlight = true;
            lastFetchAtMs = nowMs;
            priorityFetchPending = false;
            const requestId = activeFetchRequestId + 1;
            const requestVersion = frameRequestVersion;
            activeFetchRequestId = requestId;
            const targetFrameCount = mode === 'equalizer' ? equalizerTargetFrameCount : lissajousTargetFrameCount;
            const fetchFramePromise = prioritizeFetch
                ? runBackgroundBridgeCall(async () => await options.fetchVisualizationFrame(targetFrameCount), {
                    maxWaitMs: 0,
                    onTimeout: async () => await options.fetchVisualizationFrame(targetFrameCount),
                })
                : runBackgroundBridgeCall(async () => await options.fetchVisualizationFrame(targetFrameCount), {
                    maxWaitMs: 32,
                    onTimeout: () => null,
                });
            fetchFramePromise
                .then((frame) => {
                    if (frame === null) {
                        return;
                    }

                    if (
                        disposed
                        || requestId !== activeFetchRequestId
                        || requestVersion !== frameRequestVersion
                    ) {
                        return;
                    }

                    const latestPlaybackState = options.getPlaybackState();
                    if (!latestPlaybackState.loaded || !latestPlaybackState.playing) {
                        return;
                    }

                    latestFrame = frame;
                    void updateTargetProjection();
                })
                .catch((error) => {
                    console.debug(error);
                })
                .finally(() => {
                    if (requestId === activeFetchRequestId) {
                        fetchInFlight = false;
                    }
                });
        }

        draw(nowMs);

        animationFrameId = window.requestAnimationFrame(tick);
    };

    const startLoop = (): void => {
        if (animationFrameId !== 0 || disposed) {
            return;
        }
        animationFrameId = window.requestAnimationFrame(tick);
    };

    const setPlaybackState = (playbackState: AudioPlaybackState): void => {
        if (!enabled) {
            clearVisualizer();
            return;
        }

        if (!playbackState.loaded || !playbackState.playing) {
            clearVisualizer();
            return;
        }

        const sourcePath = playbackState.sourcePath || '';
        const startingPlayback = !playbackActive || activePlaybackSourcePath !== sourcePath;
        playbackActive = true;
        activePlaybackSourcePath = sourcePath;
        if (startingPlayback) {
            priorityFetchPending = true;
            lastFetchAtMs = 0;
        }

        startLoop();
    };

    const setEnabled = (nextEnabled: boolean): void => {
        enabled = nextEnabled;
        if (!enabled) {
            clearVisualizer();
            return;
        }

        setCanvasMode();
        syncCanvasSize();
        if (options.getPlaybackState().loaded) {
            startLoop();
        }
    };

    const setMode = (nextMode: PlayerVisualizerMode): void => {
        const resolvedMode = nextMode === 'equalizer' ? 'equalizer' : defaultVisualizerMode;
        if (mode === resolvedMode) {
            setCanvasMode();
            return;
        }

        mode = resolvedMode;
        setCanvasMode();
        lastFetchAtMs = 0;
        resetProjectionState();

        if (!enabled) {
            canvas.classList.remove(activeVisualizerClass);
            clear();
            return;
        }

        syncCanvasSize();
        if (latestFrame?.loaded) {
            void updateTargetProjection();
        }
        if (options.getPlaybackState().loaded) {
            startLoop();
        }
    };

    const setEqualizerPosition = (nextPosition: PlayerEqualizerPosition): void => {
        const resolvedPosition = nextPosition === 'top' ? 'top' : defaultEqualizerPosition;
        if (equalizerPosition === resolvedPosition) {
            setCanvasMode();
            return;
        }

        equalizerPosition = resolvedPosition;
        setCanvasMode();
    };

    const setLissajousScale = (nextScale: number): void => {
        const resolvedScale = clamp(nextScale, minLissajousScale, maxLissajousScale);
        if (lissajousScale === resolvedScale) {
            return;
        }

        lissajousScale = resolvedScale;
        lastFetchAtMs = 0;
        if (mode !== 'lissajous') {
            return;
        }

        resetProjectionState();

        if (!enabled) {
            canvas.classList.remove(activeVisualizerClass);
            clear();
            return;
        }

        syncCanvasSize();
        if (latestFrame?.loaded) {
            void updateTargetProjection();
        }
        if (options.getPlaybackState().loaded) {
            startLoop();
        }
    };

    const start = (): void => {
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(handleWindowResize);
            resizeObserver.observe(canvas);
        } else {
            window.addEventListener('resize', handleWindowResize);
        }
        setCanvasMode();
        syncCanvasSize();
        if (enabled && options.getPlaybackState().loaded) {
            startLoop();
        }
    };

    const dispose = (): void => {
        disposed = true;
        stopLoop();
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        } else {
            window.removeEventListener('resize', handleWindowResize);
        }
        clear();
    };

    setCanvasMode();

    return {
        dispose,
        setEnabled,
        setEqualizerPosition,
        setLissajousScale,
        setMode,
        setPlaybackState,
        start,
    };
};