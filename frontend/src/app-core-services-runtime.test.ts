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
    setMusicBrainzRequestLogServerResolver: vi.fn(),
}));

vi.mock('./utils/lastfm-request-scheduler', () => ({
    scheduleLastFmRequest: vi.fn(async (callback: () => Promise<unknown> | unknown) => await callback()),
}));

vi.mock('./utils/musicbrainz-request-scheduler', () => ({
    scheduleListenBrainzRequest: vi.fn(async (callback: () => Promise<unknown> | unknown) => await callback()),
}));

import { createAppCoreServicesRuntime } from './app-core-services-runtime';
import type { AppCoreServicesRuntimeContext } from './app-runtime-setup';
import { resetBridgeLoadGateForTests, shouldDeferBackgroundBridgeCall } from './utils/bridge-load-gate';

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
});