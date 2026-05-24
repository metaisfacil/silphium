import { afterEach, describe, expect, it, vi } from 'vitest';

const {
    audioLoadTrackMock,
    audioPauseMock,
    audioPlayMock,
    createMediaSessionControllerMock,
    logFrontendMessageMock,
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
    audioPauseMock: vi.fn(async () => ({ loaded: true, playing: false, currentTime: 0, duration: 0, sourcePath: '/music/track.flac', volume: 1, endEventId: 0 })),
    audioPlayMock: vi.fn(async () => ({ loaded: true, playing: true, currentTime: 0, duration: 0, sourcePath: '/music/track.flac', volume: 1, endEventId: 0 })),
    logFrontendMessageMock: vi.fn(async () => undefined),
    windowHideMock: vi.fn(),
    windowIsMinimisedMock: vi.fn(async () => false),
}));

vi.mock('../wailsjs/go/main/App', () => ({
    AudioListOutputDevices: vi.fn(async () => []),
    AudioLoadTrack: audioLoadTrackMock,
    AudioLoadTrackWithReplayGainContext: vi.fn(async () => ({ loaded: true, playing: false, currentTime: 0, duration: 0, sourcePath: '/music/track.flac', volume: 1, endEventId: 0 })),
    AudioPause: audioPauseMock,
    AudioPlay: audioPlayMock,
    AudioSeek: vi.fn(async () => ({ loaded: true, playing: false, currentTime: 0, duration: 0, sourcePath: '/music/track.flac', volume: 1, endEventId: 0 })),
    AudioStop: vi.fn(async () => ({ loaded: false, playing: false, currentTime: 0, duration: 0, sourcePath: '', volume: 1, endEventId: 0 })),
    GetAppVersion: vi.fn(async () => 'dev'),
    LogFrontendMessage: logFrontendMessageMock,
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
import { createInitialPlaybackState, createPlaybackStateService } from './services/playback-state-service';
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

const createDeferred = <T = void>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
    });
    return { promise, resolve };
};

