import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    audioGetVisualizationFrameMock,
    createCoverArtServiceMock,
    createListenBrainzControllerMock,
    createListenBrainzSocialControllerMock,
    createPlaybackSequencingServiceMock,
    createPlaybackStateServiceMock,
    createScrobbleServiceMock,
    createSidebarControllerMock,
    createTrackMetadataServiceMock,
    createVisualizerControllerMock,
    logFrontendMessageMock,
} = vi.hoisted(() => ({
    audioGetVisualizationFrameMock: vi.fn(),
    createCoverArtServiceMock: vi.fn(() => ({
        getCachedMediaArtwork: vi.fn(() => []),
    })),
    createListenBrainzControllerMock: vi.fn(() => ({
        canScrobble: vi.fn(() => false),
        closeMenu: vi.fn(),
        resetFeedbackState: vi.fn(),
        refreshFeedbackForCurrentTrack: vi.fn(async () => undefined),
        submitFeedbackForTrack: vi.fn(async () => undefined),
    })),
    createListenBrainzSocialControllerMock: vi.fn(() => ({
        showLibrary: vi.fn(),
        showSocial: vi.fn(),
        isSocialActive: vi.fn(() => false),
    })),
    createPlaybackSequencingServiceMock: vi.fn(() => ({})),
    createPlaybackStateServiceMock: vi.fn(() => ({
        getPlaybackState: vi.fn(() => ({
            loaded: true,
            playing: true,
            currentTime: 0,
            duration: 180,
            volume: 1,
            sourcePath: '/music/track.flac',
            endEventId: 0,
        })),
    })),
    createScrobbleServiceMock: vi.fn(() => ({})),
    createSidebarControllerMock: vi.fn(() => ({
        showLibrary: vi.fn(),
        showSocial: vi.fn(),
    })),
    createTrackMetadataServiceMock: vi.fn(() => ({
        ensureTrackTagsResolved: vi.fn(async () => undefined),
    })),
    createVisualizerControllerMock: vi.fn((options?: unknown) => {
        void options;
        return {
            dispose: vi.fn(),
            setEnabled: vi.fn(),
            setEqualizerPosition: vi.fn(),
            setLissajousScale: vi.fn(),
            setMode: vi.fn(),
            setPlaybackState: vi.fn(),
            start: vi.fn(),
        };
    }),
    logFrontendMessageMock: vi.fn(async () => undefined),
}));

vi.mock('../wailsjs/go/main/App', () => ({
    AddListenHistoryEntry: vi.fn(async () => true),
    AudioGetVisualizationFrame: audioGetVisualizationFrameMock,
    GetInternalCoverArtConfig: vi.fn(async () => ({})),
    GetLastFmFollowing: vi.fn(async () => []),
    GetLastFmFollowingFeed: vi.fn(async () => []),
    GetLibraryFolderCoverPath: vi.fn(async () => ''),
    GetListenBrainzFollowing: vi.fn(async () => []),
    GetListenBrainzFollowingFeed: vi.fn(async () => []),
    GetListenBrainzRecordingFeedback: vi.fn(async () => 0),
    LogFrontendMessage: logFrontendMessageMock,
    ReadFileBase64: vi.fn(async () => ''),
    ReadImageThumbnail: vi.fn(async () => ({})),
    ReadTrackEmbeddedCover: vi.fn(async () => ({})),
    ReadTrackTags: vi.fn(async () => ({})),
    SubmitLastFm: vi.fn(async () => undefined),
    SubmitLastFmLove: vi.fn(async () => undefined),
    SubmitLastFmUnlove: vi.fn(async () => undefined),
    SubmitListenBrainz: vi.fn(async () => undefined),
    SubmitListenBrainzRecordingFeedback: vi.fn(async () => undefined),
}));

vi.mock('../wailsjs/runtime/runtime', () => ({
    BrowserOpenURL: vi.fn(async () => undefined),
}));

vi.mock('./controllers/listenbrainz-controller', () => ({
    createListenBrainzController: createListenBrainzControllerMock,
}));

vi.mock('./controllers/listenbrainz-social-controller', () => ({
    createListenBrainzSocialController: createListenBrainzSocialControllerMock,
}));

vi.mock('./controllers/sidebar-controller', () => ({
    createSidebarController: createSidebarControllerMock,
}));

vi.mock('./controllers/visualizer-controller', () => ({
    createVisualizerController: createVisualizerControllerMock,
}));

vi.mock('./services/cover-art-service', () => ({
    createCoverArtService: createCoverArtServiceMock,
}));

vi.mock('./services/playback-sequencing-service', () => ({
    createPlaybackSequencingService: createPlaybackSequencingServiceMock,
}));

vi.mock('./services/playback-state-service', () => ({
    createPlaybackStateService: createPlaybackStateServiceMock,
}));

