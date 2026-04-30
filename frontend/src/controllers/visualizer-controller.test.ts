import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVisualizerController } from './visualizer-controller';
import type { AudioPlaybackState } from '../types/app-types';
import { noteSlowBackgroundBridgeCall, resetBridgeLoadGateForTests } from '../utils/bridge-load-gate';

const playingState: AudioPlaybackState = {
    loaded: true,
    playing: true,
    currentTime: 0,
    duration: 180,
    volume: 1,
    sourcePath: '/music/track.flac',
    endEventId: 0,
};

const createDeferred = <T>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
    });
    return { promise, resolve, reject };
};

describe('createVisualizerController', () => {
    let animationFrameCallback: FrameRequestCallback | undefined;
    let performanceNowMs = 0;

    beforeEach(() => {
        animationFrameCallback = undefined;
        performanceNowMs = 0;
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback): number => {
            animationFrameCallback = callback;
            return 1;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.spyOn(performance, 'now').mockImplementation(() => performanceNowMs);
    });

    afterEach(() => {
        resetBridgeLoadGateForTests();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('does not read canvas bounds during an animation tick draw', async () => {
        const canvas = document.createElement('canvas');
        const drawingContext = {
            clearRect: vi.fn(),
        } as unknown as CanvasRenderingContext2D;
        Object.defineProperty(canvas, 'getContext', {
            configurable: true,
            value: vi.fn(() => drawingContext),
        });

        const getBoundingClientRect = vi.fn(() => ({
            width: 320,
            height: 180,
            top: 0,
            left: 0,
            right: 320,
            bottom: 180,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }));
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            configurable: true,
            value: getBoundingClientRect,
        });

        const fetchVisualizationFrame = vi.fn(() => createDeferred<never>().promise);
        const controller = createVisualizerController({
            canvas,
            getPlaybackState: () => playingState,
            fetchVisualizationFrame,
        });

        controller.start();
        expect(getBoundingClientRect).toHaveBeenCalledTimes(1);

        getBoundingClientRect.mockClear();
        controller.setPlaybackState(playingState);
        expect(animationFrameCallback).toBeTypeOf('function');

        performanceNowMs = 520;
        animationFrameCallback?.(520);
        await Promise.resolve();

        expect(fetchVisualizationFrame).toHaveBeenCalledTimes(1);
        expect(getBoundingClientRect).not.toHaveBeenCalled();
    });

    it('prioritizes the first visualizer fetch as soon as playback starts', async () => {
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'getContext', {
            configurable: true,
            value: vi.fn(() => ({ clearRect: vi.fn() })),
        });
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            configurable: true,
            value: vi.fn(() => ({
                width: 320,
                height: 180,
                top: 0,
                left: 0,
                right: 320,
                bottom: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            })),
        });

        const fetchVisualizationFrame = vi.fn(async () => ({
            ...playingState,
            sampleRate: 44100,
            channelCount: 2,
            frameCount: 0,
            sampleStride: 1,
            peak: 0,
            samples: [],
        }));
        const controller = createVisualizerController({
            canvas,
            getPlaybackState: () => playingState,
            fetchVisualizationFrame,
        });

        noteSlowBackgroundBridgeCall(120);
        controller.start();
        controller.setPlaybackState(playingState);

        performanceNowMs = 16;
        animationFrameCallback?.(16);
        await Promise.resolve();

        expect(fetchVisualizationFrame).toHaveBeenCalledTimes(1);
    });

    it('emits trace logs during the startup fetch window', async () => {
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'getContext', {
            configurable: true,
            value: vi.fn(() => ({ clearRect: vi.fn() })),
        });
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            configurable: true,
            value: vi.fn(() => ({
                width: 320,
                height: 180,
                top: 0,
                left: 0,
                right: 320,
                bottom: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            })),
        });

        const logDebug = vi.fn();
        const fetchVisualizationFrame = vi.fn(async () => ({
            ...playingState,
            sampleRate: 44100,
            channelCount: 2,
            frameCount: 0,
            sampleStride: 1,
            peak: 0,
            samples: [],
        }));
        const controller = createVisualizerController({
            canvas,
            getPlaybackState: () => playingState,
            fetchVisualizationFrame,
            logDebug,
        });

        controller.start();
        controller.setPlaybackState(playingState);

        performanceNowMs = 16;
        animationFrameCallback?.(16);
        await Promise.resolve();

        expect(logDebug).toHaveBeenCalledWith(expect.stringContaining('[VISUALIZER] TraceStart reason=start'));
        expect(logDebug).toHaveBeenCalledWith(expect.stringContaining('[VISUALIZER] Trace fetch start'));
        await vi.waitFor(() => {
            expect(logDebug.mock.calls.some(([message]) => String(message).includes('[VISUALIZER] Trace fetch result'))).toBe(true);
        });
    });

    it('keeps fetching fresh frames during the startup quiet window after the first projection lands', async () => {
        const canvas = document.createElement('canvas');
        const drawingContext = {
            clearRect: vi.fn(),
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            lineCap: 'round',
            lineJoin: 'round',
            lineWidth: 1,
            strokeStyle: '',
            shadowBlur: 0,
            shadowColor: '',
        } as unknown as CanvasRenderingContext2D;
        Object.defineProperty(canvas, 'getContext', {
            configurable: true,
            value: vi.fn(() => drawingContext),
        });
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            configurable: true,
            value: vi.fn(() => ({
                width: 320,
                height: 180,
                top: 0,
                left: 0,
                right: 320,
                bottom: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            })),
        });

        const fetchVisualizationFrame = vi.fn(async () => ({
            ...playingState,
            sampleRate: 44100,
            channelCount: 2,
            frameCount: 4,
            sampleStride: 1,
            peak: 0.2,
            samples: [1000, -1000, 2000, -2000, 3000, -3000, 4000, -4000],
        }));
        const controller = createVisualizerController({
            canvas,
            getPlaybackState: () => playingState,
            fetchVisualizationFrame,
        });

        controller.start();
        controller.setPlaybackState(playingState);

        performanceNowMs = 16;
        animationFrameCallback?.(16);
        await vi.waitFor(() => {
            expect(fetchVisualizationFrame).toHaveBeenCalledTimes(1);
        });

        performanceNowMs = 100;
        await vi.waitFor(() => {
            animationFrameCallback?.(100);
            expect(fetchVisualizationFrame).toHaveBeenCalledTimes(2);
        });
    });

    it('preserves the active visualizer canvas during the startup quiet window until the new track has a projection', async () => {
        const canvas = document.createElement('canvas');
        canvas.classList.add('is-visualizer-active');
        const clearRect = vi.fn();
        Object.defineProperty(canvas, 'getContext', {
            configurable: true,
            value: vi.fn(() => ({ clearRect })),
        });
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            configurable: true,
            value: vi.fn(() => ({
                width: 320,
                height: 180,
                top: 0,
                left: 0,
                right: 320,
                bottom: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            })),
        });

        let playbackState = {
            ...playingState,
            sourcePath: '/music/track-a.flac',
        };
        const fetchVisualizationFrame = vi.fn(async () => ({
            ...playbackState,
            sampleRate: 44100,
            channelCount: 2,
            frameCount: 0,
            sampleStride: 1,
            peak: 0,
            samples: [],
        }));
        const controller = createVisualizerController({
            canvas,
            getPlaybackState: () => playbackState,
            fetchVisualizationFrame,
        });

        controller.start();
        controller.setPlaybackState(playbackState);

        playbackState = {
            ...playbackState,
            sourcePath: '/music/track-b.flac',
        };
        controller.setPlaybackState(playbackState);

        performanceNowMs = 16;
        animationFrameCallback?.(16);
        await Promise.resolve();

        expect(fetchVisualizationFrame).toHaveBeenCalledTimes(1);
        expect(clearRect).not.toHaveBeenCalled();
        expect(canvas.classList.contains('is-visualizer-active')).toBe(true);
    });

    it('retries startup fetches during the quiet window until a projection becomes available', async () => {
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'getContext', {
            configurable: true,
            value: vi.fn(() => ({ clearRect: vi.fn() })),
        });
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            configurable: true,
            value: vi.fn(() => ({
                width: 320,
                height: 180,
                top: 0,
                left: 0,
                right: 320,
                bottom: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            })),
        });

        const fetchVisualizationFrame = vi.fn(async () => ({
            ...playingState,
            sampleRate: 44100,
            channelCount: 2,
            frameCount: 0,
            sampleStride: 1,
            peak: 0,
            samples: [],
        }));
        const controller = createVisualizerController({
            canvas,
            getPlaybackState: () => playingState,
            fetchVisualizationFrame,
        });

        controller.start();
        controller.setPlaybackState(playingState);

        performanceNowMs = 16;
        animationFrameCallback?.(16);
        await Promise.resolve();

        performanceNowMs = 100;
        await vi.waitFor(() => {
            animationFrameCallback?.(100);
            expect(fetchVisualizationFrame).toHaveBeenCalledTimes(2);
        });
    });

    it('reuses the prior projection on same-track resume while new audio data is fetched', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 404,
        })));

        const canvas = document.createElement('canvas');
        const clearRect = vi.fn();
        const drawingContext = {
            clearRect,
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            lineCap: 'round',
            lineJoin: 'round',
            lineWidth: 1,
            strokeStyle: '',
            shadowBlur: 0,
            shadowColor: '',
        } as unknown as CanvasRenderingContext2D;
        Object.defineProperty(canvas, 'getContext', {
            configurable: true,
            value: vi.fn(() => drawingContext),
        });
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            configurable: true,
            value: vi.fn(() => ({
                width: 320,
                height: 180,
                top: 0,
                left: 0,
                right: 320,
                bottom: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            })),
        });

        const frame = {
            ...playingState,
            sampleRate: 44100,
            channelCount: 2,
            frameCount: 4,
            sampleStride: 1,
            peak: 0.25,
            samples: [
                2000, -2000,
                4000, -4000,
                6000, -6000,
                8000, -8000,
            ],
        };
        const fetchVisualizationFrame = vi.fn(async () => frame);
        const controller = createVisualizerController({
            canvas,
            getPlaybackState: () => playingState,
            fetchVisualizationFrame,
        });

        controller.start();
        controller.setPlaybackState(playingState);

        performanceNowMs = 16;
        animationFrameCallback?.(16);
        await vi.waitFor(() => {
            expect(fetchVisualizationFrame).toHaveBeenCalledTimes(1);
        });

        performanceNowMs = 32;
        animationFrameCallback?.(32);
        expect(canvas.classList.contains('is-visualizer-active')).toBe(true);

        controller.setPlaybackState({
            ...playingState,
            playing: false,
        });
        expect(canvas.classList.contains('is-visualizer-active')).toBe(false);

        controller.setPlaybackState(playingState);
        performanceNowMs = 48;
        animationFrameCallback?.(48);
        await vi.waitFor(() => {
            expect(fetchVisualizationFrame).toHaveBeenCalledTimes(2);
        });
        expect(canvas.classList.contains('is-visualizer-active')).toBe(true);
    });

    it('preserves the current projection when a same-track fetch returns an empty frame', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: false,
            status: 404,
        })));

        const canvas = document.createElement('canvas');
        const clearRect = vi.fn();
        const drawingContext = {
            clearRect,
            beginPath: vi.fn(),
            moveTo: vi.fn(),
            lineTo: vi.fn(),
            stroke: vi.fn(),
            lineCap: 'round',
            lineJoin: 'round',
            lineWidth: 1,
            strokeStyle: '',
            shadowBlur: 0,
            shadowColor: '',
        } as unknown as CanvasRenderingContext2D;
        Object.defineProperty(canvas, 'getContext', {
            configurable: true,
            value: vi.fn(() => drawingContext),
        });
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            configurable: true,
            value: vi.fn(() => ({
                width: 320,
                height: 180,
                top: 0,
                left: 0,
                right: 320,
                bottom: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            })),
        });

        const queuedFrames = [
            {
                ...playingState,
                sampleRate: 44100,
                channelCount: 2,
                frameCount: 4,
                sampleStride: 1,
                peak: 0.25,
                samples: [2000, -2000, 4000, -4000, 6000, -6000, 8000, -8000],
            },
            {
                ...playingState,
                sampleRate: 44100,
                channelCount: 2,
                frameCount: 0,
                sampleStride: 1,
                peak: 0,
                samples: [],
            },
        ];
        const fetchVisualizationFrame = vi.fn(async (_frameCount: number) => queuedFrames.shift() ?? queuedFrames[0]);

        const controller = createVisualizerController({
            canvas,
            getPlaybackState: () => playingState,
            fetchVisualizationFrame,
        });

        controller.start();
        controller.setPlaybackState(playingState);

        performanceNowMs = 16;
        animationFrameCallback?.(16);
        await vi.waitFor(() => {
            expect(fetchVisualizationFrame).toHaveBeenCalledTimes(1);
        });

        performanceNowMs = 32;
        animationFrameCallback?.(32);
        expect(canvas.classList.contains('is-visualizer-active')).toBe(true);

        performanceNowMs = 100;
        await vi.waitFor(() => {
            animationFrameCallback?.(100);
            expect(fetchVisualizationFrame).toHaveBeenCalledTimes(2);
        });

        performanceNowMs = 116;
        animationFrameCallback?.(116);
        expect(canvas.classList.contains('is-visualizer-active')).toBe(true);
    });

    it('still defers routine visualizer fetches while background bridge work is deferred', () => {
        const canvas = document.createElement('canvas');
        Object.defineProperty(canvas, 'getContext', {
            configurable: true,
            value: vi.fn(() => ({ clearRect: vi.fn() })),
        });
        Object.defineProperty(canvas, 'getBoundingClientRect', {
            configurable: true,
            value: vi.fn(() => ({
                width: 320,
                height: 180,
                top: 0,
                left: 0,
                right: 320,
                bottom: 180,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            })),
        });

        const fetchVisualizationFrame = vi.fn(async () => ({
            ...playingState,
            sampleRate: 44100,
            channelCount: 2,
            frameCount: 0,
            sampleStride: 1,
            peak: 0,
            samples: [],
        }));
        const controller = createVisualizerController({
            canvas,
            getPlaybackState: () => playingState,
            fetchVisualizationFrame,
        });

        noteSlowBackgroundBridgeCall(120);
        controller.start();

        animationFrameCallback?.(16);

        expect(fetchVisualizationFrame).not.toHaveBeenCalled();
    });
});