const createContext = (coverPromise: Promise<void>): AppPlaybackControlsRuntimeContext => {
    const renderFolder = vi.fn();
    return {
        tracks: [createTrack()],
        currentTrackIndex: -1,
        isWindowsRuntime: false,
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
            getSequenceOverride: vi.fn(() => null),
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
            setPlaying: vi.fn(() => true),
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
        resetShuffleHistory: vi.fn(),
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
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('does not unlock the media session anchor inside playCurrentTrack', async () => {
        const coverDeferred = createDeferred();
        const context = createContext(coverDeferred.promise);
        context.currentTrackIndex = 0;

        const runtime = createAppPlaybackControlsRuntime(context);
        await runtime.playCurrentTrack();

        const mediaSessionController = createMediaSessionControllerMock.mock.results.at(-1)?.value;
        expect(mediaSessionController?.unlockFromUserGesture).not.toHaveBeenCalled();
    });

    it('disables browser media session integration on Windows runtime', () => {
        const coverDeferred = createDeferred();
        const context = createContext(coverDeferred.promise);
        context.isWindowsRuntime = true;

        createAppPlaybackControlsRuntime(context);

        expect(createMediaSessionControllerMock).toHaveBeenCalledWith(expect.objectContaining({
            enableBrowserMediaSession: false,
        }));
    });

    it('updates cover art immediately while deferring current-track hydration until after the post-load idle window', async () => {
        vi.useFakeTimers();

        const coverDeferred = createDeferred();
        const context = createContext(coverDeferred.promise);
        const runtime = createAppPlaybackControlsRuntime(context);

        await runtime.loadTrack(0);

        expect(context.hydrateCurrentTrackTag).not.toHaveBeenCalled();
        expect(context.applyCoverArtForTrack).toHaveBeenCalledTimes(1);
        expect(context.applyCoverArtForTrack).toHaveBeenCalledWith(0);
        expect(context.libraryController().renderFolder).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(299);
        expect(context.hydrateCurrentTrackTag).not.toHaveBeenCalled();
        expect(context.applyCoverArtForTrack).toHaveBeenCalledTimes(1);
        expect(context.libraryController().renderFolder).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(context.hydrateCurrentTrackTag).toHaveBeenCalledWith(0, 1);
        expect(context.applyCoverArtForTrack).toHaveBeenCalledTimes(1);
        expect(context.libraryController().renderFolder).toHaveBeenCalledWith('none');

        coverDeferred.resolve();
    });

    it('reschedules deferred hydration after play so transport is not competing with post-load work', async () => {
        vi.useFakeTimers();

        const coverDeferred = createDeferred();
        const context = createContext(coverDeferred.promise);
        context.currentTrackIndex = 0;

        const runtime = createAppPlaybackControlsRuntime(context);

        await runtime.loadTrack(0);
        expect(context.hydrateCurrentTrackTag).not.toHaveBeenCalled();
        expect(context.applyCoverArtForTrack).toHaveBeenCalledTimes(1);

        await runtime.playCurrentTrack();

        await vi.advanceTimersByTimeAsync(299);
        expect(context.hydrateCurrentTrackTag).not.toHaveBeenCalled();
        expect(context.applyCoverArtForTrack).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        expect(context.hydrateCurrentTrackTag).toHaveBeenCalledWith(0, 1);
        expect(context.applyCoverArtForTrack).toHaveBeenCalledTimes(1);
        expect(context.libraryController().renderFolder).toHaveBeenCalledWith('none');

        coverDeferred.resolve();
    });

    it('keeps folder refresh behind deferred metadata hydration after load while cover art updates immediately', async () => {
        vi.useFakeTimers();

        const coverDeferred = createDeferred();
        const hydrateDeferred = createDeferred<void>();
        const context = createContext(coverDeferred.promise);
        context.hydrateCurrentTrackTag = vi.fn(async () => {
            await hydrateDeferred.promise;
        }) as never;

        const runtime = createAppPlaybackControlsRuntime(context);

        await runtime.loadTrack(0);
        expect(context.applyCoverArtForTrack).toHaveBeenCalledWith(0);

        await vi.advanceTimersByTimeAsync(300);

        expect(context.hydrateCurrentTrackTag).toHaveBeenCalledWith(0, 1);
        expect(context.applyCoverArtForTrack).toHaveBeenCalledTimes(1);
        expect(context.libraryController().renderFolder).not.toHaveBeenCalled();

        hydrateDeferred.resolve();
        await vi.waitFor(() => {
            expect(context.libraryController().renderFolder).toHaveBeenCalledWith('none');
        });

        coverDeferred.resolve();
    });

    it('does not schedule deferred hydration on same-track resume when metadata is already resolved', async () => {
        vi.useFakeTimers();

        const coverDeferred = createDeferred();
        const context = createContext(coverDeferred.promise);
        context.currentTrackIndex = 0;
        context.tracks[0] = {
            ...context.tracks[0],
            tagsResolved: true,
            mbMetadataResolved: true,
        };

        const runtime = createAppPlaybackControlsRuntime(context);

        await runtime.playCurrentTrack();
        await vi.advanceTimersByTimeAsync(300);

        expect(context.hydrateCurrentTrackTag).not.toHaveBeenCalled();
        expect(context.applyCoverArtForTrack).not.toHaveBeenCalled();
        expect(context.hydrateCurrentArtistInfo).not.toHaveBeenCalled();

        coverDeferred.resolve();
    });

    it('updates the play button optimistically before AudioPlay resolves', async () => {
        const coverDeferred = createDeferred();
        const playDeferred = createDeferred<{
            loaded: boolean;
            playing: boolean;
            currentTime: number;
            duration: number;
            sourcePath: string;
            volume: number;
            endEventId: number;
        }>();
        audioPlayMock.mockImplementationOnce(async () => await playDeferred.promise);

        const context = createContext(coverDeferred.promise);
        context.currentTrackIndex = 0;
        const playbackStateService = createPlaybackStateService();
        playbackStateService.applyPlaybackState({
            ...createInitialPlaybackState(),
            loaded: true,
            playing: false,
            sourcePath: '/music/track.flac',
            volume: 1,
        }, true);
        playbackStateService.setBackendReady(true);
        context.playbackStateService = playbackStateService as never;

        const runtime = createAppPlaybackControlsRuntime(context);
        const playPromise = runtime.playCurrentTrack();

        await vi.waitFor(() => {
            expect(playbackStateService.getPlaybackState().playing).toBe(true);
            expect(context.updatePlayButton).toHaveBeenCalled();
        });
        expect(context.applyPlaybackState).not.toHaveBeenCalled();

        playDeferred.resolve({
            loaded: true,
            playing: true,
            currentTime: 0,
            duration: 0,
            sourcePath: '/music/track.flac',
            volume: 1,
            endEventId: 0,
        });
        await playPromise;

        expect(context.applyPlaybackState).toHaveBeenCalled();
    });

    it('passes playlist sequence override indexes into loadTrack during manual navigation', async () => {
        const coverDeferred = createDeferred();
        const context = createContext(coverDeferred.promise);
        (context.tracks as Track[]).push({
            ...createTrack(),
            title: 'Next Track',
            name: 'next.flac',
            path: '/music/next.flac',
            relativePath: 'next.flac',
            displayTitle: 'Next Track',
        });
        context.currentTrackIndex = 0;
        const getSequenceOverride = vi.fn(() => ({ indexes: [0, 1], currentPosition: 0 }));
        context.playlistController = () => ({
            activatePlaybackQueueSource: vi.fn(),
            getSequenceOverride,
            scheduleRender: vi.fn(),
        }) as never;
        context.nextTrackIndexForDirection = vi.fn(() => 1);

        const runtime = createAppPlaybackControlsRuntime(context);
        runtime.goToTrack(1);
        await context.trackNavigationChain;

        expect(getSequenceOverride).toHaveBeenCalled();
        expect(context.collectReplayGainReleaseTrackPathsForIndex).toHaveBeenCalledWith(1, [0, 1]);

        coverDeferred.resolve();
    });

    it('keeps playlist shuffle selections attached to the playlist source instead of forcing queue mode', async () => {
        const coverDeferred = createDeferred();
        const context = createContext(coverDeferred.promise);
        const activatePlaybackQueueSource = vi.fn();
        const getSequenceOverride = vi.fn(() => ({ indexes: [0], currentPosition: 0 }));
        context.playbackSequencingService.getPlaybackOrderMode = vi.fn(() => 'shuffle-library') as never;
        context.playlistController = () => ({
            activatePlaybackQueueSource,
            getSequenceOverride,
            scheduleRender: vi.fn(),
        }) as never;

        const runtime = createAppPlaybackControlsRuntime(context);
        await runtime.loadTrack(0, true, undefined, true);

        expect(getSequenceOverride).toHaveBeenCalled();
        expect(activatePlaybackQueueSource).not.toHaveBeenCalled();
        expect(context.resetShuffleHistory).toHaveBeenCalled();

        coverDeferred.resolve();
    });
});
