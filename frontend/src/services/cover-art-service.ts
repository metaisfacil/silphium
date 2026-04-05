import type { CoverArtPrioritySource, Track } from '../types/app-types';
import { base64ToObjectUrl, folderKeyForPath, mimeTypeForFileName } from '../utils/main-helpers';

type MediaArtwork = {
    src: string;
    type: string;
};

type CoverArtServiceOptions = {
    getCoverArtPriority: () => CoverArtPrioritySource[] | string[] | undefined;
    getLibraryFolderCoverPath: (folderPath: string) => Promise<string>;
    readFileBase64: (filePath: string) => Promise<string>;
    readTrackEmbeddedCover: (trackPath: string) => Promise<{ base64?: string; mimeType?: string }>;
    registerObjectUrl: (url: string) => void;
};

const defaultCoverArtPriority: CoverArtPrioritySource[] = ['file', 'embedded'];

const normalizeCoverArtPriority = (sources: CoverArtPrioritySource[] | string[] | undefined): CoverArtPrioritySource[] => {
    const ordered: CoverArtPrioritySource[] = [];
    const seen = new Set<CoverArtPrioritySource>();

    for (const rawSource of sources || []) {
        const source = rawSource === 'embedded' ? 'embedded' : rawSource === 'file' ? 'file' : undefined;
        if (!source || seen.has(source)) {
            continue;
        }

        seen.add(source);
        ordered.push(source);
    }

    for (const fallback of defaultCoverArtPriority) {
        if (!seen.has(fallback)) {
            ordered.push(fallback);
        }
    }

    return ordered;
};

const trackPathKey = (trackPath: string): string => trackPath.trim().toLowerCase();

export type CoverArtService = ReturnType<typeof createCoverArtService>;

export const createCoverArtService = (options: CoverArtServiceOptions) => {
    const coverPathByFolder = new Map<string, string>();
    const coverUrlByFolder = new Map<string, string>();
    const coverMediaArtworkByFolder = new Map<string, MediaArtwork>();
    const coverUrlByTrackPath = new Map<string, string>();
    const coverMediaArtworkByTrackPath = new Map<string, MediaArtwork>();
    const coverSourceByTrackPath = new Map<string, CoverArtPrioritySource>();

    const resolveFolderCoverForTrack = async (track: Track): Promise<string | undefined> => {
        const folderKey = folderKeyForPath(track.folderPath);
        const cached = coverUrlByFolder.get(folderKey);
        if (cached) {
            return cached;
        }

        let coverPath = coverPathByFolder.get(folderKey);
        if (!coverPath) {
            const backendCoverPath = await options.getLibraryFolderCoverPath(track.folderPath || '');
            if (backendCoverPath) {
                coverPathByFolder.set(folderKey, backendCoverPath);
                coverPath = backendCoverPath;
            }
        }

        if (!coverPath) {
            return undefined;
        }

        const base64 = await options.readFileBase64(coverPath);
        if (!base64) {
            return undefined;
        }

        const coverMimeType = mimeTypeForFileName(coverPath);
        const coverUrl = base64ToObjectUrl(base64, coverMimeType);
        coverUrlByFolder.set(folderKey, coverUrl);
        coverMediaArtworkByFolder.set(folderKey, {
            src: `data:${coverMimeType};base64,${base64}`,
            type: coverMimeType,
        });
        options.registerObjectUrl(coverUrl);
        return coverUrl;
    };

    const resolveEmbeddedCoverForTrack = async (track: Track): Promise<string | undefined> => {
        const trackKey = trackPathKey(track.path);
        if (!trackKey) {
            return undefined;
        }

        const cached = coverUrlByTrackPath.get(trackKey);
        if (cached) {
            return cached;
        }

        const embeddedCover = await options.readTrackEmbeddedCover(track.path);
        const base64 = embeddedCover.base64 || '';
        if (!base64) {
            return undefined;
        }

        const mimeType = embeddedCover.mimeType && embeddedCover.mimeType.startsWith('image/')
            ? embeddedCover.mimeType
            : 'image/jpeg';
        const coverUrl = base64ToObjectUrl(base64, mimeType);
        coverUrlByTrackPath.set(trackKey, coverUrl);
        coverMediaArtworkByTrackPath.set(trackKey, {
            src: `data:${mimeType};base64,${base64}`,
            type: mimeType,
        });
        options.registerObjectUrl(coverUrl);
        return coverUrl;
    };

    return {
        clearCache: (): void => {
            coverPathByFolder.clear();
            coverUrlByFolder.clear();
            coverMediaArtworkByFolder.clear();
            coverUrlByTrackPath.clear();
            coverMediaArtworkByTrackPath.clear();
            coverSourceByTrackPath.clear();
        },
        getCachedMediaArtwork: (track: Track): MediaArtwork | undefined => {
            const trackKey = trackPathKey(track.path);
            const folderKey = folderKeyForPath(track.folderPath || '');
            return coverMediaArtworkByTrackPath.get(trackKey) || coverMediaArtworkByFolder.get(folderKey);
        },
        getFolderCoverPath: (folderPath: string): string | undefined => coverPathByFolder.get(folderKeyForPath(folderPath || '')),
        getResolvedSourceForTrack: (trackPath: string): CoverArtPrioritySource | undefined => coverSourceByTrackPath.get(trackPathKey(trackPath)),
        resolveForTrack: async (track: Track): Promise<string | undefined> => {
            const trackKey = trackPathKey(track.path);
            const priority = normalizeCoverArtPriority(options.getCoverArtPriority());

            for (const source of priority) {
                const coverUrl = source === 'embedded'
                    ? await resolveEmbeddedCoverForTrack(track)
                    : await resolveFolderCoverForTrack(track);

                if (!coverUrl) {
                    continue;
                }

                if (trackKey) {
                    coverSourceByTrackPath.set(trackKey, source);
                }
                return coverUrl;
            }

            if (trackKey) {
                coverSourceByTrackPath.delete(trackKey);
            }
            return undefined;
        },
        setFolderCoverPath: (folderPath: string, coverPath: string): void => {
            if (!folderPath || !coverPath) {
                return;
            }

            coverPathByFolder.set(folderKeyForPath(folderPath), coverPath);
        },
    };
};