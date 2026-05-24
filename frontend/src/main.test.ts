import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
    let controllerScope: Record<string, unknown> | null = null;

    const normalizedSettings = {
        libraryFolders: [],
        ffmpegPath: '',
        lissajousEnabled: false,
        lissajousScale: 0.25,
        visualizerMode: 'equalizer',
        equalizerPosition: 'top',
        uiDitheringEnabled: true,
        playbackOrder: 'ordered-library',
        audio: {
            outputDevice: '',
            outputBufferMs: 0,
            gaplessPlayback: false,
            replayGainEnabled: false,
        },
    };

    const musicBrainzProgress = {
        enabled: false,
        active: false,
        progress: 0,
        pendingTrackScans: 0,
        totalTrackScans: 0,
        completedTrackScans: 0,
        pendingEntityLookups: 0,
        totalEntityLookups: 0,
        completedEntityLookups: 0,
    };

    const settingsController = {
        open: vi.fn(),
        setMusicBrainzTagWorkerProgress: vi.fn(),
    };

    const playlistController = {
        closeMenu: vi.fn(),
        refreshFavorites: vi.fn(),
        refreshOpenModal: vi.fn(),
        resetState: vi.fn(),
    };

    const artistInfoController = {
        clearCache: vi.fn(),
    };

    const imageModalController = {
        clearCachedDataUrls: vi.fn(),
    };

    const libraryController = {
        refreshSidebarToggleState: vi.fn(),
        renderFolder: vi.fn(),
    };

    const initializeRoonShell = vi.fn();
    const handleSettingsChanged = vi.fn();
    const initializeAppVersion = vi.fn(async () => undefined);
    const initializeBackendPlayback = vi.fn(async () => undefined);
    const initializeMediaSessionIntegration = vi.fn();
    const refreshAvailableAudioOutputDevices = vi.fn(async () => []);
    const refreshListenBrainzFeedbackForCurrentTrack = vi.fn(async () => undefined);
    const resetListenBrainzFeedbackState = vi.fn();
    const scanConfiguredLibraryFolders = vi.fn(async () => undefined);
    const setLissajousEnabled = vi.fn();
    const setLissajousScale = vi.fn();
    const setVisualizerMode = vi.fn();
    const setEqualizerPosition = vi.fn();
    const setPlaybackOrderMode = vi.fn();
    const openTrackMetaMenu = vi.fn();
    const updatePlayOrderMenuState = vi.fn();
    const openLibrarySearch = vi.fn();

    const createShell = () => {
        const cache = new Map<string, unknown>();

        const createElementForKey = (key: string): unknown => {
            if (key === 'coverFrame') {
                const coverFrame = document.createElement('div');
                const coverFront = document.createElement('div');
                coverFront.className = 'cover-front';
                coverFrame.appendChild(coverFront);
                return coverFrame;
            }

            if (key === 'playerTaskbar') {
                const taskbar = document.createElement('section');
                const primary = document.createElement('div');
                const center = document.createElement('div');
                primary.className = 'player-taskbar-primary';
                center.className = 'player-taskbar-center';
                taskbar.append(primary, center);
                return taskbar;
            }

            if (key === 'coverArt' || key === 'coverArtBackground') {
                return document.createElement('img');
            }

            if (/(btn|toggle|close|save|copy|back|forward|cancel|ok|proceed)$/i.test(key)) {
                return document.createElement('button');
            }

            if (/(input|search|seek|volume)$/i.test(key)) {
                return document.createElement('input');
            }

            return document.createElement('div');
        };

        return new Proxy({}, {
            get(_target, property) {
                const key = String(property);
                if (!cache.has(key)) {
                    cache.set(key, createElementForKey(key));
                }

                return cache.get(key);
            },
        });
    };

    return {
        initializeRoonShell,
        artistInfoController,
        createShell,
        getControllerScope: () => controllerScope,
        handleSettingsChanged,
        imageModalController,
        initializeAppVersion,
        initializeBackendPlayback,
        initializeMediaSessionIntegration,
        libraryController,
        musicBrainzProgress,
        normalizedSettings,
        openTrackMetaMenu,
        playlistController,
        refreshAvailableAudioOutputDevices,
        openLibrarySearch,
        refreshListenBrainzFeedbackForCurrentTrack,
        resetControllerScope: () => {
            controllerScope = null;
        },
        resetListenBrainzFeedbackState,
        scanConfiguredLibraryFolders,
        setControllerScope: (scope: Record<string, unknown>) => {
            controllerScope = scope;
        },
        setLissajousEnabled,
        setLissajousScale,
        setVisualizerMode,
        setEqualizerPosition,
        setPlaybackOrderMode,
        settingsController,
        updatePlayOrderMenuState,
    };
});

