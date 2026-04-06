import { describe, expect, it, vi } from 'vitest';

import type { Track } from '../types/app-types';
import { createPlaybackSequencingService } from './playback-sequencing-service';

const createTrack = (name: string, folderPath: string, overrides: Partial<Track> = {}): Track => ({
    title: name,
    name,
    path: `/${folderPath}/${name}.flac`,
    relativePath: `${folderPath}/${name}.flac`,
    folderPath,
    rootPath: '/Library',
    rootName: 'Library',
    displayTitle: name,
    displayAlbum: '',
    displayArtist: '',
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
    mbArtistCredits: [],
    ...overrides,
});

describe('createPlaybackSequencingService', () => {
    it('cycles through the full library in ordered-library mode', () => {
        const tracks = [
            createTrack('01 Alpha', 'Library/Album A'),
            createTrack('02 Beta', 'Library/Album B'),
            createTrack('03 Gamma', 'Library/Album C'),
        ];
        let currentTrackIndex = 2;

        const service = createPlaybackSequencingService({
            getTracks: () => tracks,
            getCurrentTrackIndex: () => currentTrackIndex,
            getReleaseDepthForTrack: () => 0,
            initialPlaybackOrderMode: 'ordered-library',
        });

        const wrappedForward = service.nextTrackIndexForDirection(1);
        expect(wrappedForward).toBe(0);

        currentTrackIndex = wrappedForward ?? -1;
        expect(service.nextTrackIndexForDirection(-1)).toBe(2);
    });

    it('keeps ordered-album navigation scoped to the current release depth', () => {
        const tracks = [
            createTrack('02 Song', 'Library/Artist/Album One/Disc 1'),
            createTrack('01 Elsewhere', 'Library/Artist/Album Two'),
            createTrack('01 Intro', 'Library/Artist/Album One/Disc 2'),
        ];
        let currentTrackIndex = 0;

        const service = createPlaybackSequencingService({
            getTracks: () => tracks,
            getCurrentTrackIndex: () => currentTrackIndex,
            getReleaseDepthForTrack: () => 2,
            initialPlaybackOrderMode: 'ordered-album',
        });

        expect(service.baseSequenceIndexes()).toEqual({
            indexes: [2, 0],
            currentPosition: 1,
        });
        expect(service.nextTrackIndexForDirection(1)).toBe(2);
        expect(service.peekNextTrackIndexForDirection(-1)).toBe(2);
    });

    it('preserves shuffle history without immediately repeating the current track', () => {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
        const tracks = [
            createTrack('01 Alpha', 'Library/Album A'),
            createTrack('02 Beta', 'Library/Album B'),
            createTrack('03 Gamma', 'Library/Album C'),
        ];
        let currentTrackIndex = 0;

        const service = createPlaybackSequencingService({
            getTracks: () => tracks,
            getCurrentTrackIndex: () => currentTrackIndex,
            getReleaseDepthForTrack: () => 0,
            initialPlaybackOrderMode: 'shuffle-library',
        });

        expect(service.peekNextTrackIndexForDirection(1)).toBe(1);
        expect(service.peekNextTrackIndexForDirection(1)).toBe(1);

        const nextTrackIndex = service.nextTrackIndexForDirection(1);
        expect(nextTrackIndex).toBe(1);

        currentTrackIndex = nextTrackIndex ?? -1;
        expect(service.nextTrackIndexForDirection(-1)).toBe(0);

        currentTrackIndex = 0;
        expect(service.nextTrackIndexForDirection(1)).toBe(1);

        expect(randomSpy).toHaveBeenCalled();
    });
});