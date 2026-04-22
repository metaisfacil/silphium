import { afterEach, describe, expect, it, vi } from 'vitest';

const { refreshReplayGainReleaseDynamicRangeIndicatorMock } = vi.hoisted(() => ({
    refreshReplayGainReleaseDynamicRangeIndicatorMock: vi.fn(async () => undefined),
}));

vi.mock('../wailsjs/go/main/App', () => ({
    AudioGetState: vi.fn(async () => ({ loaded: false })),
    AudioQueueNextTrack: vi.fn(async () => ({ queued: false })),
    AudioQueueNextTrackWithReplayGainContext: vi.fn(async () => ({ queued: false })),
    InitializeAudioBackend: vi.fn(async () => ({ loaded: false })),
    LogFrontendMessage: vi.fn(async () => undefined),
}));

vi.mock('./components/media-controls', () => ({
    renderPlayPauseIcon: vi.fn(),
}));

vi.mock('./components/media-controls-exploration', () => ({
    updateExplorationButton: vi.fn(),
}));

vi.mock('./musicbrainz', () => ({
    applyMbLinks: vi.fn(),
}));

vi.mock('./app-release-runtime', () => ({
    createAppReleaseRuntime: vi.fn(() => ({
        cachedReplayGainReleaseDynamicRangeLabelForCurrentTrack: vi.fn(() => ''),
        clearReplayGainReleaseDynamicRangeCache: vi.fn(),
        collectReleaseImageFiles: vi.fn(() => []),
        collectReplayGainReleaseTrackPathsForIndex: vi.fn(() => []),
        currentReplayGainReleaseTrackPaths: vi.fn(() => []),
        indexOfImageByPath: vi.fn(() => -1),
        refreshReplayGainReleaseDynamicRangeIndicator: refreshReplayGainReleaseDynamicRangeIndicatorMock,
        releaseRootPathForTrack: vi.fn(() => ''),
        replayGainReleaseDynamicRangeCacheKey: vi.fn(() => ''),
        replayGainReleaseKeyForTrack: vi.fn(() => ''),
        replayGainReleaseTrackPaths: vi.fn(() => []),
        replayGainReleaseTrackPathsForIndex: vi.fn(() => []),
    })),
}));

vi.mock('./utils/bridge-load-gate', async () => {
    const actual = await vi.importActual<typeof import('./utils/bridge-load-gate')>('./utils/bridge-load-gate');
    return {
        ...actual,
        runBackgroundBridgeCall: vi.fn(async (callback: () => Promise<unknown> | unknown, options?: { onTimeout?: () => Promise<unknown> | unknown }) => {
            if (options?.onTimeout) {
                return await callback();
            }

            return await callback();
        }),
        shouldDeferBackgroundBridgeCall: vi.fn(() => false),
    };
});

import { createAppNowPlayingRuntime } from './app-now-playing-runtime';
import { AudioGetState, AudioQueueNextTrack, InitializeAudioBackend } from '../wailsjs/go/main/App';
import type { AppNowPlayingRuntimeContext } from './app-runtime-setup';
import { createPlaybackStateService } from './services/playback-state-service';
import { playbackReconcileMaxPollIntervalMs } from './utils/playback-reconcile-delay';
import { runBackgroundBridgeCall, shouldDeferBackgroundBridgeCall } from './utils/bridge-load-gate';

