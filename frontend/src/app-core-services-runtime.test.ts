import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverArtService } from './services/cover-art-service';

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
    createCoverArtServiceMock: vi.fn(),
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
        showNavigation: vi.fn(),
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
import { GetLastFmFollowing, GetLastFmFollowingFeed, GetListenBrainzFollowing, GetListenBrainzFollowingFeed, ReadImageThumbnail, SubmitLastFmLove } from '../wailsjs/go/main/App';

const createCoverArtServiceStub = (overrides: Partial<CoverArtService> = {}): CoverArtService => ({
    clearCache: vi.fn(),
    clearResolvedCache: vi.fn(),
    getCachedMediaArtwork: vi.fn((_track: Parameters<CoverArtService['getCachedMediaArtwork']>[0]) => undefined),
    getFolderCoverPath: vi.fn((_folderPath: string) => undefined),
    getKnownFolderCoverPaths: vi.fn((): Array<[string, string]> => []),
    getMusicBrainzCoverUrlForTrack: vi.fn((_track: Parameters<CoverArtService['getMusicBrainzCoverUrlForTrack']>[0]) => undefined),
    getResolvedSourceForTrack: vi.fn((_trackPath: string) => undefined),
    invalidateForTrack: vi.fn((_track: Parameters<CoverArtService['invalidateForTrack']>[0]) => undefined),
    invalidateResolvedForTrack: vi.fn((_track: Parameters<CoverArtService['invalidateResolvedForTrack']>[0]) => undefined),
    resolveFolderCoverPath: vi.fn(async (_folderPath: string) => undefined),
    resolveForTrack: vi.fn(async (_track: Parameters<CoverArtService['resolveForTrack']>[0]) => undefined),
    setFolderCoverPath: vi.fn((_folderPath: string, _coverPath: string) => undefined),
    ...overrides,
});

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

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
        overviewTracksCount: document.createElement('div'),
        overviewShowAlbums: document.createElement('button'),
        overviewShowRecents: document.createElement('button'),
        overviewAlbumsCount: document.createElement('div'),
        overviewArtistsCount: document.createElement('div'),
        overviewLibrariesCount: document.createElement('div'),
        overviewRecentsView: document.createElement('div'),
        overviewAlbumGridView: document.createElement('div'),
        overviewAlbumGrid: document.createElement('div'),
        overviewAlbumGridScrollRail: document.createElement('div'),
        overviewAlbumGridScrollPill: document.createElement('button'),
        overviewAlbumGridScrollHint: document.createElement('div'),
        overviewLastPlayedList: document.createElement('div'),
        overviewLastAddedList: document.createElement('div'),
        overviewPage: document.createElement('div'),
        playerLane: document.createElement('div'),
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
        libraryHeaderTitleText: document.createElement('span'),
        sidebarNavPane: document.createElement('div'),
        sidebarModeBar: document.createElement('div'),
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
        loadListenHistoryData: vi.fn(async () => null),
    } as unknown as AppCoreServicesRuntimeContext;
};

type FakeIntersectionObserverTriggerEntry = {
    target: Element;
    isIntersecting: boolean;
};

class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = [];

    readonly root: Element | Document | null;
    readonly rootMargin: string;
    readonly thresholds: ReadonlyArray<number>;
    private readonly callback: IntersectionObserverCallback;
    private readonly observedTargets = new Set<Element>();

    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
        this.callback = callback;
        this.root = options.root || null;
        this.rootMargin = options.rootMargin || '';
        this.thresholds = Array.isArray(options.threshold)
            ? options.threshold
            : [options.threshold ?? 0];
        FakeIntersectionObserver.instances.push(this);
    }

    static reset(): void {
        FakeIntersectionObserver.instances = [];
    }

    disconnect(): void {
        this.observedTargets.clear();
    }

    observe(target: Element): void {
        this.observedTargets.add(target);
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    trigger(entries: FakeIntersectionObserverTriggerEntry[]): void {
        const observerEntries = entries
            .filter((entry) => this.observedTargets.has(entry.target))
            .map((entry) => ({
                boundingClientRect: entry.target.getBoundingClientRect(),
                intersectionRatio: entry.isIntersecting ? 1 : 0,
                intersectionRect: entry.target.getBoundingClientRect(),
                isIntersecting: entry.isIntersecting,
                rootBounds: null,
                target: entry.target,
                time: Date.now(),
            }) as IntersectionObserverEntry);
        if (observerEntries.length > 0) {
            this.callback(observerEntries, this as unknown as IntersectionObserver);
        }
    }

    unobserve(target: Element): void {
        this.observedTargets.delete(target);
    }
}

