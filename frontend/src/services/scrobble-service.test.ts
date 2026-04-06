import { describe, expect, it, vi } from 'vitest';

import type { AudioPlaybackState, Track } from '../types/app-types';
import { createScrobbleService } from './scrobble-service';

const createTrack = (overrides: Partial<Track> = {}): Track => ({
    title: 'Fallback Title',
    name: 'Fallback Title',
    path: '/music/artist/album/fallback.flac',
    relativePath: 'artist/album/fallback.flac',
    folderPath: 'Library/Artist/Album',
    rootPath: '/music',
    rootName: 'Library',
    displayTitle: 'Resolved Title',
    displayAlbum: 'Resolved Album',
    displayArtist: 'Resolved Artist',
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
    ...overrides,
});

const createPlaybackState = (overrides: Partial<AudioPlaybackState> = {}): AudioPlaybackState => ({
    loaded: true,
    playing: true,
    currentTime: 200,
    duration: 300,
    volume: 1,
    sourcePath: '/music/artist/album/fallback.flac',
    endEventId: 0,
    ...overrides,
});

describe('createScrobbleService', () => {
    it('does not submit now-playing or scrobble events until tags are resolved', () => {
        const submitListenBrainz = vi.fn(async () => undefined);
        const service = createScrobbleService({ submitListenBrainz });
        service.startTrackSession();

        const state = createPlaybackState();
        const unresolvedTrack = createTrack({
            displayArtist: 'Unknown Artist',
            tagsResolved: false,
        });

        service.maybeSubmit(state, unresolvedTrack, true);

        expect(submitListenBrainz).not.toHaveBeenCalled();

        const resolvedTrack = createTrack({ tagsResolved: true });
        service.maybeSubmit(state, resolvedTrack, true);

        expect(submitListenBrainz).toHaveBeenCalledTimes(2);
        expect(submitListenBrainz).toHaveBeenNthCalledWith(
            1,
            'playing_now',
            expect.objectContaining({ artistName: 'Resolved Artist' }),
            0,
        );
        expect(submitListenBrainz).toHaveBeenNthCalledWith(
            2,
            'single',
            expect.objectContaining({ artistName: 'Resolved Artist' }),
            expect.any(Number),
        );
    });
});
