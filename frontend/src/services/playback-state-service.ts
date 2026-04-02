import type { AudioPlaybackState } from '../types/app-types';

export const createInitialPlaybackState = (): AudioPlaybackState => ({
    loaded: false,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    sourcePath: '',
    endEventId: 0,
});

export type PlaybackStateService = ReturnType<typeof createPlaybackStateService>;

export const createPlaybackStateService = (initialState: AudioPlaybackState = createInitialPlaybackState()) => {
    let playbackState: AudioPlaybackState = initialState;
    let backendReady = false;
    let lastHandledEndEventId = 0;

    return {
        applyPlaybackState: (nextState: AudioPlaybackState, hasTracks: boolean): { trackEnded: boolean } => {
            playbackState = nextState;

            if (!hasTracks || nextState.endEventId <= lastHandledEndEventId) {
                return { trackEnded: false };
            }

            lastHandledEndEventId = nextState.endEventId;
            return { trackEnded: true };
        },
        getPlaybackState: (): AudioPlaybackState => playbackState,
        isBackendReady: (): boolean => backendReady,
        resetEndEventTracking: (): void => {
            lastHandledEndEventId = 0;
        },
        setBackendReady: (ready: boolean): void => {
            backendReady = ready;
        },
    };
};