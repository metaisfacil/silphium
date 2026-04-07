import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    browserOpenUrlMock,
    lookupEntityMock,
    lookupExplorationMock,
    lookupTrackMetadataMock,
    scheduleMusicBrainzRequestMock,
} = vi.hoisted(() => ({
    browserOpenUrlMock: vi.fn(),
    lookupEntityMock: vi.fn(),
    lookupExplorationMock: vi.fn(),
    lookupTrackMetadataMock: vi.fn(),
    scheduleMusicBrainzRequestMock: vi.fn(async (factory: () => Promise<unknown>) => await factory()),
}));

vi.mock('../../wailsjs/go/main/App', () => ({
    LookupMusicBrainzEntity: lookupEntityMock,
    LookupMusicBrainzExploration: lookupExplorationMock,
    LookupTrackMusicBrainzMetadata: lookupTrackMetadataMock,
}));

vi.mock('../../wailsjs/runtime/runtime', () => ({
    BrowserOpenURL: browserOpenUrlMock,
}));

vi.mock('./musicbrainz-request-scheduler', () => ({
    scheduleMusicBrainzRequest: scheduleMusicBrainzRequestMock,
}));

import {
    emptyMusicBrainzEntityInfo,
    faviconUrlForResource,
    lookupMusicBrainzEntity,
    lookupMusicBrainzExploration,
    lookupMusicBrainzTrackMetadata,
    mbidForTrackEntity,
    renderMusicBrainzEntityContent,
    setMusicBrainzRequestLogServerResolver,
} from './musicbrainz-entity-helpers';
import type { MusicBrainzEntityInfo, Track } from '../types/app-types';

const createTrack = (): Track => ({
    title: 'Track',
    name: 'Track',
    path: '/music/track.flac',
    relativePath: 'track.flac',
    folderPath: '/music',
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
    mbIds: {
        recordingId: 'recording-id',
        releaseId: 'release-id',
        artistId: 'artist-id',
        labelId: 'label-id',
    },
    artistMbids: ['artist-id', 'artist-two'],
    mbArtistCredits: [{ name: 'Artist', artistId: 'artist-id', joinPhrase: '' }],
});