const createContext = (): AppNowPlayingRuntimeContext => {
    const playerShell = document.createElement('div');
    const playerLane = document.createElement('div');
    const playerCard = document.createElement('div');
    const lyricsPanel = document.createElement('aside');
    const lyricsContent = document.createElement('div');
    playerShell.append(playerLane);
    playerLane.append(playerCard, lyricsPanel);
    lyricsPanel.append(lyricsContent);
    document.body.append(playerShell);

    return {
        playerShell,
        playerLane,
        playerCard,
        lyricsPanel,
        lyricsContent,
        currentTimeLabel: document.createElement('div'),
        trackDurationLabel: document.createElement('div'),
        seek: document.createElement('input'),
        volume: document.createElement('input'),
        isSeeking: false,
        tracks: [{
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
            displayLyrics: 'hello world',
            tagsResolved: false,
            mbMetadataResolved: false,
            technicalDetails: {},
            allFileTags: {},
            mbIds: {},
            artistMbids: [],
            mbArtistCredits: [],
        }],
        currentTrackIndex: 0,
        currentSettings: {
            audio: {
                gaplessPlayback: false,
            },
            scrobblingEnabled: false,
            scrobbleFilterMode: 'blacklist',
            scrobbleRules: [],
            preferMusicBrainzMetadata: false,
            lastFmApiKey: '',
            lastFmApiSecret: '',
            lastFmSessionKey: '',
        } as never,
        trackIndexByPath: new Map<string, number>(),
        textFileIndexByPath: new Map<string, number>(),
        imageFileIndexByPath: new Map<string, number>(),
        replayGainReleaseDynamicRangeLabelByKey: new Map<string, string>(),
        replayGainReleaseDynamicRangePendingByKey: new Map<string, Promise<string>>(),
        activeReplayGainReleaseTrackPaths: [],
        replayGainReleaseDynamicRangeRequestVersion: 0,
        imageFiles: [],
        textFiles: [],
        currentTrackPathsLoadedForLyricsRefresh: [],
        queuedGaplessTrackPath: '',
        gaplessQueueRequestVersion: 0,
        playbackMutationVersion: 0,
        pendingNowPlayingCoverRefreshHandle: null,
        tagRequestVersion: 0,
        artistInfoRequestVersion: 0,
        playPause: document.createElement('button'),
        coverArt: document.createElement('img'),
        coverArtBackground: document.createElement('img'),
        coverFlipper: document.createElement('div'),
        trackTitle: document.createElement('div'),
        trackAlbum: document.createElement('div'),
        trackPosition: document.createElement('div'),
        trackArtist: document.createElement('div'),
        trackTechnical: document.createElement('button'),
        trackTechnicalAlt: document.createElement('button'),
        trackReleaseAlbum: document.createElement('div'),
        trackTitleInline: document.createElement('div'),
        trackPositionInline: document.createElement('div'),
        trackReleaseLabel: document.createElement('div'),
        trackReleaseCat: document.createElement('div'),
        trackReleaseYear: document.createElement('div'),
        trackGenreInline: document.createElement('div'),
        trackArtistHeader: document.createElement('div'),
        playerLaneLayoutMode: 'default' as never,
        nowPlayingCoverRefreshDebounceMs: 220,
        playbackStateService: {
            getPlaybackState: vi.fn(() => ({ loaded: false, playing: false, currentTime: 0, duration: 0 })),
            setCurrentTime: vi.fn(() => false),
            applyPlaybackState: vi.fn(() => ({ trackEnded: false })),
            isBackendReady: vi.fn(() => true),
            setBackendReady: vi.fn(),
        } as never,
        playlistController: () => ({
            scheduleRender: vi.fn(),
            peekNextTrackIndex: vi.fn(() => undefined),
        }) as never,
        coverArtService: {
            invalidateForTrack: vi.fn(),
            invalidateResolvedForTrack: vi.fn(),
            getCachedMediaArtwork: vi.fn(() => undefined),
            resolveForTrack: vi.fn(async () => undefined),
        } as never,
        trackMetadataService: {
            ensureTrackTagsResolved: vi.fn(async () => undefined),
            ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
            refreshTrack: vi.fn(async () => ({ updatedTags: false, updatedMusicBrainz: false })),
        } as never,
        resolveCoverForTrack: vi.fn(async () => undefined),
        hydrateCurrentTrackTag: vi.fn(async () => undefined),
        hydrateCurrentArtistInfo: vi.fn(async () => undefined),
        playbackSequencingService: {
            getPlaybackOrderMode: vi.fn(() => 'ordered-library'),
            peekNextTrackIndexForDirection: vi.fn(() => undefined),
        } as never,
        visualizerController: {
            setPlaybackState: vi.fn(),
            start: vi.fn(),
        } as never,
        scrobbleService: {
            maybeSubmit: vi.fn(),
            startTrackSession: vi.fn(),
            completeLocalHistory: vi.fn(),
            isTrackSubmissionPending: vi.fn(() => false),
        } as never,
        updateMediaSessionMetadata: vi.fn(),
        updateMediaSessionPlaybackState: vi.fn(),
        updateMediaSessionPositionState: vi.fn(),
        refreshListenBrainzFeedbackForCurrentTrack: vi.fn(async () => undefined),
        openErrorModal: vi.fn(),
        handleAudioError: vi.fn(),
        setCoverFlipped: vi.fn(),
        setBackgroundCover: vi.fn(),
        shouldSkipLoadedTrack: vi.fn(async () => false),
        nextTrackIndexForDirection: vi.fn(() => undefined),
        applyCoverArtForTrack: vi.fn(async () => undefined),
        setActiveReplayGainReleaseTrackPaths: vi.fn(),
        libraryController: () => ({
            getLibraryRootName: vi.fn(() => ''),
            isSidebarOpen: vi.fn(() => false),
            renderFolder: vi.fn(),
            setLibraryPathMessage: vi.fn(),
            setSidebarAutoFolderPath: vi.fn(),
        }) as never,
        refreshNowPlayingLabel: vi.fn(),
        updatePlayButton: vi.fn(),
        loadTrack: vi.fn(async () => undefined),
        playCurrentTrack: vi.fn(async () => undefined),
        pauseCurrentTrack: vi.fn(async () => undefined),
        goToTrack: vi.fn(),
        currentSettingsMarker: true,
    } as unknown as AppNowPlayingRuntimeContext;
};

