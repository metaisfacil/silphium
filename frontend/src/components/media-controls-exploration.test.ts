import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    browserOpenUrlMock,
    eventsOnMock,
    lookupMusicBrainzExplorationMock,
} = vi.hoisted(() => ({
    browserOpenUrlMock: vi.fn(),
    eventsOnMock: vi.fn(() => vi.fn()),
    lookupMusicBrainzExplorationMock: vi.fn(),
}));

vi.mock('../../wailsjs/runtime/runtime', () => ({
    BrowserOpenURL: browserOpenUrlMock,
    EventsOn: eventsOnMock,
}));

vi.mock('../utils/musicbrainz-entity-helpers', () => ({
    lookupMusicBrainzExploration: lookupMusicBrainzExplorationMock,
    musicBrainzMBIDSearchQuery: (entityType: string, mbid: string) => {
        const normalizedEntityType = entityType.trim().toLowerCase();
        const normalizedMBID = mbid.trim().toLowerCase();
        if (normalizedEntityType === 'artist') {
            return `mbid-artist:${normalizedMBID}`;
        }
        if (normalizedEntityType === 'release') {
            return `mbid-release:${normalizedMBID}`;
        }
        if (normalizedEntityType === 'recording') {
            return `mbid-recording:${normalizedMBID}`;
        }
        return '';
    },
}));

import type { Track } from '../types/app-types';
import { setupExplorationButton, updateExplorationButton } from './media-controls-exploration';

const flushPromises = async (): Promise<void> => {
    for (let index = 0; index < 4; index += 1) {
        await Promise.resolve();
    }
};

const createTrack = (): Track => ({
    title: 'Track',
    name: 'Track',
    path: '/music/track.flac',
    relativePath: 'Library/Artist/Album/Track.flac',
    folderPath: 'Library/Artist/Album',
    rootPath: '/music',
    rootName: 'Library',
    displayTitle: 'Track',
    displayAlbum: 'Album',
    displayArtist: 'Artist',
    displayTrackNumber: '1',
    displayTrackTotal: '1',
    displayTechnical: '',
    displayLyrics: '',
    tagsResolved: true,
    mbMetadataResolved: false,
    technicalDetails: {},
    allFileTags: {},
    mbIds: {
        artistId: '5e9450ca-77d5-4f64-a385-f453cfe98b24',
        releaseId: '11111111-1111-4111-8111-111111111111',
        recordingId: '22222222-2222-4222-8222-222222222222',
    },
    artistMbids: ['5e9450ca-77d5-4f64-a385-f453cfe98b24'],
    mbArtistCredits: [{ name: 'Artist', artistId: '5e9450ca-77d5-4f64-a385-f453cfe98b24', joinPhrase: '' }],
});

describe('media controls exploration', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        document.body.innerHTML = '<button id="exploration-btn" type="button"></button>';
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback): number => {
            callback(0);
            return 0;
        }) as typeof requestAnimationFrame);
    });

    it('closes the modal and opens MBID searches when artist or release nodes are clicked', async () => {
        const track = createTrack();
        const openLibrarySearch = vi.fn();

        lookupMusicBrainzExplorationMock.mockResolvedValue({
            found: true,
            title: 'Connection Explorer',
            summary: 'Connections',
            warnings: [],
            nodes: [
                {
                    id: 'artist:1',
                    entityType: 'artist',
                    kind: 'artist',
                    mbid: '5e9450ca-77d5-4f64-a385-f453cfe98b24',
                    label: 'Artist',
                    subtitle: 'Artist',
                    accent: '#ffffff',
                    emphasis: 2,
                    url: 'https://musicbrainz.org/artist/5e9450ca-77d5-4f64-a385-f453cfe98b24',
                },
                {
                    id: 'release:1',
                    entityType: 'release',
                    kind: 'release',
                    mbid: '11111111-1111-4111-8111-111111111111',
                    label: 'Release',
                    subtitle: 'Release',
                    accent: '#ffffff',
                    emphasis: 2,
                    url: 'https://musicbrainz.org/release/11111111-1111-4111-8111-111111111111',
                },
            ],
            edges: [],
        });

        setupExplorationButton(document, {
            getActiveTrack: () => track,
            openLibrarySearch,
        });
        updateExplorationButton(document, track);

        const button = document.querySelector('#exploration-btn') as HTMLButtonElement;
        button.click();
        await flushPromises();

        const modal = document.getElementById('exploration-modal') as HTMLDivElement;
        expect(modal.hidden).toBe(false);

        const artistNode = modal.querySelector('[data-node-id="artist:1"]') as SVGGElement;
        artistNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(openLibrarySearch).toHaveBeenCalledWith(
            'mbid-artist:5e9450ca-77d5-4f64-a385-f453cfe98b24',
            { expandFilteredFolders: true },
        );
        vi.runOnlyPendingTimers();
        expect(modal.hidden).toBe(true);

        openLibrarySearch.mockClear();
        button.click();
        await flushPromises();

        const reopenedModal = document.getElementById('exploration-modal') as HTMLDivElement;
        const releaseNode = reopenedModal.querySelector('[data-node-id="release:1"]') as SVGGElement;
        releaseNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(openLibrarySearch).toHaveBeenCalledWith(
            'mbid-release:11111111-1111-4111-8111-111111111111',
            { expandFilteredFolders: true },
        );
        vi.runOnlyPendingTimers();
        expect(reopenedModal.hidden).toBe(true);
        expect(browserOpenUrlMock).not.toHaveBeenCalled();
    });
});