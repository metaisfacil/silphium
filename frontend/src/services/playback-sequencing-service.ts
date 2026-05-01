import type { PlaybackOrderMode, Track } from '../types/app-types';
import { isPlaybackQueueEligibleTrack } from '../utils/display-helpers';
import { releaseFolderPathForTrackAtDepth } from '../utils/main-helpers';

type PlaybackSequencingServiceOptions = {
    getTracks: () => Track[];
    getCurrentTrackIndex: () => number;
    getReleaseDepthForTrack: (track: Track) => number;
    initialPlaybackOrderMode?: PlaybackOrderMode;
};

const playbackOrderLabelByMode: Record<PlaybackOrderMode, string> = {
    'ordered-album': 'Ordered: Album',
    'ordered-library': 'Ordered: Library',
    'shuffle-album': 'Shuffle: Album',
    'shuffle-library': 'Shuffle: Library',
};

export type PlaybackSequencingState = {
    playbackOrderMode: PlaybackOrderMode;
    shuffleHistory: number[];
    shuffleCursor: number;
    shuffleScopeKey: string;
};

export type PlaybackSequenceSource = {
    key: string;
    indexes: number[];
};

export const createPlaybackSequencingState = (initialPlaybackOrderMode: PlaybackOrderMode = 'ordered-library'): PlaybackSequencingState => ({
    playbackOrderMode: initialPlaybackOrderMode,
    shuffleHistory: [],
    shuffleCursor: -1,
    shuffleScopeKey: '',
});

export type PlaybackSequencingService = ReturnType<typeof createPlaybackSequencingService>;

