import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => {
    let controllerScope: Record<string, unknown> | null = null;

    const normalizedSettings = {
        libraryFolders: [],
        ffmpegPath: '',
        lissajousEnabled: false,
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

    const applyPlayerCardLayout = vi.fn();
    const getStoredLayout = vi.fn(() => 'album-left');
    const handleSettingsChanged = vi.fn();
    const initializeAppVersion = vi.fn(async () => undefined);
    const initializeBackendPlayback = vi.fn(async () => undefined);
    const initializeMediaSessionIntegration = vi.fn();
    const refreshAvailableAudioOutputDevices = vi.fn(async () => []);
    const refreshListenBrainzFeedbackForCurrentTrack = vi.fn(async () => undefined);
    const resetListenBrainzFeedbackState = vi.fn();
    const scanConfiguredLibraryFolders = vi.fn(async () => undefined);
    const setLissajousEnabled = vi.fn();
    const setVisualizerMode = vi.fn();
    const setEqualizerPosition = vi.fn();
    const setPlaybackOrderMode = vi.fn();
    const updatePlayOrderMenuState = vi.fn();

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
        applyPlayerCardLayout,
        artistInfoController,
        createShell,
        getControllerScope: () => controllerScope,
        getStoredLayout,
        handleSettingsChanged,
        imageModalController,
        initializeAppVersion,
        initializeBackendPlayback,
        initializeMediaSessionIntegration,
        libraryController,
        musicBrainzProgress,
        normalizedSettings,
        playlistController,
        refreshAvailableAudioOutputDevices,
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
        applyPlayerCardLayout: testState.applyPlayerCardLayout,
        defaultMusicBrainzServerUrl: 'https://musicbrainz.org',
        getStoredLayout: testState.getStoredLayout,
        visualizerController: {
            setEnabled: testState.setLissajousEnabled,
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
        updatePlayOrderMenuState: testState.updatePlayOrderMenuState,
    })),
}));

vi.mock('./app-playback-order-playlist-runtime', () => ({
    createPlaybackOrderPlaylistRuntime: vi.fn(() => ({
        loadPlaylistData: vi.fn(async () => null),
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
    AppendTracksToPlaylistFile: vi.fn(async () => true),
    AudioListOutputDevices: vi.fn(async () => []),
    AudioQueueNextTrack: vi.fn(async () => undefined),
    AudioSeek: vi.fn(async () => ({ loaded: false })),
    AudioSetVolume: vi.fn(async () => ({ loaded: false })),
    AudioStop: vi.fn(async () => ({ loaded: false })),
    GetAppVersion: vi.fn(async () => '0.0.0'),
    GetLastFmRequestToken: vi.fn(async () => ''),
    GetLastFmSessionKey: vi.fn(async () => ''),
    GetLibraryFolderPage: vi.fn(async () => ({ entries: [], folderPath: '', limit: 0, offset: 0, totalEntries: 0 })),
    GetLibraryIndexedFilePage: vi.fn(async () => ({ entries: [], kind: 'track', limit: 0, offset: 0, totalEntries: 0 })),
    GetMusicBrainzTagWorkerProgress: vi.fn(async () => testState.musicBrainzProgress),
    GetSettings: vi.fn(async () => testState.normalizedSettings),
    IsLibraryFolderImmediateDescendantsEnumerated: vi.fn(async () => true),
    LogFrontendMessage: vi.fn(async () => undefined),
    LookupArtistByMBID: vi.fn(async () => ({ found: false })),
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
}));

describe('main entrypoint runtime scope', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        testState.resetControllerScope();
        document.body.innerHTML = '<div id="app"></div>';

        class ResizeObserverMock {
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
});