vi.mock('./components/media-controls-exploration', () => ({
    setupExplorationButton: vi.fn(),
}));

vi.mock('./app-shell', () => ({
    getAppShellElements: vi.fn(() => testState.createShell()),
    renderAppShell: vi.fn((app: HTMLElement) => {
        app.innerHTML = '<button id="volume-btn" type="button"></button>';
    }),
}));

vi.mock('./app-bootstrap-setup', () => ({
    bindEventHandlersFromScope: vi.fn(),
    setupControllersFromScope: vi.fn((scope: Record<string, unknown>) => {
        testState.setControllerScope(scope);

        return {
            settingsController: testState.settingsController,
            playlistController: testState.playlistController,
            playlistTargetModalController: {},
            shareController: {},
            imageModalController: testState.imageModalController,
            artistInfoController: testState.artistInfoController,
            libraryController: testState.libraryController,
        };
    }),
}));

vi.mock('./app-runtime-setup', () => ({
    setupCoreServicesRuntime: vi.fn(() => ({
        applyRoonAccentTheme: vi.fn(),
        defaultMusicBrainzServerUrl: 'https://musicbrainz.org',
        getStoredRoonAccentTheme: vi.fn(() => ({ color: '#68b4ff', saturation: 1 })),
        initializeRoonShell: testState.initializeRoonShell,
        openLibrarySearch: testState.openLibrarySearch,
        visualizerController: {
            setEnabled: testState.setLissajousEnabled,
            setLissajousScale: testState.setLissajousScale,
            setMode: testState.setVisualizerMode,
            setEqualizerPosition: testState.setEqualizerPosition,
        },
        socialController: { handleSettingsChanged: testState.handleSettingsChanged },
        playbackSequencingService: {
            getPlaybackOrderLabel: vi.fn(() => 'Ordered'),
            getPlaybackOrderMode: vi.fn(() => 'ordered-library'),
        },
        playbackStateService: {
            isBackendReady: vi.fn(() => true),
            setBackendReady: vi.fn(),
        },
        refreshListenBrainzFeedbackForCurrentTrack: testState.refreshListenBrainzFeedbackForCurrentTrack,
        resetListenBrainzFeedbackState: testState.resetListenBrainzFeedbackState,
    })),
    setupLibraryLoadRuntime: vi.fn(() => ({
        scanConfiguredLibraryFolders: testState.scanConfiguredLibraryFolders,
    })),
    setupModalRuntime: vi.fn(() => ({
        openErrorModal: vi.fn(),
    })),
    setupNowPlayingRuntime: vi.fn(() => ({
        initializeBackendPlayback: testState.initializeBackendPlayback,
        rebuildTrackPathIndex: vi.fn(),
        refreshLyricsPanel: vi.fn(),
        setCoverFlipped: vi.fn(),
        updateLyricsPanelVisibility: vi.fn(),
        updatePlayButton: vi.fn(),
        updateTrackLabels: vi.fn(),
    })),
    setupPlaybackControlsRuntime: vi.fn(() => ({
        audioReinitializeBackend: vi.fn(async () => ({ loaded: false })),
        initializeAppVersion: testState.initializeAppVersion,
        initializeMediaSessionIntegration: testState.initializeMediaSessionIntegration,
        refreshAvailableAudioOutputDevices: testState.refreshAvailableAudioOutputDevices,
    })),
    setupQueueMenuRuntime: vi.fn(() => ({
        openTrackMetaMenu: testState.openTrackMetaMenu,
        updatePlayOrderMenuState: testState.updatePlayOrderMenuState,
    })),
}));

vi.mock('./app-playback-order-playlist-runtime', () => ({
    createPlaybackOrderPlaylistRuntime: vi.fn(() => ({
        loadListenHistoryData: vi.fn(async () => null),
        loadPlaylistData: vi.fn(async () => null),
        savePlaylistTrackMetadataCache: vi.fn(async () => true),
        savePlaybackOrderSetting: vi.fn(async () => undefined),
        setPlaybackOrderMode: testState.setPlaybackOrderMode,
    })),
}));

vi.mock('./app-cover-flip-runtime', () => ({
    createCoverFlipRuntime: vi.fn(() => ({
        logRescan: vi.fn(),
        suppressCoverFrontClickUntil: 0,
        toggleCoverFlipFromContextMenu: vi.fn(() => false),
        toggleCoverFlipFromSecondaryInput: vi.fn(),
    })),
}));

