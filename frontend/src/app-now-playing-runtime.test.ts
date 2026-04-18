import { afterEach, describe, expect, it, vi } from 'vitest';

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
        refreshReplayGainReleaseDynamicRangeIndicator: vi.fn(async () => undefined),
        releaseRootPathForTrack: vi.fn(() => ''),
        replayGainReleaseDynamicRangeCacheKey: vi.fn(() => ''),
        replayGainReleaseKeyForTrack: vi.fn(() => ''),
        replayGainReleaseTrackPaths: vi.fn(() => []),
        replayGainReleaseTrackPathsForIndex: vi.fn(() => []),
    })),
}));

import { createAppNowPlayingRuntime } from './app-now-playing-runtime';
import type { AppNowPlayingRuntimeContext } from './app-runtime-setup';

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
        playlistController: () => ({ scheduleRender: vi.fn() }) as never,
        coverArtService: {
            invalidateForTrack: vi.fn(),
            getCachedMediaArtwork: vi.fn(() => undefined),
            resolveForTrack: vi.fn(async () => undefined),
        } as never,
        trackMetadataService: {
            ensureTrackTagsResolved: vi.fn(async () => undefined),
            ensureTrackTagsResolvedBatch: vi.fn(async () => undefined),
            refreshTrack: vi.fn(async () => null),
        } as never,
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
            isTrackSubmissionPending: vi.fn(() => false),
        } as never,
        updateMediaSessionMetadata: vi.fn(),
        updateMediaSessionPlaybackState: vi.fn(),
        updateMediaSessionPositionState: vi.fn(),
        refreshListenBrainzFeedbackForCurrentTrack: vi.fn(async () => undefined),
        openErrorModal: vi.fn(),
        handleAudioError: vi.fn(),
        setCoverFlipped: vi.fn(),
        shouldSkipLoadedTrack: vi.fn(async () => false),
        nextTrackIndexForDirection: vi.fn(() => undefined),
        applyCoverArtForTrack: vi.fn(async () => undefined),
        setActiveReplayGainReleaseTrackPaths: vi.fn(),
        libraryController: () => ({ isSidebarOpen: vi.fn(() => false), setSidebarAutoFolderPath: vi.fn(), renderFolder: vi.fn() }) as never,
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
});