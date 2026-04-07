import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserOpenUrlMock } = vi.hoisted(() => ({
    browserOpenUrlMock: vi.fn(),
}));

vi.mock('../wailsjs/runtime/runtime', () => ({
    BrowserOpenURL: browserOpenUrlMock,
}));

import { applyMbLinks, openMbLink } from './musicbrainz';

describe('musicbrainz link helpers', () => {
    beforeEach(() => {
        browserOpenUrlMock.mockReset();
    });

    it('clears links when ids are missing and artist text is empty', () => {
        const title = document.createElement('p');
        const album = document.createElement('p');
        const artist = document.createElement('p');

        title.dataset.mbUrl = 'https://example.com/title';
        album.dataset.mbUrl = 'https://example.com/album';
        artist.dataset.mbUrl = 'https://example.com/artist';

        applyMbLinks(title, album, artist, {}, { artistText: '' });

        expect(title.dataset.mbUrl).toBeUndefined();
        expect(album.dataset.mbUrl).toBeUndefined();
        expect(artist.dataset.mbUrl).toBeUndefined();
        expect(artist.textContent).toBe('');
    });

    it('uses fallback, single-id, and first-id artist links when needed', () => {
        const title = document.createElement('p');
        const album = document.createElement('p');
        const artist = document.createElement('p');

        applyMbLinks(title, album, artist, { artistId: 'fallback-artist' }, { artistText: 'Fallback Artist' });
        expect(artist.dataset.mbUrl).toBe('https://musicbrainz.org/artist/fallback-artist');

        applyMbLinks(title, album, artist, {}, { artistText: 'Single Artist', artistMbids: [' single-artist '] });
        expect(artist.dataset.mbUrl).toBe('https://musicbrainz.org/artist/single-artist');

        applyMbLinks(title, album, artist, {}, { artistText: 'Multi Artist', artistMbids: ['first-artist', 'second-artist'] });
        expect(artist.dataset.mbUrl).toBe('https://musicbrainz.org/artist/first-artist');

        artist.textContent = 'Existing Artist';
        applyMbLinks(title, album, artist, {}, undefined);
        expect(artist.textContent).toBe('Existing Artist');

        applyMbLinks(title, album, artist, { artistId: 'fallback-empty' }, { artistText: 'Trimmed Empty', artistMbids: ['   '] });
        expect(artist.dataset.mbUrl).toBe('https://musicbrainz.org/artist/fallback-empty');
    });

    it('renders title album and multi-artist credit links', () => {
        const title = document.createElement('p');
        const album = document.createElement('p');
        const artist = document.createElement('p');

        applyMbLinks(
            title,
            album,
            artist,
            {
                recordingId: 'recording-id',
                releaseId: 'release-id',
                artistId: 'fallback-artist',
            },
            {
                artistText: 'Ignored Artist Label',
                artistMbids: [' artist-one ', 'artist-two', 'ARTIST-ONE'],
                artistCredits: [
                    { name: ' Artist One ', artistId: ' ', joinPhrase: ' feat. ' },
                    { name: '   ', artistId: 'skipped', joinPhrase: ', ' },
                    { name: 'Artist Two', artistId: ' artist-two ', joinPhrase: '' },
                ],
            },
        );

        const artistLinks = Array.from(artist.querySelectorAll('.track-artist-link')) as HTMLSpanElement[];

        expect(title.dataset.mbUrl).toBe('https://musicbrainz.org/recording/recording-id');
        expect(album.dataset.mbUrl).toBe('https://musicbrainz.org/release/release-id');
        expect(artistLinks).toHaveLength(2);
        expect(artistLinks[0].textContent).toBe('Artist One');
        expect(artistLinks[0].dataset.mbUrl).toBe('https://musicbrainz.org/artist/artist-one');
        expect(artistLinks[1].textContent).toBe('Artist Two');
        expect(artistLinks[1].dataset.mbUrl).toBe('https://musicbrainz.org/artist/artist-two');
        expect(artist.textContent).toBe('Artist One feat. Artist Two');
    });

    it('opens the closest link target and falls back to the element dataset', () => {
        const parent = document.createElement('button');
        const child = document.createElement('span');
        parent.dataset.mbUrl = 'https://musicbrainz.org/release/parent';
        parent.append(child);

        const direct = document.createElement('button');
        direct.dataset.mbUrl = 'https://musicbrainz.org/artist/direct';

        openMbLink(child);
        openMbLink(direct);
        openMbLink(document.createElement('div'));

        expect(browserOpenUrlMock).toHaveBeenCalledTimes(2);
        expect(browserOpenUrlMock).toHaveBeenNthCalledWith(1, 'https://musicbrainz.org/release/parent');
        expect(browserOpenUrlMock).toHaveBeenNthCalledWith(2, 'https://musicbrainz.org/artist/direct');
    });
});