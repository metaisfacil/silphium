import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createArtistInfoController } from './artist-info-controller';
import type { ArtistDetails, Track } from '../types/app-types';

const createTrack = (artistMbids: string[] = ['artist-id']): Track => ({
    title: 'Track',
    name: 'Track',
    path: '/music/track.flac',
    relativePath: 'Library/track.flac',
    folderPath: 'Library',
    rootPath: '/music',
    rootName: 'Library',
    displayTitle: 'Track',
    displayAlbum: 'Album',
    displayArtist: 'Artist',
    displayTrackNumber: '',
    displayTrackTotal: '',
    displayTechnical: '',
    displayLyrics: '',
    tagsResolved: true,
    mbMetadataResolved: false,
    technicalDetails: {},
    allFileTags: {},
    mbIds: {},
    artistMbids,
    mbArtistCredits: [],
});

const createElements = () => ({
    artistInfoName: document.createElement('p'),
    artistInfoType: document.createElement('p'),
    artistInfoCountry: document.createElement('p'),
    artistInfoLifeSpan: document.createElement('p'),
    artistInfoGenres: document.createElement('p'),
    artistInfoSummary: document.createElement('p'),
    artistInfoLinks: document.createElement('div'),
});

const createArtistDetails = (overrides: Partial<ArtistDetails> = {}): ArtistDetails => ({
    found: false,
    mbid: 'artist-id',
    name: '',
    type: '',
    country: '',
    disambiguation: '',
    lifeSpan: '',
    genres: [],
    ...overrides,
});

describe('artist-info-controller', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('resets the artist panel and hides links when no urls are present', () => {
        const elements = createElements();
        const controller = createArtistInfoController({
            elements,
            getTracks: (): Track[] => [createTrack()],
            getCurrentTrackIndex: () => 0,
            getRequestVersion: () => 1,
            lookupArtistByMBID: vi.fn(async () => createArtistDetails({ found: true })),
            openUrl: vi.fn(),
        });

        controller.reset();

        expect(elements.artistInfoName.textContent).toBe('No artist info');
        expect(elements.artistInfoType.textContent).toBe('Type: —');
        expect(elements.artistInfoCountry.textContent).toBe('Country: —');
        expect(elements.artistInfoLifeSpan.textContent).toBe('Life span: —');
        expect(elements.artistInfoGenres.textContent).toBe('Genres: —');
        expect(elements.artistInfoSummary.textContent).toBe('Flip back after MBID lookup to see details.');
        expect(elements.artistInfoLinks.hidden).toBe(true);
    });

    it('hydrates artist info, groups urls, toggles panels, caches results, and opens links', async () => {
        const elements = createElements();
        const lookupArtistByMBID = vi.fn(async () => createArtistDetails({
            found: true,
            name: 'Artist Name',
            type: 'Person',
            country: 'JP',
            lifeSpan: '1980-',
            genres: ['ambient', 'electronic'],
            urls: [
                { type: 'Official homepage', resource: 'https://artist.example/home' },
                { type: 'Discography', resource: 'https://artist.example/discography' },
                { type: 'Youtube', resource: 'https://youtube.com/watch?v=123' },
                { type: 'Discogs', resource: 'https://discogs.com/artist/123' },
                { type: '', resource: 'not a url' },
            ],
        }));
        const openUrl = vi.fn();
        const controller = createArtistInfoController({
            elements,
            getTracks: (): Track[] => [createTrack()],
            getCurrentTrackIndex: () => 0,
            getRequestVersion: () => 2,
            lookupArtistByMBID,
            openUrl,
        });

        Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 120 });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            width: 120,
            height: 20,
            top: 0,
            left: 0,
            right: 120,
            bottom: 20,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        } as DOMRect);

        await controller.hydrate(0);

        expect(elements.artistInfoName.textContent).toBe('Artist Name');
        expect(elements.artistInfoType.textContent).toBe('Type: Person');
        expect(elements.artistInfoCountry.textContent).toBe('Country: JP');
        expect(elements.artistInfoLifeSpan.textContent).toBe('Life span: 1980-');
        expect(elements.artistInfoGenres.textContent).toBe('Genres: ambient, electronic');
        expect(elements.artistInfoSummary.textContent).toBe('');
        expect(elements.artistInfoLinks.hidden).toBe(false);

        const toggles = Array.from(elements.artistInfoLinks.querySelectorAll('.artist-link-group-toggle')) as HTMLButtonElement[];
        expect(toggles.length).toBeGreaterThanOrEqual(4);

        toggles[0].click();
        expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
        vi.runAllTimers();
        toggles[0].click();
        expect(toggles[0].getAttribute('aria-expanded')).toBe('false');

        const firstLinkButton = elements.artistInfoLinks.querySelector('.artist-link-btn') as HTMLButtonElement;
        firstLinkButton.click();
        expect(openUrl).toHaveBeenCalledWith('https://artist.example/home');

        const firstIcon = elements.artistInfoLinks.querySelector('.artist-link-icon') as HTMLImageElement;
        firstIcon.dispatchEvent(new Event('error'));
        expect(elements.artistInfoLinks.querySelector('.artist-link-fallback')?.hasAttribute('hidden')).toBe(false);

        await controller.hydrate(0);
        expect(lookupArtistByMBID).toHaveBeenCalledTimes(1);

        controller.clearCache();
        await controller.hydrate(0);
        expect(lookupArtistByMBID).toHaveBeenCalledTimes(2);
    });

    it('handles missing mbids, not-found results, stale requests, and errors', async () => {
        const elements = createElements();
        let requestVersion = 1;
        let currentTrackIndex = 0;
        const lookupArtistByMBID = vi.fn(async () => createArtistDetails({ found: false }));
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const controller = createArtistInfoController({
            elements,
            getTracks: (): Track[] => [createTrack([]), createTrack(['artist-id'])],
            getCurrentTrackIndex: () => currentTrackIndex,
            getRequestVersion: () => requestVersion,
            lookupArtistByMBID,
            openUrl: vi.fn(),
        });

        await controller.hydrate(0);
        expect(elements.artistInfoName.textContent).toBe('No artist info');

        currentTrackIndex = 1;
        await controller.hydrate(1);
        expect(elements.artistInfoSummary.textContent).toBe('No artist details found for this MBID.');

        lookupArtistByMBID.mockImplementationOnce(async () => {
            requestVersion = 2;
            return createArtistDetails({ found: true, name: 'Late result', urls: [] });
        });
        await controller.hydrate(1);
        expect(elements.artistInfoName.textContent).not.toBe('Late result');

        lookupArtistByMBID.mockImplementationOnce(async () => {
            currentTrackIndex = 0;
            return createArtistDetails({ found: true, name: 'Wrong track', urls: [] });
        });
        await controller.hydrate(1);
        expect(elements.artistInfoName.textContent).not.toBe('Wrong track');

        requestVersion = 3;
        currentTrackIndex = 1;
        lookupArtistByMBID.mockRejectedValueOnce(new Error('network failed'));
        await controller.hydrate(1);
        expect(elements.artistInfoSummary.textContent).toBe('Unable to load artist details right now.');

        consoleErrorSpy.mockRestore();
    });
});