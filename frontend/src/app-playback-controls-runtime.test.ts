import { afterEach, describe, expect, it, vi } from 'vitest';

const {
    audioLoadTrackMock,
    createMediaSessionControllerMock,
    windowHideMock,
    windowIsMinimisedMock,
} = vi.hoisted(() => ({
    audioLoadTrackMock: vi.fn(async () => ({
        loaded: true,
        playing: false,
        currentTime: 0,
        duration: 0,
        sourcePath: '/music/track.flac',
        volume: 1,
        endEventId: 0,
    })),
    createMediaSessionControllerMock: vi.fn(() => ({
        updateMetadata: vi.fn(),
        updatePlaybackState: vi.fn(),
        updatePositionState: vi.fn(),
        dispatchExternalPlaybackAction: vi.fn(),
        initialize: vi.fn(),
        unlockFromUserGesture: vi.fn(),
        handleHardwareMediaKey: vi.fn(() => false),
    })),
    windowHideMock: vi.fn(),
    windowIsMinimisedMock: vi.fn(async () => false),
}));

vi.mock('../wailsjs/go/main/App', () => ({
    AudioListOutputDevices: vi.fn(async () => []),
    AudioLoadTrack: audioLoadTrackMock,
    AudioLoadTrackWithReplayGainContext: vi.fn(async () => ({ loaded: true, playing: false, currentTime: 0, duration: 0, sourcePath: '/music/track.flac', volume: 1, endEventId: 0 })),
    AudioPause: vi.fn(async () => ({ loaded: true, playing: false, currentTime: 0, duration: 0, sourcePath: '/music/track.flac', volume: 1, endEventId: 0 })),
    AudioPlay: vi.fn(async () => ({ loaded: true, playing: true, currentTime: 0, duration: 0, sourcePath: '/music/track.flac', volume: 1, endEventId: 0 })),
    AudioSeek: vi.fn(async () => ({ loaded: true, playing: false, currentTime: 0, duration: 0, sourcePath: '/music/track.flac', volume: 1, endEventId: 0 })),
    AudioStop: vi.fn(async () => ({ loaded: false, playing: false, currentTime: 0, duration: 0, sourcePath: '', volume: 1, endEventId: 0 })),
    GetAppVersion: vi.fn(async () => 'dev'),
    ScanConfiguredLibraryFolders: vi.fn(async () => ({ trackFiles: [], textFiles: [], imageFiles: [] })),
}));

vi.mock('../wailsjs/runtime/runtime', () => ({
    WindowHide: windowHideMock,
    WindowIsMinimised: windowIsMinimisedMock,
}));

vi.mock('./controllers/media-session-controller', () => ({
    createMediaSessionController: createMediaSessionControllerMock,
}));

import { createAppPlaybackControlsRuntime } from './app-playback-controls-runtime';
import type { AppPlaybackControlsRuntimeContext } from './app-runtime-setup';
import type { Track } from './types/app-types';

const createTrack = (): Track => ({
    title: 'Unknown Title',
    name: 'track.flac',
    path: '/music/track.flac',
    relativePath: 'track.flac',
    folderPath: '/music',
    rootPath: '/music',
    rootName: 'Library',
    displayTitle: 'Unknown Title',
    displayAlbum: 'Unknown Album',
    displayArtist: 'Unknown Artist',
    displayTrackNumber: '',
    displayTrackTotal: '',
    displayTechnical: '',
    displayLyrics: '',
    tagsResolved: false,
    mbMetadataResolved: false,
    technicalDetails: {},
    allFileTags: {},
    mbIds: {},
    artistMbids: [],
    mbArtistCredits: [],
});

const createDeferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
};

