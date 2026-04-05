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

type CoverArtArchiveImage = {
    image?: string;
    front?: boolean;
    thumbnails?: {
        large?: string;
        small?: string;
        [key: string]: string | undefined;
    };
};

type CoverArtArchiveResponse = {
    images?: CoverArtArchiveImage[];
};

const defaultCoverArtPriority: CoverArtPrioritySource[] = ['file', 'embedded'];

const loadImageSource = async (src: string): Promise<string | undefined> => {
    return await new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            resolve(src);
        };
        image.onerror = () => {
            resolve(undefined);
        };
        image.src = src;
    });
};

const coverArtArchiveThumbnailRank = (key: string): number => {
    const normalizedKey = key.trim().toLowerCase();
    if (normalizedKey === 'large') {
	    return 500;
    }

    if (normalizedKey === 'small') {
	    return 250;
    }

    const numeric = Number.parseInt(normalizedKey, 10);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }

    return 0;
};

const bestNonOriginalCoverArtThumbnailUrl = (image: CoverArtArchiveImage): string | undefined => {
    const thumbnailEntries = Object.entries(image.thumbnails || {})
        .map(([key, url]) => ({ key, url: url?.trim() || '' }))
        .filter((entry) => entry.url !== '')
        .sort((left, right) => coverArtArchiveThumbnailRank(right.key) - coverArtArchiveThumbnailRank(left.key));

    return thumbnailEntries[0]?.url;
};

const resolveCoverArtArchiveImageUrl = async (releaseId: string): Promise<string | undefined> => {
    try {
        const response = await fetch(`https://coverartarchive.org/release/${releaseId}`);
        if (!response.ok) {
            return undefined;
        }

        const payload = await response.json() as CoverArtArchiveResponse;
        const images = Array.isArray(payload.images) ? payload.images : [];
        const primary = images.find((image) => image.front) || images[0];
        if (!primary) {
            return undefined;
        }

        return bestNonOriginalCoverArtThumbnailUrl(primary)
            || primary.image
            || undefined;
    } catch {
        return undefined;
    }
};

const normalizeCoverArtPriority = (sources: CoverArtPrioritySource[] | string[] | undefined): CoverArtPrioritySource[] => {
    if (sources === undefined) {
        return [...defaultCoverArtPriority];
    }

    const ordered: CoverArtPrioritySource[] = [];
    const seen = new Set<CoverArtPrioritySource>();

    for (const rawSource of sources || []) {
        const source = rawSource === 'embedded'
            ? 'embedded'
            : rawSource === 'file'
                ? 'file'
                : rawSource === 'musicbrainz'
                    ? 'musicbrainz'
                    : undefined;
        if (!source || seen.has(source)) {
            continue;
        }

        seen.add(source);
        ordered.push(source);
    }

    if (ordered.length === 0 && sources.length > 0) {
        return [...defaultCoverArtPriority];
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
    const coverUrlByMusicBrainzRelease = new Map<string, string>();
    const coverMediaArtworkByMusicBrainzRelease = new Map<string, MediaArtwork>();
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

    const resolveMusicBrainzCoverForTrack = async (track: Track): Promise<string | undefined> => {
        const releaseId = (track.mbIds.releaseId || '').trim().toLowerCase();
        if (!releaseId) {
            return undefined;
        }

        const cached = coverUrlByMusicBrainzRelease.get(releaseId);
        if (cached) {
            return cached;
        }

        const releaseCoverUrl = await resolveCoverArtArchiveImageUrl(releaseId);
        if (!releaseCoverUrl) {
            return undefined;
        }

        const resolved = await loadImageSource(releaseCoverUrl);
        if (!resolved) {
            return undefined;
        }

        coverUrlByMusicBrainzRelease.set(releaseId, releaseCoverUrl);
        coverMediaArtworkByMusicBrainzRelease.set(releaseId, {
            src: releaseCoverUrl,
            type: 'image/jpeg',
        });
        return resolved;
    };

    return {
        clearCache: (): void => {
            coverPathByFolder.clear();
            coverUrlByFolder.clear();
            coverMediaArtworkByFolder.clear();
            coverUrlByTrackPath.clear();
            coverMediaArtworkByTrackPath.clear();
            coverUrlByMusicBrainzRelease.clear();
            coverMediaArtworkByMusicBrainzRelease.clear();
            coverSourceByTrackPath.clear();
        },
        getCachedMediaArtwork: (track: Track): MediaArtwork | undefined => {
            const trackKey = trackPathKey(track.path);
            const folderKey = folderKeyForPath(track.folderPath || '');
            const releaseId = (track.mbIds.releaseId || '').trim().toLowerCase();
            return coverMediaArtworkByTrackPath.get(trackKey)
                || coverMediaArtworkByMusicBrainzRelease.get(releaseId)
                || coverMediaArtworkByFolder.get(folderKey);
        },
        getFolderCoverPath: (folderPath: string): string | undefined => coverPathByFolder.get(folderKeyForPath(folderPath || '')),
        getMusicBrainzCoverUrlForTrack: (track: Track): string | undefined => {
            const releaseId = (track.mbIds.releaseId || '').trim().toLowerCase();
            if (!releaseId) {
                return undefined;
            }

            return coverUrlByMusicBrainzRelease.get(releaseId);
        },
        getResolvedSourceForTrack: (trackPath: string): CoverArtPrioritySource | undefined => coverSourceByTrackPath.get(trackPathKey(trackPath)),
        resolveForTrack: async (track: Track): Promise<string | undefined> => {
            const trackKey = trackPathKey(track.path);
            const priority = normalizeCoverArtPriority(options.getCoverArtPriority());

            for (const source of priority) {
                const coverUrl = source === 'embedded'
                    ? await resolveEmbeddedCoverForTrack(track)
                    : source === 'musicbrainz'
                        ? await resolveMusicBrainzCoverForTrack(track)
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