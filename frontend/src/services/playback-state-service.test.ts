import { describe, expect, it } from 'vitest';

import { createInitialPlaybackState, createPlaybackStateService } from './playback-state-service';

describe('createPlaybackStateService', () => {
    it('reports track endings only once per backend end event', () => {
        const service = createPlaybackStateService();
        const endedState = {
            ...createInitialPlaybackState(),
            loaded: true,
            endEventId: 1,
        };

        expect(service.applyPlaybackState(endedState, false)).toEqual({ trackEnded: false });
        expect(service.applyPlaybackState(endedState, true)).toEqual({ trackEnded: true });
        expect(service.applyPlaybackState({ ...endedState, currentTime: 42 }, true)).toEqual({ trackEnded: false });
    });

    it('resets end-event tracking when requested', () => {
        const service = createPlaybackStateService();
        const endedState = {
            ...createInitialPlaybackState(),
            loaded: true,
            endEventId: 3,
        };

        expect(service.applyPlaybackState(endedState, true)).toEqual({ trackEnded: true });

        service.resetEndEventTracking();

        expect(service.applyPlaybackState(endedState, true)).toEqual({ trackEnded: true });
    });

    it('tracks backend readiness separately from playback state', () => {
        const service = createPlaybackStateService();
        const nextState = {
            ...createInitialPlaybackState(),
            loaded: true,
            playing: true,
            sourcePath: '/music/current.flac',
        };

        service.setBackendReady(true);
        service.applyPlaybackState(nextState, true);

        expect(service.isBackendReady()).toBe(true);
        expect(service.getPlaybackState()).toEqual(nextState);
    });
});