import {
    AudioListOutputDevices,
    AudioLoadTrack,
    AudioLoadTrackWithReplayGainContext,
    AudioPause,
    AudioPlay,
    AudioSeek,
    AudioStop,
    GetAppVersion,
    LogFrontendMessage,
    ScanConfiguredLibraryFolders,
} from '../wailsjs/go/main/App';
import { WindowHide, WindowIsMinimised } from '../wailsjs/runtime/runtime';
import type { AppPlaybackControlsRuntimeContext } from './app-runtime-setup';
import { createMediaSessionController, type ExternalPlaybackAction } from './controllers/media-session-controller';
import type { AudioOutputDevice, AudioPlaybackState, LibraryScanResult, Track } from './types/app-types';
import { runInteractiveBridgeCall } from './utils/bridge-load-gate';
import {
    describeErrorForLog,
    formatPlaybackStateForLog,
    isMissingTrackLoadError,
    shouldSuppressFocusedShortcut,
} from './utils/display-helpers';
import {
    formatShortcutBindingFromKeyboardEvent,
    shortcutBindingUsesCode,
} from './utils/shortcut-bindings';
import {
    summarizeAudioOutputDevicesForBridge,
    summarizeAudioPlaybackStateForBridge,
    summarizeLibraryScanResultForBridge,
    traceBridgeCall,
} from './utils/bridge-trace';
import { formatPerfLogMessage } from './utils/perf-log';

