import type { AudioPlaybackState } from '../types/app-types';

const createDefaultPlaybackState = (): AudioPlaybackState => ({
    loaded: false,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 0,
    sourcePath: '',
    endEventId: 0,
});

export const createPlaybackProgressEstimator = (nowMs: () => number = () => performance.now()) => {
    let anchorState: AudioPlaybackState = createDefaultPlaybackState();
    let anchorAtMs = nowMs();

    return {
        estimate: (): AudioPlaybackState => {
            if (!anchorState.loaded || !anchorState.playing) {
                return anchorState;
            }

            const elapsedSeconds = Math.max(0, (nowMs() - anchorAtMs) / 1000);
            const unclampedCurrentTime = anchorState.currentTime + elapsedSeconds;
            const nextCurrentTime = Number.isFinite(anchorState.duration) && anchorState.duration > 0
                ? Math.min(anchorState.duration, unclampedCurrentTime)
                : Math.max(0, unclampedCurrentTime);

            if (Math.abs(nextCurrentTime - anchorState.currentTime) < 0.001) {
                return anchorState;
            }

            return {
                ...anchorState,
                currentTime: nextCurrentTime,
            };
        },
        sync: (state: AudioPlaybackState): void => {
            anchorState = state;
            anchorAtMs = nowMs();
        },
    };
};