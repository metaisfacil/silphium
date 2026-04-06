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

    const normalizePathKey = (path: string): string => path.trim().toLowerCase();

    return {
        applyPlaybackState: (nextState: AudioPlaybackState, hasTracks: boolean): { trackEnded: boolean } => {
            const previousSourcePathKey = normalizePathKey(playbackState.sourcePath || '');
            const nextSourcePathKey = normalizePathKey(nextState.sourcePath || '');
            const sourcePathChanged = previousSourcePathKey !== ''
                && nextSourcePathKey !== ''
                && previousSourcePathKey !== nextSourcePathKey;

            playbackState = nextState;

            if (!hasTracks || nextState.endEventId <= lastHandledEndEventId || sourcePathChanged) {
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