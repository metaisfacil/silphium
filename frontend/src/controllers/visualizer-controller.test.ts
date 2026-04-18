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

    beforeEach(() => {
        animationFrameCallback = undefined;
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback): number => {
            animationFrameCallback = callback;
            return 1;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
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

        animationFrameCallback?.(16);
        await Promise.resolve();

        expect(fetchVisualizationFrame).toHaveBeenCalledTimes(1);
        expect(getBoundingClientRect).not.toHaveBeenCalled();
    });

    it('prioritizes the first visualizer fetch after playback starts even while background bridge work is deferred', async () => {
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

        animationFrameCallback?.(16);
        await Promise.resolve();

        expect(fetchVisualizationFrame).toHaveBeenCalledTimes(1);
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