vi.mock('./services/scrobble-service', () => ({
    createScrobbleService: createScrobbleServiceMock,
}));

vi.mock('./services/track-metadata-service', () => ({
    createTrackMetadataService: createTrackMetadataServiceMock,
}));

vi.mock('./musicbrainz', () => ({
    openMbLink: vi.fn(),
}));

vi.mock('./utils/musicbrainz-entity-helpers', () => ({
    lookupMusicBrainzTrackMetadata: vi.fn(async () => ({})),
    musicBrainzMBIDSearchQuery: vi.fn((entityType: string, mbid: string) => mbid ? `mbid-${entityType}:${mbid.toLowerCase()}` : ''),
    setMusicBrainzRequestLogServerResolver: vi.fn(),
}));

vi.mock('./utils/lastfm-request-scheduler', () => ({
    scheduleLastFmRequest: vi.fn(async (callback: () => Promise<unknown> | unknown) => await callback()),
}));

vi.mock('./utils/musicbrainz-request-scheduler', () => ({
    scheduleListenBrainzRequest: vi.fn(async (callback: () => Promise<unknown> | unknown) => await callback()),
}));

import type { ListenBrainzSocialControllerOptions } from './controllers/listenbrainz-social-controller';
import { artistFilterSearchQueryForTarget, createAppCoreServicesRuntime } from './app-core-services-runtime';
import type { AppCoreServicesRuntimeContext } from './app-runtime-setup';
import { resetBridgeLoadGateForTests, shouldDeferBackgroundBridgeCall } from './utils/bridge-load-gate';
import { GetLastFmFollowing, GetLastFmFollowingFeed, GetListenBrainzFollowing, GetListenBrainzFollowingFeed, SubmitLastFmLove } from '../wailsjs/go/main/App';

const createTrack = () => ({
    title: 'Track',
    name: 'track.flac',
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
    mbIds: {},
    artistMbids: [],
    mbArtistCredits: [],
});

const createContext = (): AppCoreServicesRuntimeContext => {
    const librarySearch = document.createElement('input');
    const playlistController = {
        closeMenu: vi.fn(),
    };
    const libraryController = {
        isSidebarOpen: vi.fn(() => false),
        navigateToFolder: vi.fn(),
        setSidebarExpanded: vi.fn(),
        setSidebarOpen: vi.fn(),
        startLibrarySearch: vi.fn(),
    };

    return {
        app: document.createElement('div'),
        currentSettings: {
            coverArtPriority: 'folder',
            equalizerPosition: 'bottom',
            lastFmApiKey: '',
            lastFmApiSecret: '',
            lastFmSessionKey: '',
            listenBrainzServerUrl: '',
            listenBrainzUserToken: '',
            localLibraryFilesDatabaseEnabled: false,
            localLibraryFilesDatabaseListenHistoryEnabled: false,
            localLibraryFilesDatabaseListenHistoryThresholdSeconds: 0,
            lissajousEnabled: true,
            lissajousScale: 0.25,
            musicBrainzServerUrl: '',
            musicBrainzTagDatabaseEnabled: false,
            preferMusicBrainzMetadata: false,
            visualizerMode: 'lissajous',
        } as never,
        playbackSequencingState: {} as never,
        playbackSessionState: {} as never,
        scrobbleSessionState: {} as never,
        tracks: [createTrack()],
        imageFiles: [],
        currentTrackIndex: 0,
        releaseDepthForTrack: vi.fn(() => 0),
        tagRequestVersion: 0,
        objectUrls: [],
        playerVisualizerCanvas: document.createElement('canvas'),
        coverArt: document.createElement('img'),
        playerCard: document.createElement('div'),
        listenBrainzLoveBtn: document.createElement('button'),
        listenBrainzFeedbackMenu: document.createElement('div'),
        listenBrainzFeedbackLoveBtn: document.createElement('button'),
        listenBrainzFeedbackHateBtn: document.createElement('button'),
        closePlayOrderMenu: vi.fn(),
        closeTrackMetaMenu: vi.fn(),
        closeSidebarQueueMenu: vi.fn(),
        playlistController: () => playlistController as never,
        libraryController: () => libraryController as never,
        librarySearch,
        sidebarToggle: document.createElement('button'),
        libraryExpandToggle: document.createElement('button'),
        sidebarSectionTrigger: document.createElement('button'),
        sidebarSectionTriggerLabel: document.createElement('div'),
        sidebarSectionMenu: document.createElement('div'),
        sidebarSectionOptionLibrary: document.createElement('button'),
        sidebarSectionOptionSocial: document.createElement('button'),
        sidebarPaneLibrary: document.createElement('div'),
        sidebarPaneSocial: document.createElement('div'),
        socialFeedStatus: document.createElement('div'),
        socialFeedList: document.createElement('div'),
        trackTitle: document.createElement('div'),
        trackAlbum: document.createElement('div'),
        trackArtist: document.createElement('div'),
        trackTitleInline: document.createElement('div'),
        trackReleaseAlbum: document.createElement('div'),
        trackReleaseLabel: document.createElement('div'),
        trackArtistHeader: document.createElement('div'),
        openMusicBrainzEntityForCurrentTrack: vi.fn(async () => undefined),
        openTrackMetaMenu: vi.fn(),
        setTrackMetaMenuTarget: vi.fn(),
        getCoverArtImageSource: vi.fn(() => undefined),
    } as unknown as AppCoreServicesRuntimeContext;
};

