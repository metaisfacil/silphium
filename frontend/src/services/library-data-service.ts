import type {
    ImageLibraryFile,
    LibraryIndexedFile,
    LibraryScanResult,
    TextLibraryFile,
    Track,
} from '../types/app-types';

type ScanCollections = {
    coverPathEntries: Array<[string, string]>;
    imageFiles: ImageLibraryFile[];
    textFiles: TextLibraryFile[];
    tracks: Track[];
};

type MergePlaylistFilesResult = {
    trackIndexes: number[];
    tracks: Track[];
};

type ClearLibraryRuntimeDataOptions = {
    objectUrls: string[];
    coverPathByFolder: Map<string, string>;
    coverUrlByFolder: Map<string, string>;
    clearArtistInfoCache: () => void;
    clearImageModalCache?: () => void;
    resetLibraryState: () => void;
    resetPlaylistState: () => void;
};

const byRelativePath = <T extends { relativePath: string }>(left: T, right: T): number => {
    return left.relativePath.localeCompare(right.relativePath, undefined, { sensitivity: 'base' });
};

const createPlaceholderTrack = (file: LibraryIndexedFile): Track => ({
    title: file.name,
    name: file.name,
    path: file.path,
    relativePath: file.relativePath || file.name,
    folderPath: file.folderPath || '',
    displayTitle: file.name,
    displayAlbum: 'Unknown Album',
    displayArtist: 'Unknown Artist',
    displayTrackNumber: '',
    displayTrackTotal: '',
    displayTechnical: '',
    displayLyrics: '',
    tagsResolved: false,
    mbMetadataResolved: false,
    technicalDetails: {},
    allFileTags: {},
    mbIds: {},
    artistMbids: [],
});

const ensureTrackIndexForPath = (tracks: Track[], file: LibraryIndexedFile, trackIndexByPath: Map<string, number>): number => {
    const normalizedPath = file.path.toLowerCase();
    const existingIndex = trackIndexByPath.get(normalizedPath);
    if (existingIndex !== undefined) {
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

export const mapLibraryScanResult = (scanResult: LibraryScanResult): ScanCollections => {
    return {
        coverPathEntries: Object.entries(scanResult.coverPathByFolder || {}),
        tracks: (scanResult.trackFiles || [])
            .sort(byRelativePath)
            .map((file) => createPlaceholderTrack(file)),
        textFiles: (scanResult.textFiles || [])
            .sort(byRelativePath)
            .map((file) => ({
                name: file.name,
                path: file.path,
                relativePath: file.relativePath,
                folderPath: file.folderPath,
            })),
        imageFiles: (scanResult.imageFiles || [])
            .sort(byRelativePath)
            .map((file) => ({
                name: file.name,
                path: file.path,
                relativePath: file.relativePath,
                folderPath: file.folderPath,
            })),
    };
};

export const mergePlaylistFilesIntoTracks = async (tracks: Track[], playlistFiles: LibraryIndexedFile[]): Promise<MergePlaylistFilesResult> => {
    const nextTracks = [...tracks];
    const nextIndexes: number[] = [];
    const trackIndexByPath = new Map<string, number>();

    nextTracks.forEach((track, index) => {
        trackIndexByPath.set(track.path.toLowerCase(), index);
    });

    const batchSize = 200;
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

    options.coverPathByFolder.clear();
    options.coverUrlByFolder.clear();
    options.clearArtistInfoCache();
    if (options.clearImageModalCache) {
        options.clearImageModalCache();
    }
    options.resetLibraryState();
    options.resetPlaylistState();

    return [];
};
