import { AudioGetReplayGainReleaseDynamicRange } from '../wailsjs/go/main/App';
import type { AppSettings, ImageLibraryFile, Track } from './types/app-types';
import { libraryFolderPathKey, releaseFolderPathForTrackAtDepth } from './utils/main-helpers';

type AppReleaseRuntimeContext = {
    tracks: Track[];
    imageFiles: ImageLibraryFile[];
    currentTrackIndex: number;
    currentSettings: {
        audio: Pick<AppSettings['audio'], 'replayGainEnabled'>;
    };
    activeReplayGainReleaseTrackPaths: string[];
    replayGainReleaseDynamicRangeLabelByKey: Map<string, string>;
    replayGainReleaseDynamicRangePendingByKey: Map<string, Promise<string>>;
    replayGainReleaseDynamicRangeRequestVersion: number;
    releaseDepthForTrack: (track: Track) => number;
    playlistController?: {
        getSequenceOverride: () => { indexes: number[] } | null;
    };
    baseSequenceIndexes: () => { indexes: number[] };
    trackPathKey: (path: string) => string;
    updateNowPlayingTechnicalLabels: () => void;
};

export const createAppReleaseRuntime = (context: AppReleaseRuntimeContext) => {
    let cachedReleaseTrackPathsTracks: Track[] | null = null;
    let cachedReleaseTrackPathsLength = -1;
    const cachedReleaseTrackPathsByKey = new Map<string, string[]>();

    const releaseRootPathForTrack = (track: Track): string => {
        const releaseDepth = context.releaseDepthForTrack(track);
        return releaseFolderPathForTrackAtDepth(track, releaseDepth);
    };

    const replayGainReleaseKeyForTrack = (track: Track): string => {
        const releaseRootPath = releaseRootPathForTrack(track).trim().toLowerCase();
        if (!releaseRootPath) {
            return '';
        }

        return `${libraryFolderPathKey(track.rootPath || '')}::${releaseRootPath}`;
    };

    const ensureReplayGainReleaseTrackPathsCache = (): void => {
        if (cachedReleaseTrackPathsTracks === context.tracks && cachedReleaseTrackPathsLength === context.tracks.length) {
            return;
        }

        cachedReleaseTrackPathsTracks = context.tracks;
        cachedReleaseTrackPathsLength = context.tracks.length;
        cachedReleaseTrackPathsByKey.clear();
    };

    const replayGainReleaseTrackPaths = (releaseKey: string): string[] => {
        if (!releaseKey) {
            return [];
        }

        ensureReplayGainReleaseTrackPathsCache();
        const cachedReleaseTrackPaths = cachedReleaseTrackPathsByKey.get(releaseKey);
        if (cachedReleaseTrackPaths) {
            return cachedReleaseTrackPaths;
        }

        const releaseTrackPaths = context.tracks
            .filter((candidate: Track) => replayGainReleaseKeyForTrack(candidate) === releaseKey)
            .sort((left: Track, right: Track) => left.relativePath.localeCompare(right.relativePath, undefined, {
                sensitivity: 'base',
                numeric: true,
            }))
            .map((candidate: Track) => candidate.path);
        cachedReleaseTrackPathsByKey.set(releaseKey, releaseTrackPaths);
        return releaseTrackPaths;
    };

    const replayGainReleaseTrackPathsForIndex = (trackIndex: number): string[] => {
        const track = context.tracks[trackIndex];
        if (!track) {
            return [];
        }

        const releaseKey = replayGainReleaseKeyForTrack(track);
        if (!releaseKey) {
            return [];
        }

        const releasePaths = replayGainReleaseTrackPaths(releaseKey);
        return releasePaths.length > 1 ? releasePaths : [];
    };

    const normalizeReplayGainSequenceIndexes = (indexes: number[]): number[] => {
        const normalized: number[] = [];
        const seen = new Set<number>();
        for (const index of indexes) {
            if (!Number.isInteger(index) || index < 0 || index >= context.tracks.length || seen.has(index)) {
                continue;
            }

            seen.add(index);
            normalized.push(index);
        }

        return normalized;
    };

    const playbackSequenceIndexesForReplayGain = (sequenceOverrideIndexes?: number[]): number[] => {
        if (Array.isArray(sequenceOverrideIndexes) && sequenceOverrideIndexes.length > 0) {
            return normalizeReplayGainSequenceIndexes(sequenceOverrideIndexes);
        }

        const sequenceOverride = context.playlistController?.getSequenceOverride();
        if (sequenceOverride && sequenceOverride.indexes.length > 0) {
            return normalizeReplayGainSequenceIndexes(sequenceOverride.indexes);
        }

        return normalizeReplayGainSequenceIndexes(context.baseSequenceIndexes().indexes);
    };

    const collectReplayGainReleaseTrackPathsForIndex = (trackIndex: number, sequenceOverrideIndexes?: number[]): string[] => {
        const track = context.tracks[trackIndex];
        if (!track) {
            return [];
        }

        const releaseKey = replayGainReleaseKeyForTrack(track);
        if (!releaseKey) {
            return [];
        }

        const sequenceIndexes = playbackSequenceIndexesForReplayGain(sequenceOverrideIndexes);
        const sequencePosition = sequenceIndexes.indexOf(trackIndex);
        if (sequencePosition < 0) {
            return [];
        }

        let rangeStart = sequencePosition;
        while (rangeStart > 0) {
            const previousTrack = context.tracks[sequenceIndexes[rangeStart - 1]];
            if (!previousTrack || replayGainReleaseKeyForTrack(previousTrack) !== releaseKey) {
                break;
            }
            rangeStart -= 1;
        }

        let rangeEnd = sequencePosition;
        while (rangeEnd < sequenceIndexes.length - 1) {
            const nextTrack = context.tracks[sequenceIndexes[rangeEnd + 1]];
            if (!nextTrack || replayGainReleaseKeyForTrack(nextTrack) !== releaseKey) {
                break;
            }
            rangeEnd += 1;
        }

        if (rangeStart === rangeEnd) {
            return [];
        }

        const releasePaths = replayGainReleaseTrackPaths(releaseKey);
        if (releasePaths.length <= 1) {
            return [];
        }

        const queuedReleaseTrackCount = rangeEnd - rangeStart + 1;
        if (queuedReleaseTrackCount !== releasePaths.length) {
            return [];
        }

        return releasePaths;
    };

    const currentReplayGainReleaseTrackPaths = (sequenceOverrideIndexes?: number[]): string[] => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return [];
        }

        const activeTrackPath = context.trackPathKey(context.tracks[context.currentTrackIndex]?.path || '');
        if (
            context.activeReplayGainReleaseTrackPaths.length > 1
            && activeTrackPath !== ''
            && context.activeReplayGainReleaseTrackPaths.some((path: string) => context.trackPathKey(path) === activeTrackPath)
        ) {
            return context.activeReplayGainReleaseTrackPaths;
        }

        const releasePaths = collectReplayGainReleaseTrackPathsForIndex(context.currentTrackIndex, sequenceOverrideIndexes);
        if (releasePaths.length > 1) {
            context.activeReplayGainReleaseTrackPaths = releasePaths;
        }
        return releasePaths;
    };

    const replayGainReleaseDynamicRangeCacheKey = (releasePaths: string[]): string => releasePaths
        .map((path) => path.trim().toLowerCase())
        .filter((path) => path !== '')
        .join('\n');

    const clearReplayGainReleaseDynamicRangeCache = (): void => {
        context.replayGainReleaseDynamicRangeLabelByKey.clear();
        context.replayGainReleaseDynamicRangePendingByKey.clear();
        context.replayGainReleaseDynamicRangeRequestVersion += 1;
    };

    const cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack = (releasePathsOverride?: string[]): string => {
        if (!context.currentSettings.audio.replayGainEnabled || context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return '';
        }

        const releasePaths = releasePathsOverride ?? currentReplayGainReleaseTrackPaths();
        if (releasePaths.length <= 1) {
            return '';
        }

        return context.replayGainReleaseDynamicRangeLabelByKey.get(replayGainReleaseDynamicRangeCacheKey(releasePaths)) || '';
    };

    const refreshReplayGainReleaseDynamicRangeIndicator = async (releasePathsOverride?: string[]): Promise<void> => {
        const requestVersion = ++context.replayGainReleaseDynamicRangeRequestVersion;
        if (!context.currentSettings.audio.replayGainEnabled || context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        const releasePaths = releasePathsOverride ?? currentReplayGainReleaseTrackPaths();
        if (releasePaths.length <= 1) {
            return;
        }

        const cacheKey = replayGainReleaseDynamicRangeCacheKey(releasePaths);
        if (context.replayGainReleaseDynamicRangeLabelByKey.has(cacheKey)) {
            return;
        }

        let pendingLookup = context.replayGainReleaseDynamicRangePendingByKey.get(cacheKey);
        if (!pendingLookup) {
            pendingLookup = AudioGetReplayGainReleaseDynamicRange(releasePaths)
                .then((dynamicRange) => {
                    const label = Number.isInteger(dynamicRange) && dynamicRange > 0 ? `DR${dynamicRange}` : '';
                    context.replayGainReleaseDynamicRangeLabelByKey.set(cacheKey, label);
                    context.replayGainReleaseDynamicRangePendingByKey.delete(cacheKey);
                    return label;
                })
                .catch((error: unknown) => {
                    console.debug(error);
                    context.replayGainReleaseDynamicRangeLabelByKey.set(cacheKey, '');
                    context.replayGainReleaseDynamicRangePendingByKey.delete(cacheKey);
                    return '';
                });
            context.replayGainReleaseDynamicRangePendingByKey.set(cacheKey, pendingLookup);
        }

        const resolvedLabel = await pendingLookup;
        if (requestVersion !== context.replayGainReleaseDynamicRangeRequestVersion) {
            return;
        }

        const latestReleasePaths = context.currentSettings.audio.replayGainEnabled && context.currentTrackIndex >= 0 && context.currentTrackIndex < context.tracks.length
            ? currentReplayGainReleaseTrackPaths()
            : [];
        if (replayGainReleaseDynamicRangeCacheKey(latestReleasePaths) !== cacheKey) {
            return;
        }

        if (!resolvedLabel) {
            return;
        }

        context.updateNowPlayingTechnicalLabels();
    };

    const collectReleaseImageFiles = (track: Track): ImageLibraryFile[] => {
        const releaseRootPath = releaseRootPathForTrack(track);
        const releaseRootPathLower = releaseRootPath.toLowerCase();
        const prefix = releaseRootPathLower ? `${releaseRootPathLower}/` : '';
        const trackRootPathKey = libraryFolderPathKey(track.rootPath || '');

        return context.imageFiles
            .filter((candidate: ImageLibraryFile) => {
                if (libraryFolderPathKey(candidate.rootPath || '') !== trackRootPathKey) {
                    return false;
                }

                const candidateFolderPath = (candidate.folderPath || '').toLowerCase();
                if (!releaseRootPathLower) {
                    return candidateFolderPath === '';
                }

                return candidateFolderPath === releaseRootPathLower || candidateFolderPath.startsWith(prefix);
            })
            .sort((left: ImageLibraryFile, right: ImageLibraryFile) => left.relativePath.localeCompare(right.relativePath, undefined, {
                sensitivity: 'base',
                numeric: true,
            }));
    };

    const indexOfImageByPath = (gallery: ImageLibraryFile[], candidatePath?: string): number => {
        if (!candidatePath) {
            return -1;
        }

        const normalizedPath = candidatePath.toLowerCase();
        return gallery.findIndex((candidate) => candidate.path.toLowerCase() === normalizedPath);
    };

    return {
        cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack,
        clearReplayGainReleaseDynamicRangeCache,
        collectReleaseImageFiles,
        collectReplayGainReleaseTrackPathsForIndex,
        currentReplayGainReleaseTrackPaths,
        indexOfImageByPath,
        refreshReplayGainReleaseDynamicRangeIndicator,
        releaseRootPathForTrack,
        replayGainReleaseDynamicRangeCacheKey,
        replayGainReleaseKeyForTrack,
        replayGainReleaseTrackPaths,
        replayGainReleaseTrackPathsForIndex,
    };
};