import { describe, expect, it, vi } from 'vitest';

import type { Track } from '../types/app-types';
import { createPlaybackSequencingService, createPlaybackSequencingState } from './playback-sequencing-service';

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

    it('skips silence placeholder tracks when building the playback sequence', () => {
        const tracks = [
            createTrack('01 Alpha', 'Library/Album A'),
            createTrack('02 Silence', 'Library/Album B', { title: '[silence]', displayTitle: '[silence]' }),
            createTrack('03 Gamma', 'Library/Album C'),
        ];
        let currentTrackIndex = 0;

        const service = createPlaybackSequencingService({
            getTracks: () => tracks,
            getCurrentTrackIndex: () => currentTrackIndex,
            getReleaseDepthForTrack: () => 0,
            initialPlaybackOrderMode: 'ordered-library',
        });

        expect(service.baseSequenceIndexes()).toEqual({
            indexes: [0, 2],
            currentPosition: 0,
        });
        expect(service.nextTrackIndexForDirection(1)).toBe(2);

        currentTrackIndex = 2;
        expect(service.nextTrackIndexForDirection(1)).toBe(0);
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

    it('keeps playlist sources in their supplied order for ordered-library mode', () => {
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

        const playlistSource = { key: 'playlist::demo', indexes: [2, 0] };

        expect(service.baseSequenceIndexes(playlistSource)).toEqual({
            indexes: [2, 0],
            currentPosition: 0,
        });
        expect(service.nextTrackIndexForDirection(1, playlistSource)).toBe(0);

        currentTrackIndex = 0;
        expect(service.nextTrackIndexForDirection(1, playlistSource)).toBe(2);
    });

    it('keeps playlist album sequencing scoped to the filtered playlist order', () => {
        const tracks = [
            createTrack('01 Intro', 'Library/Artist/Album One/Disc 1'),
            createTrack('01 Elsewhere', 'Library/Artist/Album Two'),
            createTrack('02 Song', 'Library/Artist/Album One/Disc 1'),
        ];
        let currentTrackIndex = 2;

        const service = createPlaybackSequencingService({
            getTracks: () => tracks,
            getCurrentTrackIndex: () => currentTrackIndex,
            getReleaseDepthForTrack: () => 2,
            initialPlaybackOrderMode: 'ordered-album',
        });

        const playlistSource = { key: 'playlist::demo', indexes: [1, 2, 0] };

        expect(service.baseSequenceIndexes(playlistSource)).toEqual({
            indexes: [2, 0],
            currentPosition: 0,
        });
        expect(service.nextTrackIndexForDirection(1, playlistSource)).toBe(0);

        currentTrackIndex = 0;
        expect(service.peekNextTrackIndexForDirection(1, playlistSource)).toBe(2);
    });

    it('resets shuffle history when the active playlist source changes', () => {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
        const tracks = [
            createTrack('01 Alpha', 'Library/Album A'),
            createTrack('02 Beta', 'Library/Album B'),
            createTrack('03 Gamma', 'Library/Album C'),
        ];
        let currentTrackIndex = 0;
        const state = createPlaybackSequencingState('shuffle-library');

        const service = createPlaybackSequencingService({
            getTracks: () => tracks,
            getCurrentTrackIndex: () => currentTrackIndex,
            getReleaseDepthForTrack: () => 0,
            initialPlaybackOrderMode: 'shuffle-library',
        }, state);

        expect(service.peekNextTrackIndexForDirection(1, { key: 'playlist::first', indexes: [0, 1, 2] })).toBe(1);
        expect(state.shuffleScopeKey).toBe('source::playlist::first');

        expect(service.peekNextTrackIndexForDirection(1, { key: 'playlist::second', indexes: [0, 2] })).toBe(2);
        expect(state.shuffleHistory[0]).toBe(0);
        expect(state.shuffleScopeKey).toBe('source::playlist::second');
        expect(randomSpy).toHaveBeenCalled();
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

    it('removes silence placeholders from poisoned shuffle history and redraws immediately', () => {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
        const tracks = [
            createTrack('01 Alpha', 'Library/Album A'),
            createTrack('02 Silence', 'Library/Album B', { title: '(silence)', displayTitle: '(silence)' }),
            createTrack('03 Gamma', 'Library/Album C'),
        ];
        let currentTrackIndex = 1;
        const state = createPlaybackSequencingState('shuffle-library');
        state.shuffleHistory = [1];
        state.shuffleCursor = 0;
        state.shuffleScopeKey = 'library';

        const service = createPlaybackSequencingService({
            getTracks: () => tracks,
            getCurrentTrackIndex: () => currentTrackIndex,
            getReleaseDepthForTrack: () => 0,
            initialPlaybackOrderMode: 'shuffle-library',
        }, state);

        const nextTrackIndex = service.peekNextTrackIndexForDirection(1);
        expect(nextTrackIndex).toBe(2);
        expect(service.baseSequenceIndexes().indexes).not.toContain(1);
        expect(state.shuffleHistory).not.toContain(1);
        expect(state.shuffleHistory[0]).toBe(0);
        expect(randomSpy).toHaveBeenCalled();
    });

    it('realigns shuffle history after external gapless track advance', () => {
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

        // Simulate backend gapless transition: current track advanced to the queued track
        // without a direct nextTrackIndexForDirection call from the frontend.
        currentTrackIndex = 1;

        const peekedIndex = service.peekNextTrackIndexForDirection(1);
        expect(peekedIndex).toBeDefined();
        expect(peekedIndex).not.toBe(1);

        const nextTrackIndex = service.nextTrackIndexForDirection(1);
        expect(nextTrackIndex).toBeDefined();
        expect(nextTrackIndex).not.toBe(1);

        expect(randomSpy).toHaveBeenCalled();
    });

    it('mutates injected sequencing state instead of closure-local shuffle state', () => {
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
        const tracks = [
            createTrack('01 Alpha', 'Library/Album A'),
            createTrack('02 Beta', 'Library/Album B'),
            createTrack('03 Gamma', 'Library/Album C'),
        ];
        let currentTrackIndex = 0;
        const state = createPlaybackSequencingState('ordered-library');

        const service = createPlaybackSequencingService({
            getTracks: () => tracks,
            getCurrentTrackIndex: () => currentTrackIndex,
            getReleaseDepthForTrack: () => 0,
        }, state);

        expect(service.setPlaybackOrderMode('shuffle-library')).toBe(true);
        expect(state.playbackOrderMode).toBe('shuffle-library');
        expect(state.shuffleHistory).toEqual([]);
        expect(state.shuffleCursor).toBe(-1);
        expect(state.shuffleScopeKey).toBe('');

        expect(service.peekNextTrackIndexForDirection(1)).toBe(1);
        expect(state.shuffleHistory[0]).toBe(0);
        expect(state.shuffleCursor).toBe(0);
        expect(state.shuffleScopeKey).toBe('library');

        const nextTrackIndex = service.nextTrackIndexForDirection(1);
        expect(nextTrackIndex).toBe(1);
        currentTrackIndex = nextTrackIndex ?? -1;
        expect(service.nextTrackIndexForDirection(-1)).toBe(0);
        expect(state.shuffleCursor).toBe(0);
        expect(randomSpy).toHaveBeenCalled();
    });
});