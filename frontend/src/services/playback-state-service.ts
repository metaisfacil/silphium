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
    const normalizeCurrentTime = (nextCurrentTime: number): number => {
        if (!Number.isFinite(nextCurrentTime)) {
            return state.playbackState.currentTime;
        }

        const boundedLower = Math.max(0, nextCurrentTime);
        if (!Number.isFinite(state.playbackState.duration) || state.playbackState.duration <= 0) {
            return boundedLower;
        }

        return Math.min(state.playbackState.duration, boundedLower);
    };

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
        setPlaying: (playing: boolean): boolean => {
            if (!state.playbackState.loaded || state.playbackState.playing === playing) {
                return false;
            }

            state.playbackState = {
                ...state.playbackState,
                playing,
            };
            return true;
        },
        setCurrentTime: (nextCurrentTime: number): boolean => {
            if (!state.playbackState.loaded) {
                return false;
            }

            const normalizedCurrentTime = normalizeCurrentTime(nextCurrentTime);
            if (Math.abs(normalizedCurrentTime - state.playbackState.currentTime) < 0.001) {
                return false;
            }

            state.playbackState = {
                ...state.playbackState,
                currentTime: normalizedCurrentTime,
            };
            return true;
        },
        setBackendReady: (ready: boolean): void => {
            state.backendReady = ready;
        },
    };
};