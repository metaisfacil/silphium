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
    lookupMusicBrainzTrackMetadata: (recordingId: string, releaseId: string) => Promise<MusicBrainzTrackMetadata>;
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
            const metadata = buildDisplayMetadata(latestTrack, tags);
            options.setTrack(index, {
                ...latestTrack,
                displayTitle: metadata.title,
                displayAlbum: metadata.album,
                displayArtist: metadata.artist,
                displayLyrics: normalizeTrackLyrics(tags),
                displayTrackNumber: tags?.trackNumber?.trim() || '',
                displayTrackTotal: tags?.trackTotal?.trim() || '',
                displayTechnical: formatTechnicalMetadata(tags?.bitDepth, tags?.sampleRate, tags?.codec),
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

        const recordingId = track.mbIds.recordingId || '';
        const releaseId = track.mbIds.releaseId || '';
        if (!recordingId && !releaseId) {
            options.setTrack(index, {
                ...track,
                mbMetadataResolved: true,
            });
            return true;
        }

        try {
            const metadata = await options.lookupMusicBrainzTrackMetadata(recordingId, releaseId);
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