export const createPlaybackSequencingService = (
    options: PlaybackSequencingServiceOptions,
    state: PlaybackSequencingState = createPlaybackSequencingState(options.initialPlaybackOrderMode),
) => {

    const albumScopePathForTrack = (track: Track): string => {
        const releaseDepth = options.getReleaseDepthForTrack(track);
        return releaseFolderPathForTrackAtDepth(track, releaseDepth).toLowerCase();
    };

    const albumScopeKeyForTrack = (track: Track): string => `folder::${albumScopePathForTrack(track)}`;

    const queueEligibleTrackEntries = (): Array<{ track: Track; index: number }> => {
        return options.getTracks()
            .map((track, index) => ({ track, index }))
            .filter(({ track }) => isPlaybackQueueEligibleTrack(track));
    };

    const queueEligibleTrackIndexesForSource = (source: PlaybackSequenceSource): number[] => {
        const tracks = options.getTracks();
        return source.indexes.filter((trackIndex) => {
            if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= tracks.length) {
                return false;
            }

            return isPlaybackQueueEligibleTrack(tracks[trackIndex]);
        });
    };

    const orderedTrackIndexesForScope = (source?: PlaybackSequenceSource): number[] => {
        if (source) {
            const eligibleIndexes = queueEligibleTrackIndexesForSource(source);
            if (eligibleIndexes.length === 0) {
                return [];
            }

            if (state.playbackOrderMode === 'ordered-library' || state.playbackOrderMode === 'shuffle-library') {
                return eligibleIndexes;
            }

            const tracks = options.getTracks();
            const currentTrackIndex = options.getCurrentTrackIndex();
            const current = tracks[currentTrackIndex];
            if (!current) {
                return [];
            }

            const albumScopeKey = albumScopeKeyForTrack(current);
            return eligibleIndexes.filter((trackIndex) => {
                const track = tracks[trackIndex];
                return !!track && albumScopeKeyForTrack(track) === albumScopeKey;
            });
        }

        const eligibleTracks = queueEligibleTrackEntries();
        if (eligibleTracks.length === 0) {
            return [];
        }

        if (state.playbackOrderMode === 'ordered-library' || state.playbackOrderMode === 'shuffle-library') {
            return eligibleTracks.map(({ index }) => index);
        }

        const tracks = options.getTracks();

        const currentTrackIndex = options.getCurrentTrackIndex();
        const current = tracks[currentTrackIndex];
        if (!current) {
            return [];
        }

        const albumScopeKey = albumScopeKeyForTrack(current);
        return eligibleTracks
            .filter(({ track }) => albumScopeKeyForTrack(track) === albumScopeKey)
            .sort((left, right) => {
                return left.track.name.localeCompare(right.track.name, undefined, {
                    sensitivity: 'base',
                    numeric: true,
                });
            })
            .map(({ index }) => index);
    };

    const isShuffleMode = (): boolean => state.playbackOrderMode === 'shuffle-album' || state.playbackOrderMode === 'shuffle-library';

    const currentShuffleScopeKey = (source?: PlaybackSequenceSource): string => {
        if (source) {
            if (state.playbackOrderMode === 'shuffle-library') {
                return `source::${source.key}`;
            }

            const tracks = options.getTracks();
            const currentTrackIndex = options.getCurrentTrackIndex();
            const current = tracks[currentTrackIndex];
            if (!current) {
                return `source::${source.key}::album::none`;
            }

            return `source::${source.key}::album::${albumScopeKeyForTrack(current)}`;
        }

        if (state.playbackOrderMode === 'shuffle-library') {
            return 'library';
        }

        const tracks = options.getTracks();
        const currentTrackIndex = options.getCurrentTrackIndex();
        const current = tracks[currentTrackIndex];
        if (!current) {
            return 'album::none';
        }

        return `album::${albumScopeKeyForTrack(current)}`;
    };

    const resetShuffleHistory = (): void => {
        state.shuffleHistory = [];
        state.shuffleCursor = -1;
        state.shuffleScopeKey = '';
    };

    const syncShuffleCursorToCurrentTrack = (orderedIndexes: number[]): void => {
        const currentTrackIndex = options.getCurrentTrackIndex();
        if (currentTrackIndex < 0) {
            return;
        }

        const existingPosition = state.shuffleHistory.lastIndexOf(currentTrackIndex);
        if (existingPosition >= 0) {
            state.shuffleCursor = existingPosition;
            return;
        }

        // Gapless transitions can advance the backend source before the frontend
        // calls nextTrackIndexForDirection, so append the externally advanced
        // current track and move the cursor forward to keep history aligned.
        if (orderedIndexes.includes(currentTrackIndex)) {
            state.shuffleHistory.push(currentTrackIndex);
            state.shuffleCursor = state.shuffleHistory.length - 1;
        }
    };

    const pickRandomTrackIndex = (candidates: number[], currentIndex: number): number => {
        if (candidates.length === 0) {
            return currentIndex;
        }

        if (candidates.length === 1) {
            return candidates[0];
        }

        const withoutCurrent = candidates.filter((index) => index !== currentIndex);
        const pool = withoutCurrent.length > 0 ? withoutCurrent : candidates;
        return pool[Math.floor(Math.random() * pool.length)];
    };

    const sanitizeShuffleHistory = (orderedIndexes: number[]): void => {
        if (orderedIndexes.length === 0) {
            state.shuffleHistory = [];
            state.shuffleCursor = -1;
            return;
        }

        const eligibleIndexSet = new Set(orderedIndexes);
        const previousHistory = state.shuffleHistory;
        const previousCursor = state.shuffleCursor;
        const filteredHistory = previousHistory.filter((trackIndex) => eligibleIndexSet.has(trackIndex));
        if (filteredHistory.length === previousHistory.length) {
            if (state.shuffleCursor >= filteredHistory.length) {
                state.shuffleCursor = filteredHistory.length - 1;
            }
            return;
        }

        let nextCursor = -1;
        if (previousCursor >= 0) {
            let retainedBeforeOrAtCursor = 0;
            for (let index = 0; index <= previousCursor && index < previousHistory.length; index += 1) {
                if (eligibleIndexSet.has(previousHistory[index])) {
                    retainedBeforeOrAtCursor += 1;
                }
            }

            if (retainedBeforeOrAtCursor > 0) {
                nextCursor = retainedBeforeOrAtCursor - 1;
            }
        }

        state.shuffleHistory = filteredHistory;
        state.shuffleCursor = nextCursor >= 0 ? Math.min(nextCursor, filteredHistory.length - 1) : -1;
    };

    const seedShuffleHistory = (orderedIndexes: number[]): void => {
        if (orderedIndexes.length === 0) {
            state.shuffleHistory = [];
            state.shuffleCursor = -1;
            return;
        }

        const currentTrackIndex = options.getCurrentTrackIndex();
        const seedIndex = orderedIndexes.includes(currentTrackIndex) ? currentTrackIndex : orderedIndexes[0];
        state.shuffleHistory = [seedIndex];
        state.shuffleCursor = 0;
    };

    const prepareShuffleHistory = (orderedIndexes: number[], source?: PlaybackSequenceSource): void => {
        const scopeKey = currentShuffleScopeKey(source);
        if (state.shuffleScopeKey !== scopeKey) {
            state.shuffleScopeKey = scopeKey;
            state.shuffleHistory = [];
            state.shuffleCursor = -1;
        }

        sanitizeShuffleHistory(orderedIndexes);
        if (state.shuffleCursor < 0) {
            seedShuffleHistory(orderedIndexes);
        }

        syncShuffleCursorToCurrentTrack(orderedIndexes);
        sanitizeShuffleHistory(orderedIndexes);
        if (state.shuffleCursor < 0) {
            seedShuffleHistory(orderedIndexes);
        }
    };

    const ensureShuffleFutureTracks = (count: number, source?: PlaybackSequenceSource): void => {
        if (!isShuffleMode()) {
            return;
        }

        const orderedIndexes = orderedTrackIndexesForScope(source);
        if (orderedIndexes.length === 0) {
            return;
        }

        prepareShuffleHistory(orderedIndexes, source);

        while (state.shuffleHistory.length - state.shuffleCursor - 1 < count) {
            const currentIndex = state.shuffleHistory[state.shuffleHistory.length - 1];
            const nextIndex = pickRandomTrackIndex(orderedIndexes, currentIndex);
            state.shuffleHistory.push(nextIndex);
        }
    };

    const baseSequenceIndexes = (source?: PlaybackSequenceSource): { indexes: number[]; currentPosition: number } => {
        if (isShuffleMode()) {
            ensureShuffleFutureTracks(50, source);
            return {
                indexes: state.shuffleHistory,
                currentPosition: state.shuffleCursor >= 0 ? state.shuffleCursor : 0,
            };
        }

        const indexes = orderedTrackIndexesForScope(source);
        const currentPosition = indexes.indexOf(options.getCurrentTrackIndex());
        return {
            indexes,
            currentPosition: currentPosition >= 0 ? currentPosition : 0,
        };
    };

    const nextTrackIndexForDirection = (direction: -1 | 1, source?: PlaybackSequenceSource): number | undefined => {
        const orderedIndexes = orderedTrackIndexesForScope(source);
        if (orderedIndexes.length === 0) {
            return undefined;
        }

        if (!isShuffleMode()) {
            const currentPosition = orderedIndexes.indexOf(options.getCurrentTrackIndex());
            if (currentPosition < 0) {
                return orderedIndexes[0];
            }

            const nextPosition = (currentPosition + direction + orderedIndexes.length) % orderedIndexes.length;
            return orderedIndexes[nextPosition];
        }

        prepareShuffleHistory(orderedIndexes, source);

        if (direction < 0) {
            if (state.shuffleCursor > 0) {
                state.shuffleCursor -= 1;
            }

            return state.shuffleHistory[state.shuffleCursor];
        }

        if (state.shuffleCursor < state.shuffleHistory.length - 1) {
            state.shuffleCursor += 1;
            return state.shuffleHistory[state.shuffleCursor];
        }

        const currentIndex = state.shuffleHistory[state.shuffleCursor];
        const nextIndex = pickRandomTrackIndex(orderedIndexes, currentIndex);
        state.shuffleHistory.push(nextIndex);
        state.shuffleCursor += 1;
        return nextIndex;
    };

    const peekNextTrackIndexForDirection = (direction: -1 | 1, source?: PlaybackSequenceSource): number | undefined => {
        const orderedIndexes = orderedTrackIndexesForScope(source);
        if (orderedIndexes.length === 0) {
            return undefined;
        }

        if (!isShuffleMode()) {
            const currentPosition = orderedIndexes.indexOf(options.getCurrentTrackIndex());
            if (currentPosition < 0) {
                return orderedIndexes[0];
            }

            const nextPosition = (currentPosition + direction + orderedIndexes.length) % orderedIndexes.length;
            return orderedIndexes[nextPosition];
        }

        prepareShuffleHistory(orderedIndexes, source);

        if (direction < 0) {
            if (state.shuffleCursor > 0) {
                return state.shuffleHistory[state.shuffleCursor - 1];
            }

            return state.shuffleHistory[state.shuffleCursor];
        }

        // Keep peek deterministic for gapless prequeue: generate and cache one future item if needed.
        ensureShuffleFutureTracks(1, source);
        if (state.shuffleCursor < state.shuffleHistory.length - 1) {
            return state.shuffleHistory[state.shuffleCursor + 1];
        }

        return state.shuffleHistory[state.shuffleCursor];
    };

    return {
        baseSequenceIndexes,
        getPlaybackOrderLabel: (): string => playbackOrderLabelByMode[state.playbackOrderMode],
        getPlaybackOrderMode: (): PlaybackOrderMode => state.playbackOrderMode,
        nextTrackIndexForDirection,
        peekNextTrackIndexForDirection,
        resetShuffleHistory,
        setPlaybackOrderMode: (nextMode: PlaybackOrderMode): boolean => {
            if (state.playbackOrderMode === nextMode) {
                return false;
            }

            state.playbackOrderMode = nextMode;
            resetShuffleHistory();
            return true;
        },
    };
};