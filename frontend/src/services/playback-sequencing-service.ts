import type { PlaybackOrderMode, Track } from '../types/app-types';

type PlaybackSequencingServiceOptions = {
    getTracks: () => Track[];
    getCurrentTrackIndex: () => number;
    getReleaseDepth: () => number;
    initialPlaybackOrderMode?: PlaybackOrderMode;
};

const playbackOrderLabelByMode: Record<PlaybackOrderMode, string> = {
    'ordered-album': 'Ordered (album)',
    'ordered-library': 'Ordered (library)',
    'shuffle-album': 'Shuffle (album)',
    'shuffle-library': 'Shuffle (library)',
};

export type PlaybackSequencingService = ReturnType<typeof createPlaybackSequencingService>;

export const createPlaybackSequencingService = (options: PlaybackSequencingServiceOptions) => {
    let playbackOrderMode: PlaybackOrderMode = options.initialPlaybackOrderMode || 'ordered-library';
    let shuffleHistory: number[] = [];
    let shuffleCursor = -1;
    let shuffleScopeKey = '';

    const albumScopePathForTrack = (track: Track): string => {
        const folderPath = track.folderPath || '';
        const releaseDepth = options.getReleaseDepth();
        if (releaseDepth <= 0) {
            return folderPath.toLowerCase();
        }

        const segments = folderPath
            .split('/')
            .filter((segment) => segment !== '');

        if (segments.length === 0) {
            return '';
        }

        return segments.slice(0, releaseDepth).join('/').toLowerCase();
    };

    const albumScopeKeyForTrack = (track: Track): string => `folder::${albumScopePathForTrack(track)}`;

    const orderedTrackIndexesForScope = (): number[] => {
        const tracks = options.getTracks();
        if (tracks.length === 0) {
            return [];
        }

        if (playbackOrderMode === 'ordered-library' || playbackOrderMode === 'shuffle-library') {
            return tracks.map((_, index) => index);
        }

        const currentTrackIndex = options.getCurrentTrackIndex();
        const current = tracks[currentTrackIndex];
        if (!current) {
            return [];
        }

        const albumScopeKey = albumScopeKeyForTrack(current);
        return tracks
            .map((track, index) => ({ track, index }))
            .filter(({ track }) => albumScopeKeyForTrack(track) === albumScopeKey)
            .sort((left, right) => {
                return left.track.name.localeCompare(right.track.name, undefined, {
                    sensitivity: 'base',
                    numeric: true,
                });
            })
            .map(({ index }) => index);
    };

    const isShuffleMode = (): boolean => playbackOrderMode === 'shuffle-album' || playbackOrderMode === 'shuffle-library';

    const currentShuffleScopeKey = (): string => {
        if (playbackOrderMode === 'shuffle-library') {
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
        shuffleHistory = [];
        shuffleCursor = -1;
        shuffleScopeKey = '';
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

    const ensureShuffleFutureTracks = (count: number): void => {
        if (!isShuffleMode()) {
            return;
        }

        const orderedIndexes = orderedTrackIndexesForScope();
        if (orderedIndexes.length === 0) {
            return;
        }

        const scopeKey = currentShuffleScopeKey();
        if (shuffleScopeKey !== scopeKey) {
            shuffleScopeKey = scopeKey;
            shuffleHistory = [];
            shuffleCursor = -1;
        }

        const currentTrackIndex = options.getCurrentTrackIndex();
        if (shuffleCursor < 0) {
            shuffleHistory.push(currentTrackIndex >= 0 ? currentTrackIndex : orderedIndexes[0]);
            shuffleCursor = 0;
        }

        while (shuffleHistory.length - shuffleCursor - 1 < count) {
            const currentIndex = shuffleHistory[shuffleHistory.length - 1];
            const nextIndex = pickRandomTrackIndex(orderedIndexes, currentIndex);
            shuffleHistory.push(nextIndex);
        }
    };

    const baseSequenceIndexes = (): { indexes: number[]; currentPosition: number } => {
        if (isShuffleMode()) {
            ensureShuffleFutureTracks(50);
            return {
                indexes: shuffleHistory,
                currentPosition: shuffleCursor >= 0 ? shuffleCursor : 0,
            };
        }

        const indexes = orderedTrackIndexesForScope();
        const currentPosition = indexes.indexOf(options.getCurrentTrackIndex());
        return {
            indexes,
            currentPosition: currentPosition >= 0 ? currentPosition : 0,
        };
    };

    const nextTrackIndexForDirection = (direction: -1 | 1): number | undefined => {
        const orderedIndexes = orderedTrackIndexesForScope();
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

        const scopeKey = currentShuffleScopeKey();
        if (shuffleScopeKey !== scopeKey) {
            shuffleScopeKey = scopeKey;
            shuffleHistory = [];
            shuffleCursor = -1;
        }

        const currentTrackIndex = options.getCurrentTrackIndex();
        if (shuffleCursor < 0) {
            shuffleHistory.push(currentTrackIndex >= 0 ? currentTrackIndex : orderedIndexes[0]);
            shuffleCursor = 0;
        }

        if (direction < 0) {
            if (shuffleCursor > 0) {
                shuffleCursor -= 1;
            }

            return shuffleHistory[shuffleCursor];
        }

        if (shuffleCursor < shuffleHistory.length - 1) {
            shuffleCursor += 1;
            return shuffleHistory[shuffleCursor];
        }

        const currentIndex = shuffleHistory[shuffleCursor];
        const nextIndex = pickRandomTrackIndex(orderedIndexes, currentIndex);
        shuffleHistory.push(nextIndex);
        shuffleCursor += 1;
        return nextIndex;
    };

    return {
        baseSequenceIndexes,
        getPlaybackOrderLabel: (): string => playbackOrderLabelByMode[playbackOrderMode],
        getPlaybackOrderMode: (): PlaybackOrderMode => playbackOrderMode,
        nextTrackIndexForDirection,
        resetShuffleHistory,
        setPlaybackOrderMode: (nextMode: PlaybackOrderMode): boolean => {
            if (playbackOrderMode === nextMode) {
                return false;
            }

            playbackOrderMode = nextMode;
            resetShuffleHistory();
            return true;
        },
    };
};