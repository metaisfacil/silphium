import { describe, expect, it, vi } from 'vitest';

import { createTrackMetadataService } from './track-metadata-service';
import type { Track } from '../types/app-types';

const createTrack = (): Track => ({
    title: 'Original Title',
    name: 'Original Title',
    path: '/music/track.flac',
    relativePath: 'track.flac',
    folderPath: '/music',
    rootPath: '/music',
    rootName: 'Library',
    displayTitle: 'Original Title',
    displayAlbum: 'Original Album',
    displayArtist: 'Original Artist',
    displayTrackNumber: '',
    displayTrackTotal: '',
    displayTechnical: '',
    displayLyrics: '',
    tagsResolved: true,
    mbMetadataResolved: false,
    technicalDetails: {},
    allFileTags: {},
    mbIds: {},
    artistMbids: [],
    mbArtistCredits: [],
});

describe('track metadata service', () => {
    it('refreshTrackTags reapplies display metadata and mbids from forced file reads', async () => {
        const tracks = [createTrack()];
        const service = createTrackMetadataService({
            getTracks: () => tracks,
            setTrack: (index, track) => {
                tracks[index] = track;
            },
            readTrackTags: vi.fn(async () => ({})),
            forceRefreshTrackTags: vi.fn(async () => ({
                '/music/track.flac': {
                    title: 'Fresh Title',
                    album: 'Fresh Album',
                    artist: 'Fresh Artist',
                    recordingId: 'recording-id',
                    releaseId: 'release-id',
                    trackNumber: '2',
                    trackTotal: '10',
                },
            })),
            lookupMusicBrainzTrackMetadata: vi.fn(async () => ({ found: false, recordingId: '', releaseId: '', title: '', album: '', artist: '', artistCredits: [] })),
            getPreferMusicBrainzMetadata: () => false,
            getCurrentTrackIndex: () => 0,
            getTagRequestVersion: () => 1,
        });

        await service.refreshTrackTags(['/music/track.flac']);

        expect(tracks[0].displayTitle).toBe('Fresh Title');
        expect(tracks[0].displayAlbum).toBe('Fresh Album');
        expect(tracks[0].displayArtist).toBe('Fresh Artist');
        expect(tracks[0].displayTrackNumber).toBe('2');
        expect(tracks[0].displayTrackTotal).toBe('10');
        expect(tracks[0].mbIds.recordingId).toBe('recording-id');
        expect(tracks[0].mbIds.releaseId).toBe('release-id');
        expect(tracks[0].tagsResolved).toBe(true);
        expect(tracks[0].mbMetadataResolved).toBe(false);
    });

    it('refreshTrack refetches file tags and reapplies preferred MusicBrainz metadata with both MBIDs', async () => {
        const tracks = [createTrack()];
        const lookupMusicBrainzTrackMetadata = vi.fn(async () => ({
            found: true,
            recordingId: 'recording-id',
            releaseId: 'release-id',
            title: 'MusicBrainz Title',
            album: 'MusicBrainz Album',
            artist: 'MusicBrainz Artist',
            labelId: 'label-id',
            artistCredits: [{ name: 'MusicBrainz Artist', artistId: 'artist-id', joinPhrase: '' }],
        }));
        const service = createTrackMetadataService({
            getTracks: () => tracks,
            setTrack: (index, track) => {
                tracks[index] = track;
            },
            readTrackTags: vi.fn(async () => ({})),
            forceRefreshTrackTags: vi.fn(async () => ({
                '/music/track.flac': {
                    title: 'Fresh Title',
                    album: 'Fresh Album',
                    artist: 'Fresh Artist',
                    recordingId: 'recording-id',
                    releaseId: 'release-id',
                },
            })),
            lookupMusicBrainzTrackMetadata,
            getPreferMusicBrainzMetadata: () => true,
            getCurrentTrackIndex: () => 0,
            getTagRequestVersion: () => 3,
        });

        const result = await service.refreshTrack(0, 3);

        expect(result).toEqual({ updatedTags: true, updatedMusicBrainz: true });
        expect(lookupMusicBrainzTrackMetadata).toHaveBeenCalledWith('recording-id', 'release-id');
        expect(tracks[0].displayTitle).toBe('MusicBrainz Title');
        expect(tracks[0].displayAlbum).toBe('MusicBrainz Album');
        expect(tracks[0].displayArtist).toBe('MusicBrainz Artist');
        expect(tracks[0].mbIds.labelId).toBe('label-id');
        expect(tracks[0].artistMbids).toEqual(['artist-id']);
        expect(tracks[0].mbMetadataResolved).toBe(true);
    });
});