describe('createAppCoreServicesRuntime', () => {
    beforeEach(() => {
        resetBridgeLoadGateForTests();
    });

    afterEach(() => {
        resetBridgeLoadGateForTests();
        vi.clearAllMocks();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('does not block later background bridge work after a slow visualizer fetch', async () => {
        const context = createContext();
        let nowMs = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
        vi.mocked(audioGetVisualizationFrameMock).mockImplementation(async () => {
            nowMs += 85;
            return {
                loaded: true,
                playing: true,
                sourcePath: '/music/track.flac',
                sampleRate: 44100,
                channelCount: 2,
                frameCount: 4,
                sampleStride: 1,
                peak: 0.5,
                samples: [100, -100, 200, -200, 300, -300, 400, -400],
            };
        });

        createAppCoreServicesRuntime(context);

        const visualizerCalls = createVisualizerControllerMock.mock.calls as Array<[{ fetchVisualizationFrame: (frameCount: number) => Promise<unknown> }] | undefined>;
        const visualizerOptions = visualizerCalls[0]?.[0];
        expect(visualizerOptions).toBeDefined();
        expect(shouldDeferBackgroundBridgeCall()).toBe(false);

        await visualizerOptions?.fetchVisualizationFrame(192);

        expect(audioGetVisualizationFrameMock).toHaveBeenCalledWith(192);
        expect(shouldDeferBackgroundBridgeCall()).toBe(false);
    });

    it('keeps social results from successful providers when ListenBrainz requests fail', async () => {
        const context = createContext();
        context.currentSettings.listenBrainzUserToken = 'lb-token';
        context.currentSettings.lastFmApiKey = 'lfm-key';
        context.currentSettings.lastFmApiSecret = 'lfm-secret';
        context.currentSettings.lastFmSessionKey = 'lfm-session';
        createListenBrainzControllerMock.mockReturnValueOnce({
            canScrobble: vi.fn(() => true),
            closeMenu: vi.fn(),
            resetFeedbackState: vi.fn(),
            refreshFeedbackForCurrentTrack: vi.fn(async () => undefined),
            submitFeedbackForTrack: vi.fn(async () => undefined),
        });

        vi.mocked(GetListenBrainzFollowing).mockRejectedValueOnce(new Error('context deadline exceeded'));
        vi.mocked(GetLastFmFollowing).mockResolvedValueOnce(['lastfm-user']);
        vi.mocked(GetListenBrainzFollowingFeed).mockRejectedValueOnce(new Error('wsarecv: An existing connection was forcibly closed by the remote host.'));
        vi.mocked(GetLastFmFollowingFeed).mockResolvedValueOnce([{
            id: 1,
            created: 1710000100,
            eventType: 'listen',
            hidden: false,
            userName: 'lastfm-user',
            listenedAt: 1710000000,
            listenedAtIso: '2024-03-09T16:00:00Z',
            playingNow: false,
            trackMetadata: {
                artistName: 'Artist',
                trackName: 'Track',
                releaseName: 'Album',
                additionalInfo: {
                    musicServiceName: 'Last.fm',
                },
            },
        }] as never);

        createAppCoreServicesRuntime(context);

        const socialCalls = createListenBrainzSocialControllerMock.mock.calls as unknown as Array<[ListenBrainzSocialControllerOptions]>;
        const socialOptions = socialCalls[0]?.[0];
        expect(socialOptions).toBeDefined();

        await expect(socialOptions?.fetchFollowingUsers()).resolves.toEqual({
            data: ['lastfm-user'],
            warnings: ['ListenBrainz following request timed out.'],
        });
        await expect(socialOptions?.fetchFollowingFeed(40)).resolves.toEqual({
            data: [{
                id: 1,
                created: 1710000100,
                eventType: 'listen',
                hidden: false,
                userName: 'lastfm-user',
                listenedAt: 1710000000,
                listenedAtIso: '2024-03-09T16:00:00Z',
                playingNow: false,
                trackMetadata: {
                    artistName: 'Artist',
                    trackName: 'Track',
                    releaseName: 'Album',
                    additionalInfo: {
                        musicServiceName: 'Last.fm',
                    },
                },
            }],
            warnings: ['ListenBrainz feed connection was closed by the remote host.'],
        });
    });

    it('keeps the player-card album title while Last.fm feedback uses the tagged album title', async () => {
        const context = createContext();
        context.currentSettings.lastFmApiKey = 'lfm-key';
        context.currentSettings.lastFmApiSecret = 'lfm-secret';
        context.currentSettings.lastFmSessionKey = 'lfm-session';
        context.tracks[0] = {
            ...createTrack(),
            displayAlbum: 'Brilliant Anthology (初回限定盤)',
            allFileTags: {
                album: ['Brilliant Anthology'],
            },
            mbIds: {
                recordingId: 'recording-123',
            },
        };

        createAppCoreServicesRuntime(context);

        const controllerCalls = createListenBrainzControllerMock.mock.calls as unknown as Array<[{ 
            onFeedbackSubmitted?: (track: (typeof context.tracks)[number], score: -1 | 0 | 1) => Promise<void> | void;
        }]>
        const controllerOptions = controllerCalls[0]?.[0] as {
            onFeedbackSubmitted?: (track: (typeof context.tracks)[number], score: -1 | 0 | 1) => Promise<void> | void;
        } | undefined;
        expect(controllerOptions).toBeDefined();

        await controllerOptions?.onFeedbackSubmitted?.(context.tracks[0], 1);

        expect(context.tracks[0].displayAlbum).toBe('Brilliant Anthology (初回限定盤)');
        expect(SubmitLastFmLove).toHaveBeenCalledWith(expect.objectContaining({
            releaseName: 'Brilliant Anthology',
        }));
    });

    it('builds an artist MBID sidebar filter query from a nested player-card artist link', () => {
        const track = {
            ...createTrack(),
            mbIds: {
                artistId: 'artist-primary',
            },
            allFileTags: {
                MUSICBRAINZ_ARTISTID: ['artist-primary; artist-secondary'],
            },
            artistMbids: ['artist-primary', 'artist-secondary'],
            mbArtistCredits: [
                { name: 'Primary Artist', artistId: 'artist-primary', joinPhrase: ' feat. ' },
                { name: 'Guest Artist', artistId: 'artist-secondary', joinPhrase: '' },
            ],
        };
        const trackArtistHeader = document.createElement('div');
        trackArtistHeader.innerHTML = '<span class="track-artist-link" data-mb-url="https://musicbrainz.org/artist/artist-secondary">Guest Artist</span>';

        const guestArtistLink = trackArtistHeader.querySelector('.track-artist-link') as HTMLElement;

        expect(artistFilterSearchQueryForTarget(track, guestArtistLink)).toBe('mbid-artist:artist-secondary');
    });

    it('returns no artist sidebar filter query when the track lacks tagged artist MBIDs', () => {
        const track = {
            ...createTrack(),
            mbIds: {},
            allFileTags: {},
            artistMbids: ['derived-artist-id'],
            mbArtistCredits: [
                { name: 'Derived Artist', artistId: 'derived-artist-id', joinPhrase: '' },
            ],
        };
        const trackArtistHeader = document.createElement('div');
        trackArtistHeader.innerHTML = '<span class="track-artist-link" data-mb-url="https://musicbrainz.org/artist/derived-artist-id">Derived Artist</span>';

        const derivedArtistLink = trackArtistHeader.querySelector('.track-artist-link') as HTMLElement;

        expect(artistFilterSearchQueryForTarget(track, derivedArtistLink)).toBe('');
    });

    it('uses the clicked artist MBID when the track has tagged artist MBIDs but the clicked credit is not in that tagged set', () => {
        const track = {
            ...createTrack(),
            mbIds: {
                artistId: 'artist-primary',
            },
            allFileTags: {
                MUSICBRAINZ_ARTISTID: ['artist-primary'],
            },
            artistMbids: ['artist-primary', 'artist-guest'],
            mbArtistCredits: [
                { name: 'Primary Artist', artistId: 'artist-primary', joinPhrase: ' feat. ' },
                { name: 'Guest Artist', artistId: 'artist-guest', joinPhrase: '' },
            ],
        };
        const trackArtistHeader = document.createElement('div');
        trackArtistHeader.innerHTML = '<span class="track-artist-link" data-mb-url="https://musicbrainz.org/artist/artist-guest">Guest Artist</span>';

        const guestArtistLink = trackArtistHeader.querySelector('.track-artist-link') as HTMLElement;

        expect(artistFilterSearchQueryForTarget(track, guestArtistLink)).toBe('mbid-artist:artist-guest');
    });
});