vi.mock('./utils/main-helpers', () => ({
    asReleaseDepth: vi.fn(() => 0),
    findLibraryFolderForFilePath: vi.fn(() => null),
    findLibraryFolderForTrack: vi.fn(() => null),
    formatTime: vi.fn((value: number) => `${value}`),
}));

vi.mock('./utils/musicbrainz-request-scheduler', () => ({
    scheduleMusicBrainzRequest: vi.fn(async (factory: () => Promise<unknown>) => await factory()),
}));

vi.mock('./utils/settings-normalization', () => ({
    defaultAppSettings: testState.normalizedSettings,
    defaultMusicBrainzTagWorkerProgress: testState.musicBrainzProgress,
    normalizeAppSettings: vi.fn((value: unknown) => value),
    normalizeMusicBrainzTagWorkerProgress: vi.fn((value: unknown) => value),
}));

vi.mock('../wailsjs/go/main/App', () => ({
    AddListenHistoryEntry: vi.fn(async () => true),
    AppendTracksToPlaylistFile: vi.fn(async () => true),
    AudioListOutputDevices: vi.fn(async () => []),
    AudioQueueNextTrack: vi.fn(async () => undefined),
    AudioReinitializeBackend: vi.fn(async () => ({ loaded: false })),
    AudioSeek: vi.fn(async () => ({ loaded: false })),
    AudioSetVolume: vi.fn(async () => ({ loaded: false })),
    AudioStop: vi.fn(async () => ({ loaded: false })),
    CopyShareImageToClipboard: vi.fn(async () => true),
    GetAppVersion: vi.fn(async () => '0.0.0'),
    GetLastFmRequestToken: vi.fn(async () => ''),
    GetLastFmSessionKey: vi.fn(async () => ''),
    GetLibraryFolderPage: vi.fn(async () => ({ entries: [], folderPath: '', limit: 0, offset: 0, totalEntries: 0 })),
    GetLibraryFolderPageSorted: vi.fn(async () => ({ entries: [], folderPath: '', limit: 0, offset: 0, totalEntries: 0 })),
    GetLibraryIndexedFilePage: vi.fn(async () => ({ entries: [], kind: 'track', limit: 0, offset: 0, totalEntries: 0 })),
    GetLibraryShareConnectionCount: vi.fn(async () => 0),
    GetMusicBrainzTagWorkerProgress: vi.fn(async () => testState.musicBrainzProgress),
    GetSettings: vi.fn(async () => testState.normalizedSettings),
    IsLibraryFolderImmediateDescendantsEnumerated: vi.fn(async () => true),
    LoadListenHistoryPlaylist: vi.fn(async () => ({ name: 'Listen History', trackFiles: [] })),
    LogFrontendMessage: vi.fn(async () => undefined),
    LookupArtistByMBID: vi.fn(async () => ({ found: false })),
    LookupMusicBrainzRecordingURLs: vi.fn(async () => []),
    ReadFileBase64: vi.fn(async () => ''),
    ReadImageThumbnail: vi.fn(async () => ({})),
    ResolveLibraryFolderForPath: vi.fn(async () => ''),
    SavePlaylistFile: vi.fn(async () => true),
    SaveSettings: vi.fn(async (settings: unknown) => settings),
    SaveShareImageFile: vi.fn(async () => true),
    ScanConfiguredLibraryFolders: vi.fn(async () => ({ imageFiles: [], textFiles: [], trackFiles: [] })),
    SearchLibrary: vi.fn(async () => ({ entries: [], limit: 0, offset: 0, query: '', totalEntries: 0 })),
    SelectLibraryFolder: vi.fn(async () => ''),
    SelectPlaylistFile: vi.fn(async () => ''),
    SelectPlaylistSaveFile: vi.fn(async () => ''),
    SelectShareImageSaveFile: vi.fn(async () => ''),
    ValidateFFmpegPath: vi.fn(async () => ({ available: true })),
}));

vi.mock('../wailsjs/runtime/runtime', () => ({
    BrowserOpenURL: vi.fn(async () => undefined),
    EventsEmit: vi.fn(),
    EventsOn: vi.fn(() => vi.fn()),
}));

import { setupExplorationButton } from './components/media-controls-exploration';

