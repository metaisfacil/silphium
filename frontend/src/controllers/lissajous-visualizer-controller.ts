import type { AudioPlaybackState, AudioVisualizationFrame } from '../types/app-types';

type LissajousVisualizerControllerOptions = {
    canvas: HTMLCanvasElement;
    getPlaybackState: () => AudioPlaybackState;
    fetchVisualizationFrame: (frameCount: number) => Promise<AudioVisualizationFrame>;
};

type LissajousWasmExports = {
    memory: WebAssembly.Memory;
    max_frames: () => number;
    input_ptr: () => number;
    output_ptr: () => number;
    render_lissajous: (frameCount: number, width: number, height: number, gain: number) => number;
};

const targetFrameCount = 192;
const visualizationFetchIntervalMs = 75;
const maxCanvasDevicePixelRatio = 1.5;
const pointSmoothingTimeMs = 72;
const activeVisualizerClass = 'is-visualizer-active';
const wasmUrl = new URL('../assets/wasm/lissajous_visualizer_bg.wasm', import.meta.url);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const createJsProjection = (samples: number[], frameCount: number, width: number, height: number, gain: number): Float32Array => {
    const projected = new Float32Array(frameCount * 2);
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    const radius = Math.min(width, height) * 0.34 * gain;
    for (let index = 0; index < frameCount; index += 1) {
        const left = (samples[index * 2] || 0) / 32768;
        const right = (samples[(index * 2) + 1] || 0) / 32768;
        projected[index * 2] = centerX + (left * radius);
        projected[(index * 2) + 1] = centerY - (right * radius);
    }
    return projected;
};

export const createLissajousVisualizerController = (options: LissajousVisualizerControllerOptions) => {
    const { canvas } = options;
    const context = canvas.getContext('2d');
    let animationFrameId = 0;
    let disposed = false;
    let enabled = true;
    let fetchInFlight = false;
    let activeFetchRequestId = 0;
    let frameRequestVersion = 0;
    let lastFetchAtMs = 0;
    let lastRenderAtMs = 0;
    let latestFrame: AudioVisualizationFrame | null = null;
    let targetPoints: Float32Array | null = null;
    let renderedPoints: Float32Array | null = null;
    let targetPeak = 0;
    let renderedPeak = 0;
    let projectedSourcePath = '';
    let projectedWidth = 0;
    let projectedHeight = 0;
    let projectionRevision = 0;
    let wasmReady: Promise<LissajousWasmExports | null> | null = null;
    let resizeObserver: ResizeObserver | null = null;

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

    const ensureWasm = async (): Promise<LissajousWasmExports | null> => {
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
                return module.instance.exports as unknown as LissajousWasmExports;
            } catch (error) {
                console.debug(error);
                return null;
            }
        })();

        return await wasmReady;
    };

    const resetProjectionState = (): void => {
        projectionRevision += 1;
        targetPoints = null;
        renderedPoints = null;
        targetPeak = 0;
        renderedPeak = 0;
        projectedSourcePath = '';
        projectedWidth = 0;
        projectedHeight = 0;
        lastRenderAtMs = 0;
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
        const width = canvas.width;
        const height = canvas.height;
        const sourceChanged = projectedSourcePath !== frame.sourcePath;
        const sizeChanged = projectedWidth !== width || projectedHeight !== height;
        const gain = clamp(0.48 + (frame.peak * 1.6), 0.38, 1.08);
        const revision = ++projectionRevision;
        const wasm = await ensureWasm();
        let points: Float32Array;

        if (wasm) {
            const maxFrames = wasm.max_frames();
            const safeCount = Math.min(frame.frameCount, maxFrames);
            const input = new Int16Array(wasm.memory.buffer, wasm.input_ptr(), maxFrames * 2);
            for (let index = 0; index < safeCount * 2; index += 1) {
                input[index] = frame.samples[index] || 0;
            }
            const renderedCount = wasm.render_lissajous(safeCount, width, height, gain);
            points = new Float32Array(wasm.memory.buffer, wasm.output_ptr(), renderedCount * 2).slice();
        } else {
            points = createJsProjection(frame.samples, frame.frameCount, width, height, gain);
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

    const handleWindowResize = (): void => {
        if (syncCanvasSize() && latestFrame?.loaded) {
            void updateTargetProjection();
        }
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

        if (syncCanvasSize() && latestFrame?.loaded) {
            void updateTargetProjection();
        }

        clear();

        if (!targetPoints || targetPoints.length < 4) {
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

        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineWidth = lineWidth * 2.1;
        context.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.16})`;
        context.shadowBlur = Math.max(12, Math.min(canvas.width, canvas.height) * 0.03);
        context.shadowColor = `rgba(255, 255, 255, ${alpha * 0.45})`;
        context.beginPath();
        context.moveTo(renderedPoints[0], renderedPoints[1]);
        for (let index = 2; index < renderedPoints.length; index += 2) {
            context.lineTo(renderedPoints[index], renderedPoints[index + 1]);
        }
        context.stroke();

        context.shadowBlur = 0;
        context.lineWidth = lineWidth;
        context.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        context.beginPath();
        context.moveTo(renderedPoints[0], renderedPoints[1]);
        for (let index = 2; index < renderedPoints.length; index += 2) {
            context.lineTo(renderedPoints[index], renderedPoints[index + 1]);
        }
        context.stroke();
        canvas.classList.add(activeVisualizerClass);
    };

    const clearVisualizer = (): void => {
        activeFetchRequestId += 1;
        frameRequestVersion += 1;
        fetchInFlight = false;
        lastFetchAtMs = 0;
        latestFrame = null;
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
        const shouldFetch = enabled
            && playbackState.loaded
            && !fetchInFlight
            && (playbackState.playing || latestFrame === null || latestFrame.sourcePath !== playbackState.sourcePath)
            && (nowMs - lastFetchAtMs >= visualizationFetchIntervalMs);

        if (shouldFetch) {
            fetchInFlight = true;
            lastFetchAtMs = nowMs;
            const requestId = activeFetchRequestId + 1;
            const requestVersion = frameRequestVersion;
            activeFetchRequestId = requestId;
            options.fetchVisualizationFrame(targetFrameCount)
                .then((frame) => {
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

    const stopLoop = (): void => {
        if (animationFrameId !== 0) {
            window.cancelAnimationFrame(animationFrameId);
            animationFrameId = 0;
        }
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
        startLoop();
    };

    const setEnabled = (nextEnabled: boolean): void => {
        enabled = nextEnabled;
        if (!enabled) {
            clearVisualizer();
            return;
        }

        syncCanvasSize();
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

    return {
        dispose,
        setEnabled,
        setPlaybackState,
        start,
    };
};