export const createAppPlaybackControlsRuntime = (context: AppPlaybackControlsRuntimeContext) => {
    const devPerfLoggingEnabled = import.meta.env.DEV && typeof (globalThis as { vi?: unknown }).vi === 'undefined';
    const postLoadTrackHydrationDelayMs = 300;
    const postPlayTrackHydrationDelayMs = 300;
    let lastTransportPerfLogAtMs = 0;
    let pendingTrackHydrationHandle: number | undefined;
    let pendingTrackHydrationToken = 0;

    const bridgeTraceSink = async (message: string): Promise<void> => {
        await LogFrontendMessage(message);
    };

    const clearPendingTrackHydration = (): void => {
        pendingTrackHydrationToken += 1;
        if (pendingTrackHydrationHandle !== undefined) {
            window.clearTimeout(pendingTrackHydrationHandle);
            pendingTrackHydrationHandle = undefined;
        }
    };

    const finalizeDeferredTrackHydration = (index: number): void => {
        if (index !== context.currentTrackIndex || index < 0 || index >= context.tracks.length) {
            return;
        }

        void context.applyCoverArtForTrack(index).catch((error: unknown) => {
            console.error(error);
        });

        context.libraryController().renderFolder('none');

        context.artistInfoRequestVersion += 1;
        void context.hydrateCurrentArtistInfo(index);
    };

    const runDeferredTrackHydration = (index: number): void => {
        if (index !== context.currentTrackIndex || index < 0 || index >= context.tracks.length) {
            return;
        }

        context.tagRequestVersion += 1;
        const requestVersion = context.tagRequestVersion;
        void context.hydrateCurrentTrackTag(index, requestVersion)
            .catch((error: unknown) => {
                console.error(error);
            })
            .finally(() => {
                finalizeDeferredTrackHydration(index);
            });
    };

    const scheduleTrackHydration = (index: number, delayMs: number): void => {
        clearPendingTrackHydration();
        const hydrationToken = pendingTrackHydrationToken;
        pendingTrackHydrationHandle = window.setTimeout(() => {
            pendingTrackHydrationHandle = undefined;
            if (hydrationToken !== pendingTrackHydrationToken) {
                return;
            }

            runDeferredTrackHydration(index);
        }, delayMs);
    };

    const shouldSchedulePostPlayHydration = (): boolean => {
        const track = context.tracks[context.currentTrackIndex];
        if (!track) {
            return false;
        }

        if (!track.tagsResolved) {
            return true;
        }

        return context.currentSettings.preferMusicBrainzMetadata && !track.mbMetadataResolved;
    };

    const applyOptimisticPlayingState = (playing: boolean): void => {
        if (!context.playbackStateService.setPlaying(playing)) {
            return;
        }

        context.updatePlayButton();
    };

    const logTransportMarker = (name: string): void => {
        if (!devPerfLoggingEnabled) {
            return;
        }

        const message = formatPerfLogMessage(`transport ${name}`);
        console.warn(message);
    };

    const logTransportStep = (name: string, elapsedMs: number, thresholdMs = 0, rateLimited = false): void => {
        if (!devPerfLoggingEnabled || elapsedMs < thresholdMs) {
            return;
        }

        if (rateLimited) {
            const nowMs = Date.now();
            if (nowMs - lastTransportPerfLogAtMs < 500) {
                return;
            }

            lastTransportPerfLogAtMs = nowMs;
        }

        const message = formatPerfLogMessage(`transport ${name} ${elapsedMs.toFixed(1)}ms`);
        console.warn(message);
    };

    const refreshAvailableAudioOutputDevices = async (): Promise<AudioOutputDevice[]> => {
        const outputDevices = await traceBridgeCall('transport', 'AudioListOutputDevices', async () => (
            await AudioListOutputDevices() as AudioOutputDevice[]
        ), {
            sink: bridgeTraceSink,
            summarizeResult: summarizeAudioOutputDevicesForBridge,
        });
        context.availableAudioOutputDevices = Array.isArray(outputDevices) ? outputDevices : [];
        return context.availableAudioOutputDevices;
    };

    const initializeAppVersion = async (): Promise<void> => {
        try {
            const version = (await GetAppVersion()).trim();
            context.aboutVersion.textContent = `${version || 'dev'}`;
        } catch (error) {
            console.error(error);
            context.aboutVersion.textContent = 'dev';
        }
    };

    const resolveCoverForTrack = async (track: Track): Promise<string | undefined> => await context.coverArtService.resolveForTrack(track);

    const loadTrack = async (
        index: number,
        allowMissingTrackRecovery = true,
        replayGainSequenceOverrideIndexes?: number[],
        manualTrackSelection = false,
    ): Promise<void> => {
        if (index < 0 || index >= context.tracks.length) {
            return;
        }

        context.gaplessQueueRequestVersion += 1;
        context.queuedGaplessTrackPath = '';
        clearPendingTrackHydration();
        const sequenceOverride = manualTrackSelection ? context.playlistController().getSequenceOverride() : null;
        if (manualTrackSelection && context.playbackSequencingService.getPlaybackOrderMode() === 'shuffle-library') {
            if (!sequenceOverride) {
                context.playlistController().activatePlaybackQueueSource();
            }

            context.resetShuffleHistory();
        }

        context.currentTrackIndex = index;
        context.playlistController().scheduleRender();
        context.setCoverFlipped(false);
        const track = context.tracks[context.currentTrackIndex];
        context.scrobbleService.startTrackSession(track.path);

        if (context.currentSettings.preferMusicBrainzMetadata) {
            track.mbMetadataResolved = false;
        }

        if (!context.libraryController().isSidebarOpen()) {
            context.libraryController().setSidebarAutoFolderPath(track.folderPath);
        }

        context.logPlaybackDebug(`LoadTrack request index=${index} path="${track.path}" recovery=${allowMissingTrackRecovery}`);

        try {
            const replayGainReleaseTrackPaths = context.collectReplayGainReleaseTrackPathsForIndex(index, replayGainSequenceOverrideIndexes);
            const methodName = replayGainReleaseTrackPaths.length > 1
                ? 'AudioLoadTrackWithReplayGainContext'
                : 'AudioLoadTrack';
            const nextState = await traceBridgeCall('transport', methodName, async () => (
                replayGainReleaseTrackPaths.length > 1
                    ? await runInteractiveBridgeCall(async () => await AudioLoadTrackWithReplayGainContext(track.path, replayGainReleaseTrackPaths) as AudioPlaybackState)
                    : await runInteractiveBridgeCall(async () => await AudioLoadTrack(track.path) as AudioPlaybackState)
            ), {
                sink: bridgeTraceSink,
                details: {
                    index,
                    manualTrackSelection,
                    path: track.path,
                    recovery: allowMissingTrackRecovery,
                    replayGainReleasePaths: replayGainReleaseTrackPaths.length,
                },
                summarizeResult: summarizeAudioPlaybackStateForBridge,
            });
            context.setActiveReplayGainReleaseTrackPaths(replayGainReleaseTrackPaths);
            context.logPlaybackDebug(`LoadTrack success ${formatPlaybackStateForLog(nextState)}`);
            context.applyPlaybackState(nextState);
        } catch (error) {
            context.logPlaybackDebug(`LoadTrack failed path="${track.path}" error=${describeErrorForLog(error)}`);
            if (allowMissingTrackRecovery && isMissingTrackLoadError(error) && context.hasConfiguredLibraryFolders()) {
                const failedTrackPath = track.path.toLowerCase();
                const failedRelativePath = track.relativePath.toLowerCase();
                const failedName = track.name.toLowerCase();

                context.beginLibraryLoadTracking();
                context.libraryController().setLibraryLoading(true);
                context.libraryController().setLibraryLoadingEtaSeconds(null);
                context.libraryController().setLibraryLoadingStatusLabel('');
                try {
                    context.libraryController().setLibraryPathMessage('Track missing. Rescanning library…');
                    const scanResult = await traceBridgeCall('library', 'ScanConfiguredLibraryFolders', async () => (
                        await ScanConfiguredLibraryFolders() as LibraryScanResult
                    ), {
                        sink: bridgeTraceSink,
                        details: {
                            failedName,
                            failedRelativePath,
                            failedTrackPath,
                            reason: 'missing-track-recovery',
                        },
                        summarizeResult: summarizeLibraryScanResultForBridge,
                    });
                    context.markLibraryScanResolved();
                    if (context.libraryClientFinalizeEstimateMs > 0) {
                        context.libraryController().setLibraryLoadingEtaSeconds(Math.max(1, Math.ceil(context.libraryClientFinalizeEstimateMs / 1000)));
                    }
                    await context.loadLibraryScan(scanResult, { autoSelectStartingTrack: false });

                    let recoveredIndex = context.tracks.findIndex((candidate: Track) => candidate.path.toLowerCase() === failedTrackPath);
                    if (recoveredIndex < 0) {
                        recoveredIndex = context.tracks.findIndex((candidate: Track) => candidate.relativePath.toLowerCase() === failedRelativePath);
                    }
                    if (recoveredIndex < 0) {
                        recoveredIndex = context.tracks.findIndex((candidate: Track) => candidate.name.toLowerCase() === failedName);
                    }

                    if (recoveredIndex >= 0) {
                        await loadTrack(recoveredIndex, false, replayGainSequenceOverrideIndexes, manualTrackSelection);
                        return;
                    }
                } catch (rescanError) {
                    console.error(rescanError);
                } finally {
                    context.finishLibraryLoadTracking();
                    context.libraryController().setLibraryLoading(false);
                }
            }

            context.handleAudioError(error);
            return;
        }

        context.refreshNowPlayingLabel();
        updateMediaSessionMetadata();
        scheduleTrackHydration(index, postLoadTrackHydrationDelayMs);
    };

    const playCurrentTrack = async (): Promise<void> => {
        if (context.currentTrackIndex === -1 && context.tracks.length > 0) {
            await loadTrack(0);
        }

        if (context.currentTrackIndex === -1 || !context.playbackStateService.isBackendReady()) {
            context.logPlaybackDebug(`Play skipped currentTrackIndex=${context.currentTrackIndex} backendReady=${context.playbackStateService.isBackendReady()}`);
            return;
        }

        if (await context.shouldSkipLoadedTrack()) {
            context.logPlaybackDebug(`Play redirected due to silent-track heuristic currentIndex=${context.currentTrackIndex}`);
            goToTrack(1);
            return;
        }

        clearPendingTrackHydration();
        context.playbackMutationVersion += 1;
        context.logPlaybackDebug(`Play request index=${context.currentTrackIndex} path="${context.tracks[context.currentTrackIndex]?.path || ''}"`);
        logTransportMarker(`AudioPlay intent index=${context.currentTrackIndex}`);
        const previousPlaying = context.playbackStateService.getPlaybackState().playing;
        applyOptimisticPlayingState(true);
        try {
            logTransportMarker('AudioPlay dispatch');
            const bridgeStartedAtMs = performance.now();
            const nextState = await traceBridgeCall('transport', 'AudioPlay', async () => (
                await runInteractiveBridgeCall(async () => await AudioPlay() as AudioPlaybackState)
            ), {
                sink: bridgeTraceSink,
                details: {
                    currentTrackIndex: context.currentTrackIndex,
                    path: context.tracks[context.currentTrackIndex]?.path || '',
                },
                summarizeResult: summarizeAudioPlaybackStateForBridge,
            });
            logTransportStep('AudioPlay bridge', performance.now() - bridgeStartedAtMs);
            context.logPlaybackDebug(`Play success ${formatPlaybackStateForLog(nextState)}`);
            const applyStartedAtMs = performance.now();
            context.applyPlaybackState(nextState);
            logTransportStep('AudioPlay applyPlaybackState', performance.now() - applyStartedAtMs);
            if (shouldSchedulePostPlayHydration()) {
                scheduleTrackHydration(context.currentTrackIndex, postPlayTrackHydrationDelayMs);
            }
        } catch (error) {
            applyOptimisticPlayingState(previousPlaying);
            context.handleAudioError(error);
        }
    };

    const pauseCurrentTrack = async (): Promise<void> => {
        if (!context.playbackStateService.isBackendReady()) {
            context.logPlaybackDebug('Pause skipped because backend is not ready');
            return;
        }

        context.playbackMutationVersion += 1;
        context.logPlaybackDebug(`Pause request index=${context.currentTrackIndex} path="${context.tracks[context.currentTrackIndex]?.path || ''}"`);
        logTransportMarker(`AudioPause intent index=${context.currentTrackIndex}`);
        const previousPlaying = context.playbackStateService.getPlaybackState().playing;
        applyOptimisticPlayingState(false);
        try {
            logTransportMarker('AudioPause dispatch');
            const bridgeStartedAtMs = performance.now();
            const nextState = await traceBridgeCall('transport', 'AudioPause', async () => (
                await runInteractiveBridgeCall(async () => await AudioPause() as AudioPlaybackState)
            ), {
                sink: bridgeTraceSink,
                details: {
                    currentTrackIndex: context.currentTrackIndex,
                    path: context.tracks[context.currentTrackIndex]?.path || '',
                },
                summarizeResult: summarizeAudioPlaybackStateForBridge,
            });
            logTransportStep('AudioPause bridge', performance.now() - bridgeStartedAtMs);
            context.logPlaybackDebug(`Pause success ${formatPlaybackStateForLog(nextState)}`);
            const applyStartedAtMs = performance.now();
            context.applyPlaybackState(nextState);
            logTransportStep('AudioPause applyPlaybackState', performance.now() - applyStartedAtMs);
        } catch (error) {
            applyOptimisticPlayingState(previousPlaying);
            context.handleAudioError(error);
        }
    };

    const toggleCurrentTrack = async (): Promise<void> => {
        if (!context.playbackStateService.isBackendReady() || context.playPauseToggleInFlight) {
            context.logPlaybackDebug(`Toggle skipped backendReady=${context.playbackStateService.isBackendReady()} inFlight=${context.playPauseToggleInFlight}`);
            return;
        }

        context.playPauseToggleInFlight = true;
        try {
            const playbackState = context.playbackStateService.getPlaybackState();
            context.logPlaybackDebug(`Toggle request ${formatPlaybackStateForLog(playbackState)}`);
            logTransportMarker(`toggle playPause loaded=${playbackState.loaded} playing=${playbackState.playing}`);
            if (playbackState.playing) {
                await pauseCurrentTrack();
                return;
            }

            await playCurrentTrack();
        } finally {
            context.playPauseToggleInFlight = false;
        }
    };

    const goToTrackInternal = async (direction: -1 | 1): Promise<void> => {
        if (context.tracks.length === 0) {
            context.logPlaybackDebug(`GoToTrack skipped direction=${direction} because there are no tracks`);
            return;
        }

        context.logPlaybackDebug(`GoToTrack start direction=${direction} currentIndex=${context.currentTrackIndex}`);
        const playbackState = context.playbackStateService.getPlaybackState();
        if (playbackState.loaded && playbackState.playing) {
            await pauseCurrentTrack();
        }

        for (let attempt = 0; attempt < context.tracks.length; attempt += 1) {
            const replayGainSequenceOverrideIndexes = context.playlistController().getSequenceOverride?.()?.indexes;
            const nextIndex = context.nextTrackIndexForDirection(direction);
            if (nextIndex === undefined) {
                context.logPlaybackDebug(`GoToTrack direction=${direction} found no next index on attempt=${attempt}`);
                return;
            }

            context.logPlaybackDebug(`GoToTrack candidate direction=${direction} nextIndex=${nextIndex} path="${context.tracks[nextIndex]?.path || ''}" attempt=${attempt}`);
            await loadTrack(nextIndex, true, replayGainSequenceOverrideIndexes);
            if (!(await context.shouldSkipLoadedTrack())) {
                await playCurrentTrack();
                return;
            }
        }

        await playCurrentTrack();
    };

    const goToTrack = (direction: -1 | 1): void => {
        context.trackNavigationChain = context.trackNavigationChain
            .then(() => goToTrackInternal(direction))
            .catch((error: unknown) => {
                console.error(error);
            });
    };

    const stopCurrentTrack = async (): Promise<void> => {
        if (!context.playbackStateService.isBackendReady()) {
            return;
        }

        clearPendingTrackHydration();
        context.gaplessQueueRequestVersion += 1;
        context.queuedGaplessTrackPath = '';
        try {
            const nextState = await traceBridgeCall('transport', 'AudioStop', async () => (
                await runInteractiveBridgeCall(async () => await AudioStop() as AudioPlaybackState)
            ), {
                sink: bridgeTraceSink,
                details: {
                    currentTrackIndex: context.currentTrackIndex,
                    path: context.tracks[context.currentTrackIndex]?.path || '',
                },
                summarizeResult: summarizeAudioPlaybackStateForBridge,
            });
            context.applyPlaybackState(nextState);
        } catch (error) {
            context.handleAudioError(error);
        }
    };

    const mediaSessionController = createMediaSessionController({
        enableBrowserMediaSession: !context.isWindowsRuntime,
        getPlaybackState: () => context.playbackStateService.getPlaybackState(),
        getCurrentTrack: () => (context.currentTrackIndex >= 0 && context.currentTrackIndex < context.tracks.length ? context.tracks[context.currentTrackIndex] : undefined),
        getCachedArtwork: (track: Track) => context.coverArtService.getCachedMediaArtwork(track),
        getCoverArtPreview: () => ({
            visible: context.coverArt.classList.contains('is-visible'),
            src: context.coverArt.src,
        }),
        playCurrentTrack,
        pauseCurrentTrack,
        toggleCurrentTrack,
        goToTrack,
        stopCurrentTrack,
        seekToTime: async (targetSeconds: number): Promise<void> => {
            if (!context.playbackStateService.isBackendReady()) {
                return;
            }

            try {
                const nextState = await traceBridgeCall('transport', 'AudioSeek', async () => (
                    await runInteractiveBridgeCall(async () => await AudioSeek(targetSeconds) as AudioPlaybackState)
                ), {
                    sink: bridgeTraceSink,
                    details: { targetSeconds: Number(targetSeconds.toFixed(3)) },
                    summarizeResult: summarizeAudioPlaybackStateForBridge,
                });
                context.applyPlaybackState(nextState);
            } catch (error) {
                context.handleAudioError(error);
            }
        },
    });

    const updateMediaSessionMetadata = (): void => {
        mediaSessionController.updateMetadata();
    };

    const updateMediaSessionPlaybackState = (): void => {
        mediaSessionController.updatePlaybackState();
    };

    const updateMediaSessionPositionState = (): void => {
        mediaSessionController.updatePositionState();
    };

    const dispatchExternalPlaybackAction = (action: ExternalPlaybackAction): void => {
        mediaSessionController.dispatchExternalPlaybackAction(action);
    };

    const initializeMediaSessionIntegration = (): void => {
        mediaSessionController.initialize();
    };

    const unlockMediaSessionAnchorFromUserGesture = (): void => {
        mediaSessionController.unlockFromUserGesture();
    };

    const handleFocusedHardwareMediaKey = (event: KeyboardEvent): boolean => mediaSessionController.handleHardwareMediaKey(event);

    let hideToTrayOnMinimizeInFlight = false;
    let hideToTrayRetryTimer: number | undefined;
    const hideToTrayRetryDelayMs = 60;
    const hideToTrayMaxRetries = 5;

    const clearHideToTrayRetryTimer = (): void => {
        if (hideToTrayRetryTimer === undefined) {
            return;
        }

        window.clearTimeout(hideToTrayRetryTimer);
        hideToTrayRetryTimer = undefined;
    };

    const hideToTrayWhenMinimized = async (remainingRetries = hideToTrayMaxRetries): Promise<void> => {
        if (!context.currentSettings.minimizeToTrayOnClose || hideToTrayOnMinimizeInFlight) {
            clearHideToTrayRetryTimer();
            return;
        }

        hideToTrayOnMinimizeInFlight = true;
        try {
            const isMinimized = await WindowIsMinimised();
            if (!isMinimized) {
                if (remainingRetries > 0) {
                    clearHideToTrayRetryTimer();
                    hideToTrayRetryTimer = window.setTimeout(() => {
                        hideToTrayRetryTimer = undefined;
                        void hideToTrayWhenMinimized(remainingRetries - 1);
                    }, hideToTrayRetryDelayMs);
                }
                return;
            }

            clearHideToTrayRetryTimer();
            WindowHide();
        } catch (error) {
            console.debug(error);
        } finally {
            hideToTrayOnMinimizeInFlight = false;
        }
    };

    const handleFocusedKeyboardShortcut = (event: KeyboardEvent): boolean => {
        if (event.repeat || shouldSuppressFocusedShortcut(event)) {
            return false;
        }

        const eventBinding = formatShortcutBindingFromKeyboardEvent(event);
        if (!eventBinding) {
            return false;
        }

        const shortcuts = context.currentSettings.keyboardShortcuts;
        if (eventBinding === shortcuts.focusLibraryFilter) {
            if (!context.libraryController().isSidebarOpen()) {
                context.libraryController().setSidebarOpen(true);
            }

            context.sidebarController.showLibrary();
            window.requestAnimationFrame(() => {
                context.librarySearch.focus();
            });
            return true;
        }

        if (eventBinding === shortcuts.openSettings) {
            context.settingsController().open();
            return true;
        }

        if (eventBinding === shortcuts.playPauseToggle) {
            dispatchExternalPlaybackAction('playpause');
            return true;
        }

        if (eventBinding === shortcuts.nextTrack) {
            dispatchExternalPlaybackAction('next');
            return true;
        }

        if (eventBinding === shortcuts.previousTrack) {
            dispatchExternalPlaybackAction('previous');
            return true;
        }

        if (eventBinding === shortcuts.stopPlayback) {
            dispatchExternalPlaybackAction('stop');
            return true;
        }

        return false;
    };

    const focusedShortcutBindingsUseCode = (code: string): boolean => {
        const shortcuts = context.currentSettings.keyboardShortcuts;
        return shortcutBindingUsesCode(shortcuts.playPauseToggle, code)
            || shortcutBindingUsesCode(shortcuts.nextTrack, code)
            || shortcutBindingUsesCode(shortcuts.previousTrack, code)
            || shortcutBindingUsesCode(shortcuts.stopPlayback, code)
            || shortcutBindingUsesCode(shortcuts.focusLibraryFilter, code)
            || shortcutBindingUsesCode(shortcuts.openSettings, code);
    };

    return {
        dispatchExternalPlaybackAction,
        focusedShortcutBindingsUseCode,
        goToTrack,
        handleFocusedHardwareMediaKey,
        handleFocusedKeyboardShortcut,
        hideToTrayWhenMinimized,
        initializeAppVersion,
        initializeMediaSessionIntegration,
        loadTrack,
        mediaSessionController,
        pauseCurrentTrack,
        playCurrentTrack,
        refreshAvailableAudioOutputDevices,
        resolveCoverForTrack,
        stopCurrentTrack,
        toggleCurrentTrack,
        unlockMediaSessionAnchorFromUserGesture,
        updateMediaSessionMetadata,
        updateMediaSessionPlaybackState,
        updateMediaSessionPositionState,
    };
};