describe('main entrypoint runtime scope', () => {
    let resizeObserverInstances: ResizeObserverCallback[];

    const flushMicrotasks = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    };

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        testState.resetControllerScope();
        document.body.innerHTML = '<div id="app"></div>';
        resizeObserverInstances = [];

        class ResizeObserverMock {
            constructor(callback: ResizeObserverCallback) {
                resizeObserverInstances.push(callback);
            }

            disconnect(): void {
                return undefined;
            }

            observe(): void {
                return undefined;
            }

            unobserve(): void {
                return undefined;
            }
        }

        vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('assigns completeStartupIfReady onto the scope passed to controller setup', async () => {
        await import('./main');

        const scope = testState.getControllerScope() as {
            completeStartupIfReady?: () => Promise<void>;
        } | null;

        expect(scope).not.toBeNull();
        expect(scope?.completeStartupIfReady).toBeTypeOf('function');
        await expect(scope?.completeStartupIfReady?.()).resolves.toBeUndefined();
    }, 15_000);

    it('applies the persisted lissajous scale during settings initialization', async () => {
        await import('./main');
        await flushMicrotasks();

        expect(testState.setLissajousScale).toHaveBeenCalledWith(0.25);
    });

    it('allows updating seek interaction state through the runtime scope', async () => {
        await import('./main');

        const scope = testState.getControllerScope() as {
            isSeeking?: boolean;
        } | null;

        expect(scope).not.toBeNull();
        expect(scope?.isSeeking).toBe(false);

        if (scope) {
            scope.isSeeking = true;
        }

        expect(scope?.isSeeking).toBe(true);
    });

    it('tracks the rendered roon taskbar height for cover sizing', async () => {
        await import('./main');

        const appElement = document.querySelector('#app') as HTMLElement;
        const scope = testState.getControllerScope() as {
            playerTaskbar?: HTMLElement;
        } | null;
        const playerTaskbar = scope?.playerTaskbar as HTMLElement | undefined;

        expect(playerTaskbar).toBeTruthy();
        expect(resizeObserverInstances.length).toBeGreaterThan(1);

        if (!playerTaskbar) {
            throw new Error('playerTaskbar was not captured');
        }

        playerTaskbar.getBoundingClientRect = vi.fn(() => ({
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 960,
            bottom: 148,
            width: 960,
            height: 148,
            toJSON: () => '',
        })) as never;

        resizeObserverInstances[1]?.([], {} as ResizeObserver);

        expect(appElement.style.getPropertyValue('--roon-track-view-taskbar-height')).toBe('148px');
    });

    it('exposes audioReinitializeBackend on the runtime scope passed to controller setup', async () => {
        await import('./main');

        const scope = testState.getControllerScope() as {
            audioReinitializeBackend?: () => Promise<unknown>;
        } | null;

        expect(scope).not.toBeNull();
        expect(scope?.audioReinitializeBackend).toBeTypeOf('function');
        await expect(scope?.audioReinitializeBackend?.()).resolves.toEqual({ loaded: false });
    });

    it('routes the exploration search callback to the runtime openLibrarySearch helper', async () => {
        await import('./main');

        const call = vi.mocked(setupExplorationButton).mock.calls[0];
        expect(call).toBeDefined();

        const options = call?.[1] as { openLibrarySearch?: (query: string, searchOptions?: { expandFilteredFolders?: boolean }) => void } | undefined;
        expect(options?.openLibrarySearch).toBeTypeOf('function');

        options?.openLibrarySearch?.('mbid-artist:5e9450ca-77d5-4f64-a385-f453cfe98b24', { expandFilteredFolders: true });

        expect(testState.openLibrarySearch).toHaveBeenCalledWith(
            'mbid-artist:5e9450ca-77d5-4f64-a385-f453cfe98b24',
            { expandFilteredFolders: true },
        );
    });

    it('forwards artist filter queries through the runtime scope track meta wrapper', async () => {
        await import('./main');

        const scope = testState.getControllerScope() as {
            openTrackMetaMenu?: (
                clientX: number,
                clientY: number,
                includeCopyActions: boolean,
                actionScope: 'track' | 'album' | null,
                actionKind: 'track' | 'album' | null,
                actionPath: string,
                artistFilterQuery?: string,
                showArtistFilterAction?: boolean,
            ) => void;
        } | null;

        expect(scope?.openTrackMetaMenu).toBeTypeOf('function');

        scope?.openTrackMetaMenu?.(24, 48, false, null, null, '', 'mbid-artist:artist-id', true);

        expect(testState.openTrackMetaMenu).toHaveBeenCalledWith(24, 48, false, null, null, '', 'mbid-artist:artist-id', true);
    });
});