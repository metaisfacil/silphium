import { AudioGetReplayGainReleaseDynamicRange } from '../wailsjs/go/main/App';
import type { ImageLibraryFile, Track } from './types/app-types';
import { libraryFolderPathKey } from './utils/main-helpers';

export const createAppReleaseRuntime = (context: any) => {
    const releaseRootPathForTrack = (track: Track): string => {
        const normalizedFolderPath = track.folderPath || '';
        const segments = normalizedFolderPath.split('/').filter((segment) => segment !== '');
        if (segments.length === 0) {
            return '';
        }

        const releaseDepth = context.releaseDepthForTrack(track);
        const relativeSegments = track.rootName ? segments.slice(1) : segments;
        if (releaseDepth <= 0 || relativeSegments.length === 0 || releaseDepth >= relativeSegments.length) {
            return normalizedFolderPath;
        }

        const scopedSegments = track.rootName
            ? [segments[0], ...relativeSegments.slice(0, releaseDepth)]
            : relativeSegments.slice(0, releaseDepth);

        return scopedSegments.join('/');
    };

    const replayGainReleaseKeyForTrack = (track: Track): string => {
        const releaseRootPath = releaseRootPathForTrack(track).trim().toLowerCase();
        if (!releaseRootPath) {
            return '';
        }

        return `${libraryFolderPathKey(track.rootPath || '')}::${releaseRootPath}`;
    };

    const replayGainReleaseTrackPaths = (releaseKey: string): string[] => context.tracks
        .filter((candidate: Track) => replayGainReleaseKeyForTrack(candidate) === releaseKey)
        .sort((left: Track, right: Track) => left.relativePath.localeCompare(right.relativePath, undefined, {
            sensitivity: 'base',
            numeric: true,
        }))
        .map((candidate: Track) => candidate.path);

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

        return collectReplayGainReleaseTrackPathsForIndex(context.currentTrackIndex, sequenceOverrideIndexes);
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

    const cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack = (): string => {
        if (!context.currentSettings.audio.replayGainEnabled || context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return '';
        }

        const releasePaths = currentReplayGainReleaseTrackPaths();
        if (releasePaths.length <= 1) {
            return '';
        }

        return context.replayGainReleaseDynamicRangeLabelByKey.get(replayGainReleaseDynamicRangeCacheKey(releasePaths)) || '';
    };

    const refreshReplayGainReleaseDynamicRangeIndicator = async (): Promise<void> => {
        const requestVersion = ++context.replayGainReleaseDynamicRangeRequestVersion;
        if (!context.currentSettings.audio.replayGainEnabled || context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            context.updateNowPlayingTechnicalLabels();
            return;
        }

        const releasePaths = currentReplayGainReleaseTrackPaths();
        if (releasePaths.length <= 1) {
            context.updateNowPlayingTechnicalLabels();
            return;
        }

        const cacheKey = replayGainReleaseDynamicRangeCacheKey(releasePaths);
        if (context.replayGainReleaseDynamicRangeLabelByKey.has(cacheKey)) {
            context.updateNowPlayingTechnicalLabels();
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

        await pendingLookup;
        if (requestVersion !== context.replayGainReleaseDynamicRangeRequestVersion) {
            return;
        }

        const latestReleasePaths = context.currentSettings.audio.replayGainEnabled && context.currentTrackIndex >= 0 && context.currentTrackIndex < context.tracks.length
            ? currentReplayGainReleaseTrackPaths()
            : [];
        if (replayGainReleaseDynamicRangeCacheKey(latestReleasePaths) !== cacheKey) {
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
    };
};