import { describe, expect, it } from 'vitest';

import { createInitialPlaybackState, createPlaybackSessionState, createPlaybackStateService } from './playback-state-service';

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

    it('mutates an injected playback session state object', () => {
        const state = createPlaybackSessionState();
        const service = createPlaybackStateService(state);
        const nextState = {
            ...createInitialPlaybackState(),
            loaded: true,
            playing: true,
            currentTime: 12,
            sourcePath: '/music/current.flac',
            endEventId: 4,
        };

        service.setBackendReady(true);
        expect(service.applyPlaybackState(nextState, true)).toEqual({ trackEnded: true });

        expect(state.backendReady).toBe(true);
        expect(state.playbackState).toEqual(nextState);
        expect(state.lastHandledEndEventId).toBe(4);

        service.resetEndEventTracking();

        expect(state.lastHandledEndEventId).toBe(0);
    });

    it('ignores end events after source path already advanced', () => {
        const service = createPlaybackStateService();

        const firstTrackState = {
            ...createInitialPlaybackState(),
            loaded: true,
            playing: true,
            sourcePath: '/music/track-1.flac',
            endEventId: 0,
        };
        expect(service.applyPlaybackState(firstTrackState, true)).toEqual({ trackEnded: false });

        const gaplessAdvancedState = {
            ...firstTrackState,
            sourcePath: '/music/track-2.flac',
            endEventId: 1,
        };
        expect(service.applyPlaybackState(gaplessAdvancedState, true)).toEqual({ trackEnded: false });

        const actualEndState = {
            ...gaplessAdvancedState,
            endEventId: 2,
        };
        expect(service.applyPlaybackState(actualEndState, true)).toEqual({ trackEnded: true });
    });

    it('allows local playback progress updates without re-triggering end events', () => {
        const state = createPlaybackSessionState();
        const service = createPlaybackStateService(state);
        const nextState = {
            ...createInitialPlaybackState(),
            loaded: true,
            playing: true,
            currentTime: 12,
            duration: 300,
            sourcePath: '/music/current.flac',
            endEventId: 5,
        };

        expect(service.applyPlaybackState(nextState, true)).toEqual({ trackEnded: true });
        expect(service.setCurrentTime(12.75)).toBe(true);
        expect(service.getPlaybackState().currentTime).toBe(12.75);
        expect(service.applyPlaybackState({ ...nextState, currentTime: 13.2 }, true)).toEqual({ trackEnded: false });
    });

    it('supports optimistic local playing-state updates for loaded tracks', () => {
        const service = createPlaybackStateService();
        const nextState = {
            ...createInitialPlaybackState(),
            loaded: true,
            playing: false,
            sourcePath: '/music/current.flac',
        };

        service.applyPlaybackState(nextState, true);

        expect(service.setPlaying(true)).toBe(true);
        expect(service.getPlaybackState().playing).toBe(true);
        expect(service.setPlaying(true)).toBe(false);
        expect(service.setPlaying(false)).toBe(true);
        expect(service.getPlaybackState().playing).toBe(false);
    });
});