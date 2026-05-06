import type { CoverArtPrioritySource, Track } from '../types/app-types';
import { base64ToObjectUrl, folderKeyForPath, mimeTypeForFileName } from '../utils/main-helpers';

type MediaArtwork = {
    src: string;
    type: string;
};

type BinaryImageObjectUrl = {
    url: string;
    mimeType: string;
};

type BinaryImageObjectUrlResult =
    | { kind: 'success'; value: BinaryImageObjectUrl }
    | { kind: 'miss' }
    | { kind: 'transport-failure' };

type InternalCoverArtConfig = {
    baseUrl: string;
    token: string;
};

type CoverArtServiceOptions = {
    getCoverArtPriority: () => CoverArtPrioritySource[] | string[] | undefined;
    getInternalCoverArtConfig?: () => Promise<InternalCoverArtConfig | undefined>;
    getIndexedFolderCoverPath?: (folderPath: string) => string | undefined;
    getLibraryFolderCoverPath: (folderPath: string) => Promise<string>;
    readImageThumbnail: (filePath: string, maxEdge: number) => Promise<{ base64?: string; mimeType?: string }>;
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
const nowPlayingCoverThumbnailMaxEdgePx = 512;
const internalCoverArtFolderIDKind = 'cover-folder';
const internalCoverArtTrackIDKind = 'cover-track';
const maxInternalCoverArtFailuresBeforeDisable = 2;
const internalCoverArtFetchTimeoutMs = 2500;

const base64UrlEncodeUtf8 = (value: string): string => {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
};

const internalCoverArtID = (kind: string, value: string): string => `${kind}:${base64UrlEncodeUtf8(value)}`;

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
    const folderCoverInFlightByFolder = new Map<string, Promise<string | undefined>>();
    const coverUrlByTrackPath = new Map<string, string>();
    const coverMediaArtworkByTrackPath = new Map<string, MediaArtwork>();
    const embeddedCoverInFlightByTrackPath = new Map<string, Promise<string | undefined>>();
    const coverUrlByMusicBrainzRelease = new Map<string, string>();
    const coverMediaArtworkByMusicBrainzRelease = new Map<string, MediaArtwork>();
    const musicBrainzCoverInFlightByRelease = new Map<string, Promise<string | undefined>>();
    const coverSourceByTrackPath = new Map<string, CoverArtPrioritySource>();
    const folderCoverRevisionByFolder = new Map<string, number>();
    const embeddedCoverRevisionByTrackPath = new Map<string, number>();
    let resolvedCacheEpoch = 0;
    let internalCoverArtConfigPromise: Promise<InternalCoverArtConfig | undefined> | undefined;
    let internalCoverArtDisabled = false;
    let internalCoverArtFailureCount = 0;

    const noteInternalCoverArtSuccess = (): void => {
        internalCoverArtFailureCount = 0;
    };

    const noteInternalCoverArtFailure = (): void => {
        internalCoverArtFailureCount += 1;
        if (internalCoverArtFailureCount >= maxInternalCoverArtFailuresBeforeDisable) {
            internalCoverArtDisabled = true;
        }
    };

    const fetchBinaryImageObjectUrl = async (src: string): Promise<BinaryImageObjectUrlResult> => {
        let objectUrl = '';
        let abortController: AbortController | undefined;
        let fetchTimeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;
        try {
            if (typeof AbortController === 'function') {
                abortController = new AbortController();
                fetchTimeoutHandle = globalThis.setTimeout(() => {
                    abortController?.abort();
                }, internalCoverArtFetchTimeoutMs);
            }

            const response = await fetch(src, {
                cache: 'force-cache',
                signal: abortController?.signal,
            });
            if (!response.ok) {
                return { kind: 'miss' };
            }

            const blob = await response.blob();
            if (!blob || blob.size <= 0) {
                return { kind: 'miss' };
            }

            const mimeType = (blob.type || response.headers?.get('Content-Type') || '').trim();
            if (mimeType !== '' && !mimeType.startsWith('image/')) {
                return { kind: 'transport-failure' };
            }

            objectUrl = URL.createObjectURL(blob);
            const loadedUrl = await loadImageSource(objectUrl);
            if (!loadedUrl) {
                if (typeof URL.revokeObjectURL === 'function') {
                    URL.revokeObjectURL(objectUrl);
                }
                return { kind: 'transport-failure' };
            }

            options.registerObjectUrl(objectUrl);
            return {
                kind: 'success',
                value: {
                    url: objectUrl,
                    mimeType,
                },
            };
        } catch {
            if (objectUrl !== '' && typeof URL.revokeObjectURL === 'function') {
                URL.revokeObjectURL(objectUrl);
            }
            return { kind: 'transport-failure' };
        } finally {
            if (fetchTimeoutHandle !== undefined) {
                globalThis.clearTimeout(fetchTimeoutHandle);
            }
        }
    };

    const resolveInternalCoverArtConfig = async (): Promise<InternalCoverArtConfig | undefined> => {
        if (!options.getInternalCoverArtConfig || internalCoverArtDisabled) {
            return undefined;
        }

        if (!internalCoverArtConfigPromise) {
            internalCoverArtConfigPromise = options.getInternalCoverArtConfig().then((config) => {
                if (!config) {
                    return undefined;
                }

                const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
                const token = config.token.trim();
                if (baseUrl === '' || token === '') {
                    return undefined;
                }

                return { baseUrl, token };
            }).catch(() => undefined);
        }

        return await internalCoverArtConfigPromise;
    };

    const buildInternalCoverArtUrl = (
        config: InternalCoverArtConfig,
        id: string,
        revision: number,
    ): string => {
        const query = new URLSearchParams({
            id,
            size: String(nowPlayingCoverThumbnailMaxEdgePx),
            token: config.token,
            epoch: String(resolvedCacheEpoch),
            rev: String(revision),
        });
        return `${config.baseUrl}/internal/cover?${query.toString()}`;
    };

    const resolveInFlight = (
        key: string,
        inflight: Map<string, Promise<string | undefined>>,
        resolve: () => Promise<string | undefined>,
    ): Promise<string | undefined> => {
        const existing = inflight.get(key);
        if (existing) {
            return existing;
        }

        const pending = (async () => {
            try {
                return await resolve();
            } finally {
                inflight.delete(key);
            }
        })();
        inflight.set(key, pending);
        return pending;
    };

    const clearResolvedCache = (): void => {
        resolvedCacheEpoch += 1;
        coverUrlByFolder.clear();
        coverMediaArtworkByFolder.clear();
        folderCoverInFlightByFolder.clear();
        coverUrlByTrackPath.clear();
        coverMediaArtworkByTrackPath.clear();
        embeddedCoverInFlightByTrackPath.clear();
        coverUrlByMusicBrainzRelease.clear();
        coverMediaArtworkByMusicBrainzRelease.clear();
        musicBrainzCoverInFlightByRelease.clear();
        coverSourceByTrackPath.clear();
    };

    const invalidateResolvedForTrack = (track: Track): void => {
        const trackKey = trackPathKey(track.path || '');
        const folderKey = folderKeyForPath(track.folderPath || '');

        if (trackKey) {
            embeddedCoverRevisionByTrackPath.set(trackKey, (embeddedCoverRevisionByTrackPath.get(trackKey) || 0) + 1);
            coverUrlByTrackPath.delete(trackKey);
            coverMediaArtworkByTrackPath.delete(trackKey);
            embeddedCoverInFlightByTrackPath.delete(trackKey);
            coverSourceByTrackPath.delete(trackKey);
        }

        if (folderKey) {
            folderCoverRevisionByFolder.set(folderKey, (folderCoverRevisionByFolder.get(folderKey) || 0) + 1);
            folderCoverInFlightByFolder.delete(folderKey);
            coverUrlByFolder.delete(folderKey);
            coverMediaArtworkByFolder.delete(folderKey);
        }
    };

    const resolveFolderCoverForTrack = async (track: Track): Promise<string | undefined> => {
        const folderKey = folderKeyForPath(track.folderPath);
        if (!folderKey) {
            return undefined;
        }

        const cached = coverUrlByFolder.get(folderKey);
        if (cached) {
            return cached;
        }

        return await resolveInFlight(folderKey, folderCoverInFlightByFolder, async () => {
            let coverPath = coverPathByFolder.get(folderKey);
            if (!coverPath) {
                const indexedCoverPath = options.getIndexedFolderCoverPath?.(track.folderPath || '')?.trim() || '';
                if (indexedCoverPath !== '') {
                    coverPathByFolder.set(folderKey, indexedCoverPath);
                    coverPath = indexedCoverPath;
                }
            }

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

            const internalCoverArtConfig = await resolveInternalCoverArtConfig();
            if (internalCoverArtConfig) {
                const internalCoverUrl = buildInternalCoverArtUrl(
                    internalCoverArtConfig,
                    internalCoverArtID(internalCoverArtFolderIDKind, track.folderPath || ''),
                    folderCoverRevisionByFolder.get(folderKey) || 0,
                );
                const resolved = await fetchBinaryImageObjectUrl(internalCoverUrl);
                if (resolved.kind === 'success') {
                    noteInternalCoverArtSuccess();
                    const coverMimeType = resolved.value.mimeType.startsWith('image/')
                        ? resolved.value.mimeType
                        : mimeTypeForFileName(coverPath);
                    coverUrlByFolder.set(folderKey, resolved.value.url);
                    coverMediaArtworkByFolder.set(folderKey, {
                        src: resolved.value.url,
                        type: coverMimeType,
                    });
                    return resolved.value.url;
                }

                if (resolved.kind === 'transport-failure') {
                    noteInternalCoverArtFailure();
                }
            }

            const thumbnail = await options.readImageThumbnail(coverPath, nowPlayingCoverThumbnailMaxEdgePx);
            const base64 = thumbnail.base64 || await options.readFileBase64(coverPath);
            if (!base64) {
                return undefined;
            }

            const coverMimeType = thumbnail.mimeType && thumbnail.mimeType.startsWith('image/')
                ? thumbnail.mimeType
                : mimeTypeForFileName(coverPath);
            const coverUrl = base64ToObjectUrl(base64, coverMimeType);
            coverUrlByFolder.set(folderKey, coverUrl);
            coverMediaArtworkByFolder.set(folderKey, {
                src: `data:${coverMimeType};base64,${base64}`,
                type: coverMimeType,
            });
            options.registerObjectUrl(coverUrl);
            return coverUrl;
        });
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

        return await resolveInFlight(trackKey, embeddedCoverInFlightByTrackPath, async () => {
            const internalCoverArtConfig = await resolveInternalCoverArtConfig();
            if (internalCoverArtConfig && track.relativePath.trim() !== '') {
                const internalCoverUrl = buildInternalCoverArtUrl(
                    internalCoverArtConfig,
                    internalCoverArtID(internalCoverArtTrackIDKind, track.relativePath),
                    embeddedCoverRevisionByTrackPath.get(trackKey) || 0,
                );
                const resolved = await fetchBinaryImageObjectUrl(internalCoverUrl);
                if (resolved.kind === 'success') {
                    noteInternalCoverArtSuccess();
                    const mimeType = resolved.value.mimeType.startsWith('image/')
                        ? resolved.value.mimeType
                        : 'image/jpeg';
                    coverUrlByTrackPath.set(trackKey, resolved.value.url);
                    coverMediaArtworkByTrackPath.set(trackKey, {
                        src: resolved.value.url,
                        type: mimeType,
                    });
                    return resolved.value.url;
                }

                if (resolved.kind === 'transport-failure') {
                    noteInternalCoverArtFailure();
                }
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
        });
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

        return await resolveInFlight(releaseId, musicBrainzCoverInFlightByRelease, async () => {
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
        });
    };

    return {
        clearCache: (): void => {
            coverPathByFolder.clear();
            folderCoverRevisionByFolder.clear();
            embeddedCoverRevisionByTrackPath.clear();
            clearResolvedCache();
        },
        clearResolvedCache,
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
        invalidateForTrack: (track: Track): void => {
            const trackKey = trackPathKey(track.path || '');
            const folderKey = folderKeyForPath(track.folderPath || '');

            invalidateResolvedForTrack(track);

            if (trackKey) {
                embeddedCoverInFlightByTrackPath.delete(trackKey);
            }

            if (folderKey) {
                coverPathByFolder.delete(folderKey);
                folderCoverInFlightByFolder.delete(folderKey);
            }
        },
        invalidateResolvedForTrack,
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