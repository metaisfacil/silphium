import type { AudioPlaybackState } from '../types/app-types';

type PlaybackReconcileDelayState = Pick<AudioPlaybackState, 'currentTime' | 'duration' | 'loaded' | 'playing'>;

export const playbackReconcileNearEndPollIntervalMs = 500;
export const playbackReconcileNearEndThresholdSeconds = 3;
export const playbackReconcileMaxPollIntervalMs = 2000;
export const playbackReconcileUnknownDurationPollIntervalMs = playbackReconcileMaxPollIntervalMs;
const maxTimerDelayMs = 2147483647;

export const playbackReconcileDelayMs = (playbackState: PlaybackReconcileDelayState): number | null => {
    if (!playbackState.loaded || !playbackState.playing) {
        return null;
    }

    if (!Number.isFinite(playbackState.duration) || playbackState.duration <= 0) {
        return playbackReconcileUnknownDurationPollIntervalMs;
    }

    const remainingSeconds = Math.max(0, playbackState.duration - playbackState.currentTime);
    if (remainingSeconds <= playbackReconcileNearEndThresholdSeconds) {
        return playbackReconcileNearEndPollIntervalMs;
    }

    return Math.min(
        maxTimerDelayMs,
        playbackReconcileMaxPollIntervalMs,
        Math.max(
            playbackReconcileNearEndPollIntervalMs,
            Math.ceil((remainingSeconds - playbackReconcileNearEndThresholdSeconds) * 1000),
        ),
    );
};