import { describe, expect, it } from 'vitest';

import {
    playbackReconcileDelayMs,
    playbackReconcileMaxPollIntervalMs,
    playbackReconcileNearEndPollIntervalMs,
    playbackReconcileUnknownDurationPollIntervalMs,
} from './playback-reconcile-delay';
import type { AudioPlaybackState } from '../types/app-types';

const createPlaybackState = (overrides: Partial<AudioPlaybackState> = {}): AudioPlaybackState => ({
    loaded: true,
    playing: true,
    currentTime: 12,
    duration: 180,
    volume: 0.8,
    sourcePath: '/music/current.flac',
    endEventId: 0,
    ...overrides,
});

describe('playbackReconcileDelayMs', () => {
    it('does not schedule background reconciles while playback is idle', () => {
        expect(playbackReconcileDelayMs(createPlaybackState({ loaded: false }))).toBeNull();
        expect(playbackReconcileDelayMs(createPlaybackState({ playing: false }))).toBeNull();
    });

    it('caps the next reconcile to a short periodic poll while playback is active', () => {
        expect(playbackReconcileDelayMs(createPlaybackState())).toBe(playbackReconcileMaxPollIntervalMs);
    });

    it('switches to short polling near the end of the track', () => {
        expect(playbackReconcileDelayMs(createPlaybackState({ currentTime: 177.2 }))).toBe(playbackReconcileNearEndPollIntervalMs);
    });

    it('falls back to a slower periodic reconcile when duration is unknown', () => {
        expect(playbackReconcileDelayMs(createPlaybackState({ duration: Number.POSITIVE_INFINITY }))).toBe(playbackReconcileUnknownDurationPollIntervalMs);
    });
});