const getFakeIntersectionObserver = (predicate: (observer: FakeIntersectionObserver) => boolean): FakeIntersectionObserver => {
    const observer = FakeIntersectionObserver.instances.find(predicate);
    expect(observer).toBeDefined();
    return observer as FakeIntersectionObserver;
};

const dispatchPointerLikeEvent = (
    target: EventTarget,
    type: string,
    options: { clientY: number; pointerId: number },
): void => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clientY', { value: options.clientY });
    Object.defineProperty(event, 'pointerId', { value: options.pointerId });
    target.dispatchEvent(event);
};

describe('createAppCoreServicesRuntime', () => {
    beforeEach(() => {
        resetBridgeLoadGateForTests();
        createCoverArtServiceMock.mockImplementation(() => createCoverArtServiceStub());
    });

    afterEach(() => {
        resetBridgeLoadGateForTests();
        vi.clearAllMocks();
        vi.restoreAllMocks();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        FakeIntersectionObserver.reset();
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

    it('keeps both overview and track panes mounted in the Roon shell while toggling the active view class', () => {
        const context = createContext();
        const runtime = createAppCoreServicesRuntime(context);
        context.overviewPage.scrollTop = 192;
        const originalInnerWidth = window.innerWidth;

        runtime.initializeRoonShell();

        expect(context.app.classList.contains('showing-overview')).toBe(true);
        expect(context.overviewPage.hidden).toBe(false);
        expect(context.playerLane.hidden).toBe(false);
        expect(context.overviewPage.scrollTop).toBe(0);

        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: 1000,
        });
        context.overviewPage.scrollTop = 168;
        window.dispatchEvent(new Event('resize'));

        expect(context.overviewPage.scrollTop).toBe(0);

        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            value: originalInnerWidth,
        });

        runtime.showNowPlayingPage();

        expect(context.app.classList.contains('showing-overview')).toBe(false);
        expect(context.overviewPage.hidden).toBe(false);
        expect(context.playerLane.hidden).toBe(false);
    });

    it('initializes the Roon shell and clears deprecated shell preferences', () => {
        const context = createContext();
        const runtime = createAppCoreServicesRuntime(context);

        localStorage.setItem('appShellTheme', 'classic');
        localStorage.setItem('playerCardLayout', 'release');
        context.playerCard.classList.add('layout-release');

        runtime.initializeRoonShell();

        expect(context.app.classList.contains('shell-theme-roon')).toBe(true);
        expect(context.app.classList.contains('shell-theme-classic')).toBe(false);
        expect(context.playerCard.classList.contains('layout-release')).toBe(false);
        expect(localStorage.getItem('appShellTheme')).toBeNull();
        expect(localStorage.getItem('playerCardLayout')).toBeNull();
    });

    it('groups multi-disc releases into one last added overview card at the configured release depth', async () => {
        const context = createContext();
        context.releaseDepthForTrack = vi.fn(() => 2);
        (context as unknown as { tracks: unknown[] }).tracks = [
            {
                ...createTrack(),
                path: '/music/library/artist-one/album-one/disc-1/01 Intro.flac',
                relativePath: 'Library/Artist One/Album One/Disc 1/01 Intro.flac',
                folderPath: 'Library/Artist One/Album One/Disc 1',
                rootPath: '/music/library',
                rootName: 'Library',
                displayAlbum: 'Disc 1',
                displayArtist: 'Guest Performer',
                allFileTags: {
                    album: ['Tagged Album Title'],
                    albumartist: ['Album Artist'],
                },
                modifiedAtMs: 1_700_000_000_000,
            },
            {
                ...createTrack(),
                path: '/music/library/artist-one/album-one/disc-2/02 Outro.flac',
                relativePath: 'Library/Artist One/Album One/Disc 2/02 Outro.flac',
                folderPath: 'Library/Artist One/Album One/Disc 2',
                rootPath: '/music/library',
                rootName: 'Library',
                displayAlbum: 'Disc 2',
                displayArtist: 'Featured Vocalist',
                allFileTags: {
                    album: ['Tagged Album Title'],
                    albumartist: ['Album Artist'],
                },
                modifiedAtMs: 1_700_000_100_000,
            },
        ] as never;

        const runtime = createAppCoreServicesRuntime(context);

        runtime.refreshOverviewDashboard();
        await flushPromises();
    await flushPromises();

        const cards = context.overviewLastAddedList.querySelectorAll('.overview-album-card');
        expect(cards).toHaveLength(1);
        expect((cards[0] as HTMLElement).dataset.overviewTrackIndex).toBe('1');
        expect((cards[0] as HTMLElement).dataset.overviewTrackIndexes).toBe('0,1');
        expect(context.overviewLastAddedList.querySelector('.overview-album-title')?.textContent).toBe('Tagged Album Title');
        expect(context.overviewLastAddedList.querySelector('.overview-album-artist')?.textContent).toBe('Album Artist');
    });

    it('renders last played overview cards as track entries with track titles', async () => {
        const context = createContext();
        context.releaseDepthForTrack = vi.fn(() => 2);
        (context as unknown as { tracks: unknown[] }).tracks = [
            {
                ...createTrack(),
                title: 'Intro',
                displayTitle: 'Intro',
                path: '/music/library/artist-one/album-one/disc-1/01 Intro.flac',
                relativePath: 'Library/Artist One/Album One/Disc 1/01 Intro.flac',
                folderPath: 'Library/Artist One/Album One/Disc 1',
                rootPath: '/music/library',
                rootName: 'Library',
                displayAlbum: 'Disc 1',
                displayArtist: 'Artist One',
                allFileTags: {
                    album: ['Tagged Album Title'],
                },
            },
            {
                ...createTrack(),
                title: 'Outro',
                displayTitle: 'Outro',
                path: '/music/library/artist-one/album-one/disc-2/02 Outro.flac',
                relativePath: 'Library/Artist One/Album One/Disc 2/02 Outro.flac',
                folderPath: 'Library/Artist One/Album One/Disc 2',
                rootPath: '/music/library',
                rootName: 'Library',
                displayAlbum: 'Disc 2',
                displayArtist: 'Artist One',
                allFileTags: {
                    album: ['Tagged Album Title'],
                },
            },
        ] as never;
        context.loadListenHistoryData = vi.fn(async () => ({
            name: 'Listen History',
            trackIndexes: [0, 1],
            historyItems: [
                { listenedAt: 1_700_000_000, playedPercent: 80 },
                { listenedAt: 1_700_000_100, playedPercent: 95 },
            ],
        } as never));

        const runtime = createAppCoreServicesRuntime(context);

        runtime.refreshOverviewDashboard();
        await flushPromises();
    await flushPromises();

        const cards = context.overviewLastPlayedList.querySelectorAll('.overview-album-card');
        expect(cards).toHaveLength(2);
        expect((cards[0] as HTMLElement).dataset.overviewTrackIndex).toBe('1');
        expect((cards[0] as HTMLElement).dataset.overviewTrackIndexes).toBeUndefined();
        expect(context.overviewLastPlayedList.querySelector('.overview-album-title')?.textContent).toBe('Outro');
        expect(context.overviewLastPlayedList.querySelector('.overview-album-artist')?.textContent).toBe('Artist One');
    });

    it('switches the overview between recents and album tiles from the Albums and Libraries cards', async () => {
        const context = createContext();
        (context as unknown as { tracks: unknown[] }).tracks = [
            {
                ...createTrack(),
                path: '/music/a/01.flac',
                relativePath: 'a/01.flac',
                folderPath: '/music/a',
                displayAlbum: 'Album A',
                displayArtist: 'Artist A',
            },
            {
                ...createTrack(),
                path: '/music/a/02.flac',
                relativePath: 'a/02.flac',
                folderPath: '/music/a',
                displayAlbum: 'Album A',
                displayArtist: 'Artist A',
            },
            {
                ...createTrack(),
                path: '/music/b/01.flac',
                relativePath: 'b/01.flac',
                folderPath: '/music/b',
                displayAlbum: 'Album B',
                displayArtist: 'Artist B',
            },
        ] as never;

        createCoverArtServiceMock.mockReturnValueOnce(createCoverArtServiceStub({
            getCachedMediaArtwork: vi.fn(() => undefined),
            resolveForTrack: vi.fn(async (track: Parameters<CoverArtService['resolveForTrack']>[0]) => `cover:${track.displayAlbum || ''}`),
        }));

        const runtime = createAppCoreServicesRuntime(context);

        runtime.refreshOverviewDashboard();
        await flushPromises();
        await flushPromises();

        expect(context.overviewAlbumsCount.textContent).toBe('2');
        expect(context.overviewRecentsView.hidden).toBe(false);
        expect(context.overviewAlbumGridView.hidden).toBe(true);

        context.overviewShowAlbums.click();
        await flushPromises();
        await flushPromises();

        expect(context.overviewRecentsView.hidden).toBe(true);
        expect(context.overviewAlbumGridView.hidden).toBe(false);
        expect(context.overviewShowAlbums.getAttribute('aria-pressed')).toBe('true');
        expect(context.overviewShowRecents.getAttribute('aria-pressed')).toBe('false');
        expect(context.overviewAlbumGrid.querySelectorAll('.library-album-card')).toHaveLength(2);

        context.overviewShowRecents.click();

        expect(context.overviewRecentsView.hidden).toBe(false);
        expect(context.overviewAlbumGridView.hidden).toBe(true);
        expect(context.overviewShowAlbums.getAttribute('aria-pressed')).toBe('false');
        expect(context.overviewShowRecents.getAttribute('aria-pressed')).toBe('true');
    });

    it('loads only an initial slice of album grid thumbnails on first open', async () => {
        const context = createContext();
        (context as unknown as { tracks: unknown[] }).tracks = Array.from({ length: 48 }, (_, index) => ({
            ...createTrack(),
            path: `/music/${String(index + 1)}/01.flac`,
            relativePath: `${String(index + 1)}/01.flac`,
            folderPath: `/music/${String(index + 1)}`,
            displayAlbum: `Album ${String(index + 1)}`,
            displayArtist: `Artist ${String(index + 1)}`,
        })) as never;

        createCoverArtServiceMock.mockReturnValueOnce(createCoverArtServiceStub({
            getCachedMediaArtwork: vi.fn(() => undefined),
            getFolderCoverPath: vi.fn(() => undefined),
            resolveFolderCoverPath: vi.fn(async (folderPath: string) => `${folderPath}/cover.jpg`),
            resolveForTrack: vi.fn(async () => ''),
        }));

        vi.mocked(ReadImageThumbnail).mockImplementation(async (filePath: string) => ({
            base64: btoa(filePath),
            mimeType: 'image/jpeg',
        }));

        context.overviewAlbumGridView.append(context.overviewAlbumGrid);
        document.body.append(context.overviewAlbumGridView);

        const runtime = createAppCoreServicesRuntime(context);
        runtime.refreshOverviewDashboard();
        context.overviewShowAlbums.click();
        await flushPromises();
        await flushPromises();

        expect(context.overviewAlbumGrid.querySelectorAll('.library-album-card').length).toBeGreaterThan(0);
        expect(vi.mocked(ReadImageThumbnail).mock.calls.length).toBeGreaterThan(0);
        expect(vi.mocked(ReadImageThumbnail).mock.calls.length).toBeLessThanOrEqual(32);
        expect(vi.mocked(ReadImageThumbnail).mock.calls.length).toBeLessThan(48);
    });

    it('does not apply album-grid cover loads after a cover leaves view until it re-enters', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver as unknown as typeof IntersectionObserver);

        const context = createContext();
        createCoverArtServiceMock.mockReturnValueOnce(createCoverArtServiceStub({
            getCachedMediaArtwork: vi.fn(() => undefined),
            getFolderCoverPath: vi.fn((folderPath: string) => `${folderPath}/cover.jpg`),
            resolveFolderCoverPath: vi.fn(async (folderPath: string) => `${folderPath}/cover.jpg`),
            resolveForTrack: vi.fn(async () => ''),
        }));

        let resolveThumbnail!: (value: { base64: string; mimeType: string }) => void;
        const thumbnailPromise = new Promise<{ base64: string; mimeType: string }>((resolve) => {
            resolveThumbnail = resolve;
        });
        vi.mocked(ReadImageThumbnail).mockImplementation(() => thumbnailPromise);

        context.overviewAlbumGridView.append(context.overviewAlbumGrid);
        document.body.append(context.overviewAlbumGridView);

        const runtime = createAppCoreServicesRuntime(context);
        runtime.refreshOverviewDashboard();
        context.overviewShowAlbums.click();
        await flushPromises();

        const image = context.overviewAlbumGrid.querySelector('.library-album-cover-image') as HTMLImageElement;
        expect(image).toBeTruthy();

        const visibilityObserver = getFakeIntersectionObserver((observer) => observer.root === context.overviewAlbumGridView && observer.rootMargin === '');
        visibilityObserver.trigger([{ target: image, isIntersecting: true }]);
        visibilityObserver.trigger([{ target: image, isIntersecting: false }]);

        resolveThumbnail({
            base64: btoa('cover:/music/cover.jpg'),
            mimeType: 'image/jpeg',
        });
        await flushPromises();
        await flushPromises();

        expect(image.getAttribute('src')).toBeNull();

        visibilityObserver.trigger([{ target: image, isIntersecting: true }]);
        await flushPromises();
        await flushPromises();

        await vi.advanceTimersByTimeAsync(299);
        expect(image.getAttribute('src')).toBeNull();

        await vi.advanceTimersByTimeAsync(1);
        await flushPromises();

        expect(image.getAttribute('src')).toContain('data:image/jpeg;base64,');
        expect(vi.mocked(ReadImageThumbnail).mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('cancels pending album-grid cover invalidation when a cover re-enters view', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver as unknown as typeof IntersectionObserver);

        const context = createContext();
        createCoverArtServiceMock.mockReturnValueOnce(createCoverArtServiceStub({
            getCachedMediaArtwork: vi.fn(() => undefined),
            getFolderCoverPath: vi.fn((folderPath: string) => `${folderPath}/cover.jpg`),
            resolveFolderCoverPath: vi.fn(async (folderPath: string) => `${folderPath}/cover.jpg`),
            resolveForTrack: vi.fn(async () => ''),
        }));
        vi.mocked(ReadImageThumbnail).mockResolvedValue({
            base64: btoa('cover:/music/cover.jpg'),
            mimeType: 'image/jpeg',
        });

        context.overviewAlbumGridView.append(context.overviewAlbumGrid);
        document.body.append(context.overviewAlbumGridView);

        const runtime = createAppCoreServicesRuntime(context);
        runtime.refreshOverviewDashboard();
        context.overviewShowAlbums.click();
        await flushPromises();

        const image = context.overviewAlbumGrid.querySelector('.library-album-cover-image') as HTMLImageElement;
        expect(image).toBeTruthy();

        const visibilityObserver = getFakeIntersectionObserver((observer) => observer.root === context.overviewAlbumGridView && observer.rootMargin === '');
        visibilityObserver.trigger([{ target: image, isIntersecting: true }]);

        await flushPromises();
        await flushPromises();
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();

        expect(image.getAttribute('src')).toContain('data:image/jpeg;base64,');

        visibilityObserver.trigger([{ target: image, isIntersecting: false }]);
        await vi.advanceTimersByTimeAsync(10_000);
        visibilityObserver.trigger([{ target: image, isIntersecting: true }]);
        await vi.advanceTimersByTimeAsync(25_000);
        await flushPromises();

        expect(image.getAttribute('src')).toContain('data:image/jpeg;base64,');
        expect(image.dataset.coverLoaded).toBe('true');
    });

    it('waits for the album-grid view to stay static for 300ms before applying a visible cover', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver as unknown as typeof IntersectionObserver);

        const context = createContext();
        createCoverArtServiceMock.mockReturnValueOnce(createCoverArtServiceStub({
            getCachedMediaArtwork: vi.fn(() => undefined),
            getFolderCoverPath: vi.fn((folderPath: string) => `${folderPath}/cover.jpg`),
            resolveFolderCoverPath: vi.fn(async (folderPath: string) => `${folderPath}/cover.jpg`),
            resolveForTrack: vi.fn(async () => ''),
        }));
        vi.mocked(ReadImageThumbnail).mockResolvedValue({
            base64: btoa('cover:/music/cover.jpg'),
            mimeType: 'image/jpeg',
        });

        context.overviewAlbumGridView.append(context.overviewAlbumGrid);
        document.body.append(context.overviewAlbumGridView);

        const runtime = createAppCoreServicesRuntime(context);
        runtime.refreshOverviewDashboard();
        context.overviewShowAlbums.click();
        await flushPromises();

        const image = context.overviewAlbumGrid.querySelector('.library-album-cover-image') as HTMLImageElement;
        expect(image).toBeTruthy();

        const visibilityObserver = getFakeIntersectionObserver((observer) => observer.root === context.overviewAlbumGridView && observer.rootMargin === '');
        visibilityObserver.trigger([{ target: image, isIntersecting: true }]);
        await flushPromises();
        await flushPromises();

        await vi.advanceTimersByTimeAsync(299);
        await flushPromises();
        expect(image.getAttribute('src')).toBeNull();

        await vi.advanceTimersByTimeAsync(1);
        await flushPromises();
        expect(image.getAttribute('src')).toContain('data:image/jpeg;base64,');
    });

    it('invalidates offscreen in-flight album-grid cover loads once scrolling settles', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver as unknown as typeof IntersectionObserver);

        const context = createContext();
        createCoverArtServiceMock.mockReturnValueOnce(createCoverArtServiceStub({
            getCachedMediaArtwork: vi.fn(() => undefined),
            getFolderCoverPath: vi.fn((folderPath: string) => `${folderPath}/cover.jpg`),
            resolveFolderCoverPath: vi.fn(async (folderPath: string) => `${folderPath}/cover.jpg`),
            resolveForTrack: vi.fn(async () => ''),
        }));

        const resolveThumbnails: Array<(value: { base64: string; mimeType: string }) => void> = [];
        vi.mocked(ReadImageThumbnail).mockImplementation(() => new Promise((resolve) => {
            resolveThumbnails.push(resolve);
        }));

        context.overviewAlbumGridView.append(context.overviewAlbumGrid);
        document.body.append(context.overviewAlbumGridView);

        const runtime = createAppCoreServicesRuntime(context);
        runtime.refreshOverviewDashboard();
        context.overviewShowAlbums.click();
        await flushPromises();

        const image = context.overviewAlbumGrid.querySelector('.library-album-cover-image') as HTMLImageElement;
        expect(image).toBeTruthy();

        const visibilityObserver = getFakeIntersectionObserver((observer) => observer.root === context.overviewAlbumGridView && observer.rootMargin === '');
        visibilityObserver.trigger([{ target: image, isIntersecting: true }]);
        visibilityObserver.trigger([{ target: image, isIntersecting: false }]);

        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(image.dataset.coverResolving).toBeUndefined();

        resolveThumbnails.shift()?.({
            base64: btoa('cover:/music/cover-stale.jpg'),
            mimeType: 'image/jpeg',
        });
        await flushPromises();
        await flushPromises();

        expect(image.getAttribute('src')).toBeNull();

        visibilityObserver.trigger([{ target: image, isIntersecting: true }]);
        await flushPromises();

        expect(vi.mocked(ReadImageThumbnail)).toHaveBeenCalledTimes(2);

        resolveThumbnails.shift()?.({
            base64: btoa('cover:/music/cover-fresh.jpg'),
            mimeType: 'image/jpeg',
        });
        await flushPromises();
        await flushPromises();
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();

        expect(image.getAttribute('src')).toContain(btoa('cover:/music/cover-fresh.jpg'));
    });

    it('aggressively realizes album-grid entries when dragging the scroll pill toward the bottom', async () => {
        const context = createContext();
        (context as unknown as { tracks: unknown[] }).tracks = Array.from({ length: 500 }, (_, index) => ({
            ...createTrack(),
            path: `/music/${String(index + 1)}/01.flac`,
            relativePath: `${String(index + 1)}/01.flac`,
            folderPath: `/music/${String(index + 1)}`,
            displayAlbum: `Album ${String(index + 1)}`,
            displayArtist: `Artist ${String(index + 1)}`,
        })) as never;

        createCoverArtServiceMock.mockReturnValueOnce(createCoverArtServiceStub({
            getCachedMediaArtwork: vi.fn(() => undefined),
            getFolderCoverPath: vi.fn(() => undefined),
            resolveFolderCoverPath: vi.fn(async (folderPath: string) => `${folderPath}/cover.jpg`),
            resolveForTrack: vi.fn(async () => ''),
        }));

        vi.mocked(ReadImageThumbnail).mockResolvedValue({
            base64: btoa('cover:/music/cover.jpg'),
            mimeType: 'image/jpeg',
        });

        context.overviewAlbumGridView.append(context.overviewAlbumGrid);
        context.overviewAlbumGridScrollRail.append(context.overviewAlbumGridScrollPill, context.overviewAlbumGridScrollHint);
        document.body.append(context.overviewAlbumGridView, context.overviewAlbumGridScrollRail);

        Object.defineProperty(context.overviewAlbumGridView, 'clientHeight', { configurable: true, value: 600 });
        Object.defineProperty(context.overviewAlbumGridView, 'scrollHeight', { configurable: true, get: () => 6000 });
        Object.defineProperty(context.overviewAlbumGridScrollPill, 'offsetHeight', { configurable: true, value: 54 });
        context.overviewAlbumGridView.getBoundingClientRect = vi.fn(() => ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 500,
            bottom: 600,
            width: 500,
            height: 600,
            toJSON: () => '',
        })) as never;
        context.overviewAlbumGridScrollPill.getBoundingClientRect = vi.fn(() => ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 20,
            bottom: 54,
            width: 20,
            height: 54,
            toJSON: () => '',
        })) as never;

        const runtime = createAppCoreServicesRuntime(context);
        runtime.refreshOverviewDashboard();
        context.overviewShowAlbums.click();
        await flushPromises();
        await flushPromises();

        expect(context.overviewAlbumGrid.querySelectorAll('.library-album-card')).toHaveLength(80);

        context.overviewAlbumGridScrollRail.hidden = false;
        dispatchPointerLikeEvent(context.overviewAlbumGridScrollPill, 'pointerdown', { clientY: 40, pointerId: 1 });
        dispatchPointerLikeEvent(context.overviewAlbumGridScrollPill, 'pointermove', { clientY: 598, pointerId: 1 });
        await flushPromises();
        await flushPromises();

        expect(context.overviewAlbumGrid.querySelectorAll('.library-album-card').length).toBeGreaterThan(80);
    });
});