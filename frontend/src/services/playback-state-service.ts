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

export type PlaybackSessionState = {
    playbackState: AudioPlaybackState;
    backendReady: boolean;
    lastHandledEndEventId: number;
};

export const createPlaybackSessionState = (initialState: AudioPlaybackState = createInitialPlaybackState()): PlaybackSessionState => ({
    playbackState: initialState,
    backendReady: false,
    lastHandledEndEventId: 0,
});

export type PlaybackStateService = ReturnType<typeof createPlaybackStateService>;

export const createPlaybackStateService = (state: PlaybackSessionState = createPlaybackSessionState()) => {
    const normalizePathKey = (path: string): string => path.trim().toLowerCase();

    return {
        applyPlaybackState: (nextState: AudioPlaybackState, hasTracks: boolean): { trackEnded: boolean } => {
            const previousSourcePathKey = normalizePathKey(state.playbackState.sourcePath || '');
            const nextSourcePathKey = normalizePathKey(nextState.sourcePath || '');
            const sourcePathChanged = previousSourcePathKey !== ''
                && nextSourcePathKey !== ''
                && previousSourcePathKey !== nextSourcePathKey;

            state.playbackState = nextState;

            if (!hasTracks || nextState.endEventId <= state.lastHandledEndEventId || sourcePathChanged) {
                return { trackEnded: false };
            }

            state.lastHandledEndEventId = nextState.endEventId;
            return { trackEnded: true };
        },
        getPlaybackState: (): AudioPlaybackState => state.playbackState,
        isBackendReady: (): boolean => state.backendReady,
        resetEndEventTracking: (): void => {
            state.lastHandledEndEventId = 0;
        },
        setBackendReady: (ready: boolean): void => {
            state.backendReady = ready;
        },
    };
};