describe('musicbrainz entity helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setMusicBrainzRequestLogServerResolver(null);
    });

    it('returns empty track metadata when the release id is blank', async () => {
        setMusicBrainzRequestLogServerResolver(() => '   ');
        expect(await lookupMusicBrainzTrackMetadata('   ')).toEqual({
            found: false,
            recordingId: '',
            releaseId: '',
            title: '',
            album: '',
            artist: '',
            artistCredits: [],
        });
        expect(scheduleMusicBrainzRequestMock).not.toHaveBeenCalled();
    });

    it('looks up track metadata and falls back on request errors', async () => {
        setMusicBrainzRequestLogServerResolver(() => ' https://musicbrainz.example ');
        lookupTrackMetadataMock.mockResolvedValueOnce({ found: true, releaseId: 'release-id', title: 'Track' });

        expect(await lookupMusicBrainzTrackMetadata(' release-id ')).toEqual({ found: true, releaseId: 'release-id', title: 'Track' });
        expect(scheduleMusicBrainzRequestMock).toHaveBeenCalledWith(expect.any(Function), {
            server: 'https://musicbrainz.example',
            path: '/ws/2/release/release-id?fmt=json&inc=artists+labels',
        });

        scheduleMusicBrainzRequestMock.mockRejectedValueOnce(new Error('network error'));
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(await lookupMusicBrainzTrackMetadata('broken-id')).toEqual({
            found: false,
            recordingId: '',
            releaseId: 'broken-id',
            title: '',
            album: '',
            artist: '',
            artistCredits: [],
        });
        consoleErrorSpy.mockRestore();
    });

    it('looks up entity and exploration data with fallbacks', async () => {
        lookupEntityMock.mockResolvedValueOnce({ found: true, entityType: 'artist', mbid: 'artist-id', title: 'Artist' });
        expect(await lookupMusicBrainzEntity('artist', 'artist-id')).toEqual({ found: true, entityType: 'artist', mbid: 'artist-id', title: 'Artist' });

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        scheduleMusicBrainzRequestMock.mockRejectedValueOnce(new Error('entity failed'));
        expect(await lookupMusicBrainzEntity('release', 'release-id')).toEqual(emptyMusicBrainzEntityInfo('release', 'release-id'));

        const track = createTrack();
        lookupExplorationMock.mockResolvedValueOnce({ found: true, nodes: [{ id: 'artist-id' }], edges: [], warnings: [], title: 'Graph', summary: 'Summary' });
        scheduleMusicBrainzRequestMock.mockImplementationOnce(async (factory) => await factory());
        expect(await lookupMusicBrainzExploration(track, 'req-1')).toEqual({ found: true, nodes: [{ id: 'artist-id' }], edges: [], warnings: [], title: 'Graph', summary: 'Summary' });

        scheduleMusicBrainzRequestMock.mockRejectedValueOnce(new Error('exploration failed'));
        expect(await lookupMusicBrainzExploration(track, 'req-2')).toEqual({
            found: false,
            title: 'MusicBrainz exploration',
            summary: 'No MusicBrainz exploration data found.',
            nodes: [],
            edges: [],
            warnings: [],
        });

        expect(await lookupMusicBrainzExploration({ ...track, mbIds: {}, artistMbids: [], mbArtistCredits: [] }, 'req-3')).toEqual({
            found: false,
            title: 'MusicBrainz exploration',
            summary: 'No MusicBrainz exploration data found.',
            nodes: [],
            edges: [],
            warnings: [],
        });
        consoleErrorSpy.mockRestore();
    });

    it('resolves track entity mbids and favicon urls', () => {
        const track = createTrack();

        expect(mbidForTrackEntity(track, 'recording')).toBe('recording-id');
        expect(mbidForTrackEntity({ ...track, mbIds: { ...track.mbIds, recordingId: '' } }, 'recording')).toBe('');
        expect(mbidForTrackEntity(track, 'release')).toBe('release-id');
        expect(mbidForTrackEntity({ ...track, mbIds: { ...track.mbIds, releaseId: '' } }, 'release')).toBe('');
        expect(mbidForTrackEntity(track, 'label')).toBe('label-id');
        expect(mbidForTrackEntity({ ...track, mbIds: { ...track.mbIds, labelId: '' } }, 'label')).toBe('');
        expect(mbidForTrackEntity({ ...track, mbIds: {}, artistMbids: ['artist-two'] }, 'artist')).toBe('artist-two');
        expect(mbidForTrackEntity({ ...track, mbIds: {}, artistMbids: [] }, 'artist')).toBe('');
        expect(faviconUrlForResource('https://example.com/page')).toBe('https://example.com/favicon.ico');
        expect(faviconUrlForResource('not a url')).toBeUndefined();
    });

    it('treats blank artist credit ids as absent during exploration lookups', async () => {
        const track = createTrack();
        lookupExplorationMock.mockResolvedValueOnce({ found: true, nodes: [], edges: [], warnings: [], title: 'Graph', summary: 'Summary' });

        await lookupMusicBrainzExploration({
            ...track,
            mbIds: { recordingId: '', releaseId: '', artistId: '', labelId: '' },
            artistMbids: [' artist-one '],
            mbArtistCredits: [{ name: 'Artist', artistId: '   ', joinPhrase: '' }],
        }, 'req-blank-credit');

        expect(lookupExplorationMock).toHaveBeenCalledWith('', '', ['artist-one'], '', 'req-blank-credit');
    });

    it('renders entity content with details, tags, links, and raw payload', () => {
        const title = document.createElement('h2');
        const content = document.createElement('div');

        const entityWithDetails: MusicBrainzEntityInfo = {
            found: true,
            entityType: 'artist',
            mbid: 'artist-id',
            title: 'Artist',
            subtitle: '',
            summary: 'Disambiguation text',
            facts: [{ label: 'Country', value: 'JP' }],
            tags: ['ambient', 'electronic'],
            urls: [
                { type: 'Official homepage', resource: 'https://example.com/home' },
                { type: 'Broken', resource: 'not a url' },
            ],
            rawJson: '{"name":"Artist"}',
        };

        renderMusicBrainzEntityContent(entityWithDetails, title, content);

        expect(title.textContent).toBe('MusicBrainz artist info');
        expect(content.querySelector('.mb-entity-fact-label')?.textContent).toBe('Country');
        expect(content.querySelectorAll('.mb-entity-tag')).toHaveLength(2);
        expect(content.querySelectorAll('.artist-link-btn')).toHaveLength(2);
        expect(content.querySelector('.mb-entity-raw')?.textContent).toBe('{"name":"Artist"}');

        const icon = content.querySelector('.artist-link-icon') as HTMLImageElement;
        icon.dispatchEvent(new Event('error'));
        expect(content.querySelector('.artist-link-fallback')?.hasAttribute('hidden')).toBe(false);

        (content.querySelector('.artist-link-btn') as HTMLButtonElement).click();
        expect(browserOpenUrlMock).toHaveBeenCalledWith('https://example.com/home');
    });

    it('renders empty-link fallback text and raw payload fallback when urls are absent', () => {
        const title = document.createElement('h2');
        const content = document.createElement('div');

        const emptyEntity: MusicBrainzEntityInfo = {
            found: false,
            entityType: 'label',
            mbid: 'label-id',
            title: '',
            subtitle: '',
            summary: '',
            facts: [],
            tags: [],
            urls: [],
            rawJson: '',
        };

        renderMusicBrainzEntityContent(emptyEntity, title, content);

        expect(title.textContent).toBe('MusicBrainz label info');
        expect(content.querySelector('.mb-entity-empty')?.textContent).toBe('None available.');
        expect(content.querySelector('.mb-entity-raw')?.textContent).toBe('No payload returned.');
    });

    it('renders only the sections that have content', () => {
        const title = document.createElement('h2');
        const content = document.createElement('div');

        const tagsOnlyEntity: MusicBrainzEntityInfo = {
            found: true,
            entityType: 'artist',
            mbid: 'artist-id',
            title: '',
            subtitle: '',
            summary: '',
            facts: [],
            tags: ['ambient'],
            urls: [],
            rawJson: '{}',
        };

        renderMusicBrainzEntityContent(tagsOnlyEntity, title, content);

        expect(content.querySelector('.mb-entity-facts')).toBeNull();
        expect(content.querySelectorAll('.mb-entity-section-title')[0]?.textContent).toBe('Tags / genres');
    });

    it('falls back to default labels when entity type and url type are missing', () => {
        const title = document.createElement('h2');
        const content = document.createElement('div');

        const fallbackEntity: MusicBrainzEntityInfo = {
            found: true,
            entityType: '',
            mbid: 'entity-id',
            title: '',
            subtitle: '',
            summary: '',
            facts: [],
            tags: [],
            urls: [{ type: '', resource: 'https://example.com/link' }],
            rawJson: '{}',
        };

        renderMusicBrainzEntityContent(fallbackEntity, title, content);

        expect(title.textContent).toBe('MusicBrainz entity info');
        expect((content.querySelector('.artist-link-btn') as HTMLButtonElement).title).toBe('Link: https://example.com/link');
    });
});