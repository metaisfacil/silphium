import { describe, expect, it } from 'vitest';

import { createPlaybackProgressEstimator } from './playback-progress-estimator';
import type { AudioPlaybackState } from '../types/app-types';

const createPlaybackState = (overrides: Partial<AudioPlaybackState> = {}): AudioPlaybackState => ({
    loaded: true,
    playing: true,
    currentTime: 12,
    duration: 300,
    volume: 0.8,
    sourcePath: '/music/current.flac',
    endEventId: 0,
    ...overrides,
});

describe('createPlaybackProgressEstimator', () => {
    it('advances current time while playback is active', () => {
        let now = 1_000;
        const estimator = createPlaybackProgressEstimator(() => now);
        estimator.sync(createPlaybackState());

        now = 2_250;

        expect(estimator.estimate().currentTime).toBe(13.25);
    });

    it('clamps playback progress to the known duration', () => {
        let now = 500;
        const estimator = createPlaybackProgressEstimator(() => now);
        estimator.sync(createPlaybackState({ currentTime: 299.6, duration: 300 }));

        now = 1_500;

        expect(estimator.estimate().currentTime).toBe(300);
    });

    it('does not advance paused playback', () => {
        let now = 100;
        const estimator = createPlaybackProgressEstimator(() => now);
        estimator.sync(createPlaybackState({ playing: false, currentTime: 42 }));

        now = 3_100;

        expect(estimator.estimate().currentTime).toBe(42);
    });
});