const createContext = (coverPromise: Promise<void>): AppPlaybackControlsRuntimeContext => {
    const renderFolder = vi.fn();
    return {
        tracks: [createTrack()],
        currentTrackIndex: -1,
        gaplessQueueRequestVersion: 0,
        queuedGaplessTrackPath: '',
        playPauseToggleInFlight: false,
        playbackMutationVersion: 0,
        trackNavigationChain: Promise.resolve(),
        currentSettings: {
            preferMusicBrainzMetadata: false,
            minimizeToTrayOnClose: false,
            keyboardShortcuts: {
                focusLibraryFilter: '',
                openSettings: '',
                playPauseToggle: '',
                nextTrack: '',
                previousTrack: '',
                stopPlayback: '',
            },
        } as never,
        playbackSequencingService: {
            getPlaybackOrderMode: vi.fn(() => 'ordered-library'),
        } as never,
        playlistController: () => ({
            activatePlaybackQueueSource: vi.fn(),
            scheduleRender: vi.fn(),
        }) as never,
        scrobbleService: {
            startTrackSession: vi.fn(),
        } as never,
        libraryController: () => ({
            isSidebarOpen: vi.fn(() => false),
            setSidebarAutoFolderPath: vi.fn(),
            renderFolder,
            setLibraryLoading: vi.fn(),
            setLibraryLoadingEtaSeconds: vi.fn(),
            setLibraryLoadingStatusLabel: vi.fn(),
            setLibraryPathMessage: vi.fn(),
            setSidebarOpen: vi.fn(),
        }) as never,
        settingsController: () => ({
            open: vi.fn(),
        }) as never,
        sidebarController: {
            showLibrary: vi.fn(),
        } as never,
        librarySearch: document.createElement('input'),
        aboutVersion: document.createElement('div'),
        availableAudioOutputDevices: [],
        playbackStateService: {
            getPlaybackState: vi.fn(() => ({ loaded: true, playing: false, currentTime: 0, duration: 0, sourcePath: '/music/track.flac', volume: 1, endEventId: 0 })),
            isBackendReady: vi.fn(() => true),
        } as never,
        coverArt: Object.assign(document.createElement('img'), { src: '/cover.png' }),
        setCoverFlipped: vi.fn(),
        logPlaybackDebug: vi.fn(),
        collectReplayGainReleaseTrackPathsForIndex: vi.fn(() => []),
        setActiveReplayGainReleaseTrackPaths: vi.fn(),
        applyPlaybackState: vi.fn(),
        handleAudioError: vi.fn(),
        hasConfiguredLibraryFolders: vi.fn(() => false),
        beginLibraryLoadTracking: vi.fn(),
        markLibraryScanResolved: vi.fn(),
        finishLibraryLoadTracking: vi.fn(),
        libraryClientFinalizeEstimateMs: 0,
        loadLibraryScan: vi.fn(async () => undefined),
        refreshNowPlayingLabel: vi.fn(),
        applyCoverArtForTrack: vi.fn(async () => {
            await coverPromise;
        }),
        hydrateCurrentTrackTag: vi.fn(async () => undefined),
        artistInfoRequestVersion: 0,
        hydrateCurrentArtistInfo: vi.fn(async () => undefined),
        tagRequestVersion: 0,
        shouldSkipLoadedTrack: vi.fn(async () => false),
        nextTrackIndexForDirection: vi.fn(() => undefined),
        updatePlayButton: vi.fn(),
        currentTrackIndexForReleasePlayback: vi.fn(() => -1),
    } as unknown as AppPlaybackControlsRuntimeContext;
};

describe('createAppPlaybackControlsRuntime', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('starts track tag hydration before cover loading completes', async () => {
        const coverDeferred = createDeferred();
        const context = createContext(coverDeferred.promise);
        const runtime = createAppPlaybackControlsRuntime(context);

        const loadPromise = runtime.loadTrack(0);
        await vi.waitFor(() => expect(context.applyCoverArtForTrack).toHaveBeenCalledWith(0));

        expect(context.hydrateCurrentTrackTag).toHaveBeenCalledWith(0, 1);
        expect(context.libraryController().renderFolder).not.toHaveBeenCalled();

        coverDeferred.resolve();
        await loadPromise;

        expect(context.applyCoverArtForTrack).toHaveBeenCalledWith(0);
        expect(context.libraryController().renderFolder).toHaveBeenCalledWith('none');
    });
});
