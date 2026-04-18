import type {
    ImageLibraryFile,
    LibraryIndexedFile,
    LibraryScanResult,
    TextLibraryFile,
    Track,
} from '../types/app-types';

export type ScanCollections = {
    coverPathEntries: Array<[string, string]>;
    imageFiles: ImageLibraryFile[];
    textFiles: TextLibraryFile[];
    tracks: Track[];
};

export type ScanCollectionKind = 'track' | 'text-file' | 'image-file';

type MergePlaylistFilesResult = {
    trackIndexes: number[];
    tracks: Track[];
};

type ClearLibraryRuntimeDataOptions = {
    objectUrls: string[];
    clearCoverArtCache?: () => void;
    clearArtistInfoCache: () => void;
    clearImageModalCache?: () => void;
    resetLibraryState: () => void;
    resetPlaylistState: () => void;
};

const BATCH_SIZES = {
    indexedFiles: 400,
    playlistFiles: 200,
} as const;

const createPlaceholderTrack = (file: LibraryIndexedFile): Track => ({
    title: file.cachedTrackTitle || file.name,
    name: file.name,
    path: file.path,
    relativePath: file.relativePath || file.name,
    folderPath: file.folderPath || '',
    rootPath: file.rootPath || '',
    rootName: file.rootName || '',
    releaseDepth: file.releaseDepth,
    displayTitle: file.cachedTrackTitle || file.name,
    displayAlbum: file.cachedAlbumTitle || 'Unknown Album',
    displayArtist: file.cachedArtistName || 'Unknown Artist',
    displayTrackNumber: file.cachedTrackNumber || '',
    displayTrackTotal: file.cachedTrackTotal || '',
    displayTechnical: '',
    displayLyrics: '',
    tagsResolved: false,
    mbMetadataResolved: false,
    technicalDetails: {},
    allFileTags: {},
    mbIds: {},
    artistMbids: [],
    mbArtistCredits: [],
});

const applyCachedHistoryMetadata = (track: Track, file: LibraryIndexedFile): Track => {
    if (track.tagsResolved) {
        return track;
    }

    return {
        ...track,
        title: file.cachedTrackTitle || track.title,
        displayTitle: file.cachedTrackTitle || track.displayTitle,
        displayAlbum: file.cachedAlbumTitle || track.displayAlbum,
        displayArtist: file.cachedArtistName || track.displayArtist,
        displayTrackNumber: file.cachedTrackNumber || track.displayTrackNumber,
        displayTrackTotal: file.cachedTrackTotal || track.displayTrackTotal,
    };
};

const ensureTrackIndexForPath = (tracks: Track[], file: LibraryIndexedFile, trackIndexByPath: Map<string, number>): number => {
    const normalizedPath = file.path.toLowerCase();
    const existingIndex = trackIndexByPath.get(normalizedPath);
    if (existingIndex !== undefined) {
        tracks[existingIndex] = applyCachedHistoryMetadata(tracks[existingIndex], file);
        return existingIndex;
    }

    const createdTrack = createPlaceholderTrack(file);
    tracks.push(createdTrack);
    const createdIndex = tracks.length - 1;
    trackIndexByPath.set(normalizedPath, createdIndex);
    return createdIndex;
};

const yieldToUi = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
    });
};

const appendTrackFiles = async (tracks: Track[], files: LibraryIndexedFile[]): Promise<void> => {
    const batchSize = BATCH_SIZES.indexedFiles;
    for (let index = 0; index < files.length; index += 1) {
        tracks.push(createPlaceholderTrack(files[index]));
        if ((index + 1) % batchSize === 0) {
            await yieldToUi();
        }
    }
};

const appendTextFiles = async (textFiles: TextLibraryFile[], files: LibraryIndexedFile[]): Promise<void> => {
    const batchSize = BATCH_SIZES.indexedFiles;
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        textFiles.push({
            name: file.name,
            path: file.path,
            relativePath: file.relativePath,
            folderPath: file.folderPath,
            rootPath: file.rootPath || '',
            rootName: file.rootName || '',
        });
        if ((index + 1) % batchSize === 0) {
            await yieldToUi();
        }
    }
};

const appendImageFiles = async (imageFiles: ImageLibraryFile[], files: LibraryIndexedFile[]): Promise<void> => {
    const batchSize = BATCH_SIZES.indexedFiles;
    for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        imageFiles.push({
            name: file.name,
            path: file.path,
            relativePath: file.relativePath,
            folderPath: file.folderPath,
            rootPath: file.rootPath || '',
            rootName: file.rootName || '',
        });
        if ((index + 1) % batchSize === 0) {
            await yieldToUi();
        }
    }
};

export const createScanCollections = (scanResult: LibraryScanResult): ScanCollections => {
    return {
        coverPathEntries: Object.entries(scanResult.coverPathByFolder || {}),
        tracks: [],
        textFiles: [],
        imageFiles: [],
    };
};

export const appendIndexedFilesToScanCollections = async (
    scanCollections: ScanCollections,
    kind: ScanCollectionKind,
    files: LibraryIndexedFile[],
): Promise<void> => {
    if (kind === 'track') {
        await appendTrackFiles(scanCollections.tracks, files);
        return;
    }

    if (kind === 'text-file') {
        await appendTextFiles(scanCollections.textFiles, files);
        return;
    }

    await appendImageFiles(scanCollections.imageFiles, files);
};

export const mapLibraryScanResult = async (scanResult: LibraryScanResult): Promise<ScanCollections> => {
    const scanCollections = createScanCollections(scanResult);
    await appendIndexedFilesToScanCollections(scanCollections, 'track', scanResult.trackFiles || []);
    await appendIndexedFilesToScanCollections(scanCollections, 'text-file', scanResult.textFiles || []);
    await appendIndexedFilesToScanCollections(scanCollections, 'image-file', scanResult.imageFiles || []);
    return scanCollections;
};

export const mergePlaylistFilesIntoTracks = async (tracks: Track[], playlistFiles: LibraryIndexedFile[]): Promise<MergePlaylistFilesResult> => {
    const nextTracks = [...tracks];
    const nextIndexes: number[] = [];
    const trackIndexByPath = new Map<string, number>();

    nextTracks.forEach((track, index) => {
        trackIndexByPath.set(track.path.toLowerCase(), index);
    });

    const batchSize = BATCH_SIZES.playlistFiles;
    for (let index = 0; index < playlistFiles.length; index += 1) {
        nextIndexes.push(ensureTrackIndexForPath(nextTracks, playlistFiles[index], trackIndexByPath));

        if ((index + 1) % batchSize === 0) {
            await yieldToUi();
        }
    }

    return {
        trackIndexes: nextIndexes,
        tracks: nextTracks,
    };
};

export const clearLibraryRuntimeData = (options: ClearLibraryRuntimeDataOptions): string[] => {
    for (const url of options.objectUrls) {
        URL.revokeObjectURL(url);
    }

    if (options.clearCoverArtCache) {
        options.clearCoverArtCache();
    }
    options.clearArtistInfoCache();
    if (options.clearImageModalCache) {
        options.clearImageModalCache();
    }
    options.resetLibraryState();
    options.resetPlaylistState();

    return [];
};