describe('createAppNowPlayingRuntime', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        refreshReplayGainReleaseDynamicRangeIndicatorMock.mockClear();
        document.body.innerHTML = '';
    });

    it('does not temporarily toggle lyrics-visible just to measure visibility', () => {
        const originalInnerWidth = window.innerWidth;
        const originalInnerHeight = window.innerHeight;
        vi.stubGlobal('innerWidth', 700);
        vi.stubGlobal('innerHeight', 800);

        const context = createContext();
        vi.spyOn(context.playerLane.classList, 'add');
        vi.spyOn(context.playerLane.classList, 'remove');
        vi.spyOn(context.playerCard, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            width: 500,
            height: 500,
            top: 0,
            right: 500,
            bottom: 500,
            left: 0,
            toJSON: () => ({}),
        });

        const runtime = createAppNowPlayingRuntime(context);
        runtime.updateLyricsPanelVisibility();

        expect(context.playerLane.classList.add).not.toHaveBeenCalledWith('lyrics-visible');
        expect(context.playerLane.classList.remove).not.toHaveBeenCalledWith('lyrics-visible');
        expect(context.lyricsPanel.getAttribute('aria-hidden')).toBe('true');

        vi.stubGlobal('innerWidth', originalInnerWidth);
        vi.stubGlobal('innerHeight', originalInnerHeight);
    });

    it('defers playback side effects until after the current task', () => {
        vi.useFakeTimers();

        const context = createContext();
        const runtime = createAppNowPlayingRuntime(context);
        const playbackState = {
            loaded: true,
            playing: false,
            currentTime: 1.37,
            duration: 249.19,
            volume: 0.8,
            sourcePath: '/music/track.flac',
            endEventId: 0,
        };

        runtime.applyPlaybackState(playbackState);

        expect(context.visualizerController.setPlaybackState).toHaveBeenCalledWith(playbackState);
        expect(context.updateMediaSessionMetadata).not.toHaveBeenCalled();
        expect(context.updateMediaSessionPlaybackState).not.toHaveBeenCalled();
        expect(context.updateMediaSessionPositionState).not.toHaveBeenCalled();

        vi.runOnlyPendingTimers();

        expect(context.updateMediaSessionMetadata).toHaveBeenCalledTimes(1);
        expect(context.updateMediaSessionPlaybackState).toHaveBeenCalledTimes(1);
        expect(context.updateMediaSessionPositionState).toHaveBeenCalledTimes(1);
        expect(context.visualizerController.setPlaybackState).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('does not resolve tags before play for normal-length tracks', async () => {
        const context = createContext();
        context.playbackStateService.getPlaybackState = vi.fn(() => ({
            loaded: true,
            playing: false,
            currentTime: 0,
            duration: 260.33,
            sourcePath: '/music/track.flac',
            volume: 1,
            endEventId: 0,
        })) as never;

        const runtime = createAppNowPlayingRuntime(context);

        await expect(runtime.shouldSkipLoadedTrack()).resolves.toBe(false);
        expect(context.trackMetadataService.ensureTrackTagsResolved).not.toHaveBeenCalled();
    });

    it('animates the player card when playback advances to a different track', () => {
        vi.useFakeTimers();

        const context = createContext();
        context.tracks = [
            context.tracks[0],
            {
                ...context.tracks[0],
                title: 'Next Track',
                name: 'next.flac',
                path: '/music/next.flac',
                relativePath: 'next.flac',
                displayTitle: 'Next Track',
                displayAlbum: 'Next Album',
                displayArtist: 'Next Artist',
            },
        ];

        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback): number => {
            callback(0);
            return 1;
        }) as typeof requestAnimationFrame);

        const runtime = createAppNowPlayingRuntime(context);

        runtime.syncCurrentTrackFromPlaybackState({
            loaded: true,
            playing: true,
            currentTime: 0,
            duration: 240,
            volume: 0.8,
            sourcePath: '/music/next.flac',
            endEventId: 0,
        });

        expect(context.currentTrackIndex).toBe(1);
        expect(context.playerCard.classList.contains('is-track-transitioning')).toBe(true);
        expect(context.trackTitle.textContent).not.toBe('Next Track');

        vi.advanceTimersByTime(90);

        expect(context.playerCard.classList.contains('is-track-transitioning')).toBe(false);
        expect(context.trackTitle.textContent).toBe('Next Track');

        vi.useRealTimers();
    });

    it('still resolves tags for short tracks before applying the silence heuristic', async () => {
        const context = createContext();
        context.playbackStateService.getPlaybackState = vi.fn(() => ({
            loaded: true,
            playing: false,
            currentTime: 0,
            duration: 5,
            sourcePath: '/music/track.flac',
            volume: 1,
            endEventId: 0,
        })) as never;

        const runtime = createAppNowPlayingRuntime(context);

        await expect(runtime.shouldSkipLoadedTrack()).resolves.toBe(false);
        expect(context.trackMetadataService.ensureTrackTagsResolved).toHaveBeenCalledWith(0);
    });

    it('reconciles an automatic track transition within the capped polling interval', async () => {
        vi.useFakeTimers();

        const context = createContext();
        context.currentTrackIndex = -1;
        context.tracks = [
            context.tracks[0],
            {
                ...context.tracks[0],
                title: 'Next Track',
                name: 'next.flac',
                path: '/music/next.flac',
                relativePath: 'next.flac',
                displayTitle: 'Next Track',
                displayAlbum: 'Next Album',
                displayArtist: 'Next Artist',
            },
        ];
        context.playbackStateService = createPlaybackStateService() as never;

        vi.mocked(InitializeAudioBackend).mockResolvedValue({
            loaded: true,
            playing: true,
            currentTime: 0,
            duration: 180,
            volume: 0.8,
            sourcePath: '/music/track.flac',
            endEventId: 0,
        });
        vi.mocked(AudioGetState).mockResolvedValue({
            loaded: true,
            playing: true,
            currentTime: 18,
            duration: 240,
            volume: 0.8,
            sourcePath: '/music/next.flac',
            endEventId: 0,
        });

        const runtime = createAppNowPlayingRuntime(context);
        await runtime.initializeBackendPlayback();

        expect(context.currentTrackIndex).toBe(0);
        await vi.advanceTimersByTimeAsync(90);
        expect(context.trackTitle.textContent).toBe('Track');

        await vi.advanceTimersByTimeAsync(playbackReconcileMaxPollIntervalMs + 1);

        expect(context.currentTrackIndex).toBe(1);
        expect(context.trackTitle.textContent).toBe('Next Track');
        expect(context.scrobbleService.completeLocalHistory).toHaveBeenCalledWith(
            expect.objectContaining({ path: '/music/track.flac' }),
            180,
        );

        vi.useRealTimers();
    });

    it('keeps the transport UI active across a transient not-playing snapshot during automatic track advance', async () => {
        vi.useFakeTimers();

        const context = createContext();
        context.currentTrackIndex = -1;
        context.tracks = [
            context.tracks[0],
            {
                ...context.tracks[0],
                title: 'Next Track',
                name: 'next.flac',
                path: '/music/next.flac',
                relativePath: 'next.flac',
                displayTitle: 'Next Track',
                displayAlbum: 'Next Album',
                displayArtist: 'Next Artist',
            },
        ];
        context.playbackStateService = createPlaybackStateService() as never;

        vi.mocked(InitializeAudioBackend).mockResolvedValue({
            loaded: true,
            playing: true,
            currentTime: 178,
            duration: 180,
            volume: 0.8,
            sourcePath: '/music/track.flac',
            endEventId: 0,
        });
        vi.mocked(AudioGetState)
            .mockResolvedValueOnce({
                loaded: true,
                playing: false,
                currentTime: 0,
                duration: 240,
                volume: 0.8,
                sourcePath: '/music/next.flac',
                endEventId: 0,
            })
            .mockResolvedValueOnce({
                loaded: true,
                playing: true,
                currentTime: 2.4,
                duration: 240,
                volume: 0.8,
                sourcePath: '/music/next.flac',
                endEventId: 0,
            });

        const runtime = createAppNowPlayingRuntime(context);
        await runtime.initializeBackendPlayback();

        await vi.advanceTimersByTimeAsync(playbackReconcileMaxPollIntervalMs + 1);

        expect(context.currentTrackIndex).toBe(1);
        expect(context.playPause.dataset.state).toBe('pause');
        expect(context.playbackStateService.getPlaybackState().playing).toBe(true);

        await vi.advanceTimersByTimeAsync(playbackReconcileMaxPollIntervalMs + 1);

        expect(context.currentTimeLabel.textContent).toBe('0:02');

        vi.useRealTimers();
    });

    it('re-pushes a current-track metadata refresh as soon as an automatic advance settles', async () => {
        vi.useFakeTimers();

        const context = createContext();
        context.currentTrackIndex = -1;
        context.tracks = [
            context.tracks[0],
            {
                ...context.tracks[0],
                title: 'Next Track',
                name: 'next.flac',
                path: '/music/next.flac',
                relativePath: 'next.flac',
                displayTitle: 'Next Track',
                displayAlbum: 'Next Album',
                displayArtist: 'Next Artist',
            },
        ];
        context.playbackStateService = createPlaybackStateService() as never;

        const refreshTrack = vi.fn(async () => ({ updatedTags: true, updatedMusicBrainz: false }));
        context.trackMetadataService = {
            ensureTrackTagsResolved: vi.fn(async () => undefined),
            ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
            refreshTrack,
        } as never;

        vi.mocked(InitializeAudioBackend).mockResolvedValue({
            loaded: true,
            playing: true,
            currentTime: 178,
            duration: 180,
            volume: 0.8,
            sourcePath: '/music/track.flac',
            endEventId: 0,
        });
        vi.mocked(AudioGetState).mockResolvedValue({
            loaded: true,
            playing: true,
            currentTime: 0,
            duration: 240,
            volume: 0.8,
            sourcePath: '/music/next.flac',
            endEventId: 0,
        });

        const runtime = createAppNowPlayingRuntime(context);
        await runtime.initializeBackendPlayback();

        expect(refreshTrack).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(playbackReconcileMaxPollIntervalMs + 1);
        expect(context.currentTrackIndex).toBe(1);
        expect(refreshTrack).toHaveBeenCalledTimes(1);
        expect(refreshTrack).toHaveBeenCalledWith(1, 3);

        await vi.advanceTimersByTimeAsync(100);

        expect(refreshTrack).toHaveBeenCalledTimes(1);

        vi.useRealTimers();
    });

    it('preloads the next sequential track early in gapless mode so manual forward can reuse it', async () => {
        vi.useFakeTimers();

        const context = createContext();
        context.currentSettings.audio.gaplessPlayback = true;
        context.tracks = [
            context.tracks[0],
            {
                ...context.tracks[0],
                title: 'Next Track',
                name: 'next.flac',
                path: '/music/next.flac',
                relativePath: 'next.flac',
                displayTitle: 'Next Track',
            },
        ];
        context.playlistController = () => ({
            scheduleRender: vi.fn(),
            peekNextTrackIndex: vi.fn(() => 1),
        }) as never;
        context.playbackStateService.getPlaybackState = vi.fn(() => ({
            loaded: true,
            playing: true,
            currentTime: 1.1,
            duration: 180,
            sourcePath: '/music/track.flac',
            volume: 1,
            endEventId: 0,
        })) as never;
        context.playbackStateService.applyPlaybackState = vi.fn(() => ({ trackEnded: false })) as never;

        const runtime = createAppNowPlayingRuntime(context);
        runtime.applyPlaybackState({
            loaded: true,
            playing: true,
            currentTime: 1.1,
            duration: 180,
            sourcePath: '/music/track.flac',
            volume: 1,
            endEventId: 0,
        });

        await vi.runAllTimersAsync();

        expect(AudioQueueNextTrack).toHaveBeenCalledWith('/music/track.flac', '/music/next.flac');
        expect(context.resolveCoverForTrack).toHaveBeenCalledWith(context.tracks[1]);

        vi.useRealTimers();
    });

    it('does not refresh replay-gain dynamic range during routine playback-state effects', async () => {
        vi.useFakeTimers();

        const context = createContext();
        context.playbackStateService.getPlaybackState = vi.fn(() => ({
            loaded: true,
            playing: true,
            currentTime: 1.1,
            duration: 180,
            sourcePath: '/music/track.flac',
            volume: 1,
            endEventId: 0,
        })) as never;
        context.playbackStateService.applyPlaybackState = vi.fn(() => ({ trackEnded: false })) as never;

        const runtime = createAppNowPlayingRuntime(context);
        runtime.applyPlaybackState({
            loaded: true,
            playing: true,
            currentTime: 1.1,
            duration: 180,
            sourcePath: '/music/track.flac',
            volume: 1,
            endEventId: 0,
        });

        await vi.runAllTimersAsync();

        expect(refreshReplayGainReleaseDynamicRangeIndicatorMock).not.toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('still polls playback state when the background bridge window times out', async () => {
        vi.useFakeTimers();

        const context = createContext();
        context.currentTrackIndex = -1;
        context.tracks = [
            context.tracks[0],
            {
                ...context.tracks[0],
                title: 'Next Track',
                name: 'next.flac',
                path: '/music/next.flac',
                relativePath: 'next.flac',
                displayTitle: 'Next Track',
                displayAlbum: 'Next Album',
                displayArtist: 'Next Artist',
            },
        ];
        context.playbackStateService = createPlaybackStateService() as never;

        vi.mocked(runBackgroundBridgeCall).mockImplementation(async (_callback, options) => {
            return await options?.onTimeout?.();
        });
        vi.mocked(shouldDeferBackgroundBridgeCall).mockReturnValue(true);

        vi.mocked(InitializeAudioBackend).mockResolvedValue({
            loaded: true,
            playing: true,
            currentTime: 0,
            duration: 180,
            volume: 0.8,
            sourcePath: '/music/track.flac',
            endEventId: 0,
        });
        vi.mocked(AudioGetState).mockResolvedValue({
            loaded: true,
            playing: true,
            currentTime: 4,
            duration: 240,
            volume: 0.8,
            sourcePath: '/music/next.flac',
            endEventId: 0,
        });

        const runtime = createAppNowPlayingRuntime(context);
        await runtime.initializeBackendPlayback();

        await vi.advanceTimersByTimeAsync(playbackReconcileMaxPollIntervalMs + 1);

        expect(context.currentTrackIndex).toBe(1);
        expect(vi.mocked(AudioGetState)).toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('keeps the cached cover art intact during current-track metadata refresh', async () => {
        const context = createContext();
        const runtime = createAppNowPlayingRuntime(context);

        await runtime.refreshCurrentTrackMetadata();

        expect(context.coverArtService.invalidateForTrack).not.toHaveBeenCalled();
        expect(context.trackMetadataService.refreshTrack).toHaveBeenCalledWith(0, 1);
        expect(context.resolveCoverForTrack).toHaveBeenCalledWith(context.tracks[0]);
    });

    it('refreshes the now-playing cover without dropping the folder cover path cache', async () => {
        vi.useFakeTimers();

        const context = createContext();
        const runtime = createAppNowPlayingRuntime(context);

        runtime.scheduleNowPlayingCoverRefresh();
        await vi.advanceTimersByTimeAsync(context.nowPlayingCoverRefreshDebounceMs);

        expect(context.coverArtService.invalidateResolvedForTrack).toHaveBeenCalledWith(context.tracks[0]);
        expect(context.coverArtService.invalidateForTrack).not.toHaveBeenCalled();
        expect(context.resolveCoverForTrack).toHaveBeenCalledWith(context.tracks[0]);

        vi.useRealTimers();
    });
});