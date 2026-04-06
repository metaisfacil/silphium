import type {
    MusicBrainzTrackMetadata,
    Track,
    TrackTags,
} from '../types/app-types';
import {
    allFileTagsFromTags,
    buildDisplayMetadata,
    formatTechnicalMetadata,
    normalizeTrackLyrics,
    technicalDetailsFromTags,
} from '../utils/main-helpers';

type TrackMetadataServiceOptions = {
    getTracks: () => Track[];
    setTrack: (index: number, track: Track) => void;
    readTrackTags: (paths: string[]) => Promise<Record<string, unknown>>;
    lookupMusicBrainzTrackMetadata: (releaseId: string) => Promise<MusicBrainzTrackMetadata>;
    getPreferMusicBrainzMetadata: () => boolean;
    getCurrentTrackIndex: () => number;
    getTagRequestVersion: () => number;
};

type HydrateTrackResult = {
    updatedTags: boolean;
    updatedMusicBrainz: boolean;
};

export type TrackMetadataService = ReturnType<typeof createTrackMetadataService>;

export const createTrackMetadataService = (options: TrackMetadataServiceOptions) => {
    const applyResolvedTrackTags = (index: number, tags?: TrackTags): boolean => {
        const latestTrack = options.getTracks()[index];
        if (!latestTrack) {
            return false;
        }

        const metadata = buildDisplayMetadata(latestTrack, tags);
        options.setTrack(index, {
            ...latestTrack,
            displayTitle: metadata.title,
            displayAlbum: metadata.album,
            displayArtist: metadata.artist,
            displayLyrics: normalizeTrackLyrics(tags),
            displayTrackNumber: tags?.trackNumber?.trim() || '',
            displayTrackTotal: tags?.trackTotal?.trim() || '',
            displayTechnical: formatTechnicalMetadata(tags?.bitDepth, tags?.sampleRate, tags?.codec, tags?.overallBitRate ?? tags?.bitRate),
            technicalDetails: technicalDetailsFromTags(tags),
            allFileTags: allFileTagsFromTags(tags),
            tagsResolved: true,
            mbMetadataResolved: false,
            mbIds: {
                recordingId: tags?.recordingId || undefined,
                releaseId: tags?.releaseId || undefined,
                artistId: tags?.artistIds?.[0] || tags?.artistId || undefined,
            },
            artistMbids: (tags?.artistIds && tags.artistIds.length > 0)
                ? tags.artistIds
                : (tags?.artistId ? [tags.artistId] : []),
            mbArtistCredits: [],
        });

        return true;
    };

    const ensureTrackTagsBatchInternal = async (indexes: number[], requestVersion?: number): Promise<void> => {
        if (indexes.length === 0) {
            return;
        }

        const uniqueIndexes = Array.from(new Set(indexes));
        const unresolvedIndexes: number[] = [];
        const paths: string[] = [];
        const seenPaths = new Set<string>();

        for (const index of uniqueIndexes) {
            const track = options.getTracks()[index];
            if (!track || track.tagsResolved) {
                continue;
            }

            unresolvedIndexes.push(index);
            if (!seenPaths.has(track.path)) {
                seenPaths.add(track.path);
                paths.push(track.path);
            }
        }

        if (paths.length === 0) {
            return;
        }

        try {
            const tagByPath = await options.readTrackTags(paths);
            if (requestVersion !== undefined && requestVersion !== options.getTagRequestVersion()) {
                return;
            }

            for (const index of unresolvedIndexes) {
                if (requestVersion !== undefined && requestVersion !== options.getTagRequestVersion()) {
                    return;
                }

                const latestTrack = options.getTracks()[index];
                if (!latestTrack || latestTrack.tagsResolved) {
                    continue;
                }

                const tags = tagByPath[latestTrack.path] as TrackTags | undefined;
                applyResolvedTrackTags(index, tags);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const ensureTrackTagsInternal = async (index: number, requestVersion?: number): Promise<{ resolved: boolean; updated: boolean }> => {
        const tracks = options.getTracks();
        if (index < 0 || index >= tracks.length) {
            return { resolved: false, updated: false };
        }

        const track = tracks[index];
        if (track.tagsResolved) {
            return { resolved: true, updated: false };
        }

        try {
            const tagByPath = await options.readTrackTags([track.path]);
            if (requestVersion !== undefined && requestVersion !== options.getTagRequestVersion()) {
                return { resolved: false, updated: false };
            }

            const latestTrack = options.getTracks()[index];
            if (!latestTrack) {
                return { resolved: false, updated: false };
            }

            const tags = tagByPath[latestTrack.path] as TrackTags | undefined;
            if (!applyResolvedTrackTags(index, tags)) {
                return { resolved: false, updated: false };
            }

            return { resolved: true, updated: true };
        } catch (error) {
            console.error(error);
            return { resolved: false, updated: false };
        }
    };

    const hydrateMusicBrainzMetadata = async (index: number, requestVersion: number): Promise<boolean> => {
        if (!options.getPreferMusicBrainzMetadata()) {
            return false;
        }

        const tracks = options.getTracks();
        if (index < 0 || index >= tracks.length) {
            return false;
        }

        const track = tracks[index];
        if (!track.tagsResolved || track.mbMetadataResolved) {
            return false;
        }

        const releaseId = track.mbIds.releaseId || '';
        if (!releaseId) {
            options.setTrack(index, {
                ...track,
                mbMetadataResolved: true,
            });
            return true;
        }

        try {
            // Only use release/artist metadata for hydration; avoid recording lookups.
            const metadata = await options.lookupMusicBrainzTrackMetadata(releaseId);
            if (requestVersion !== options.getTagRequestVersion() || index !== options.getCurrentTrackIndex()) {
                return false;
            }

            const latestTrack = options.getTracks()[index];
            if (!latestTrack) {
                return false;
            }

            options.setTrack(index, {
                ...latestTrack,
                displayTitle: metadata.title.trim() || latestTrack.displayTitle,
                displayAlbum: metadata.album.trim() || latestTrack.displayAlbum,
                displayArtist: metadata.artist.trim() || latestTrack.displayArtist,
                artistMbids: metadata.artistCredits
                    .map((credit) => credit.artistId?.trim() || '')
                    .filter((artistId) => artistId !== ''),
                mbArtistCredits: metadata.artistCredits,
                mbIds: {
                    ...latestTrack.mbIds,
                    labelId: metadata.labelId ? metadata.labelId.trim() : latestTrack.mbIds.labelId,
                },
                mbMetadataResolved: true,
            });
            return true;
        } catch (error) {
            console.error(error);
            return false;
        }
    };

    return {
        ensureTrackTagsResolved: async (index: number): Promise<void> => {
            await ensureTrackTagsInternal(index);
        },
        ensureTrackTagsResolvedBatch: async (indexes: number[]): Promise<void> => {
            await ensureTrackTagsBatchInternal(indexes);
        },
        hydrateTrack: async (index: number, requestVersion: number): Promise<HydrateTrackResult> => {
            const { resolved, updated: updatedTags } = await ensureTrackTagsInternal(index, requestVersion);
            if (!resolved) {
                return {
                    updatedTags: false,
                    updatedMusicBrainz: false,
                };
            }

            const updatedMusicBrainz = await hydrateMusicBrainzMetadata(index, requestVersion);
            return {
                updatedTags,
                updatedMusicBrainz,
            };
        },
    };
};
