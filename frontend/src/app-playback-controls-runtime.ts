import {
    AudioListOutputDevices,
    AudioLoadTrack,
    AudioLoadTrackWithReplayGainContext,
    AudioPause,
    AudioPlay,
    AudioSeek,
    AudioStop,
    GetAppVersion,
    ScanConfiguredLibraryFolders,
} from '../wailsjs/go/main/App';
import { WindowHide, WindowIsMinimised } from '../wailsjs/runtime/runtime';
import type { AppPlaybackControlsRuntimeContext } from './app-runtime-setup';
import { createMediaSessionController, type ExternalPlaybackAction } from './controllers/media-session-controller';
import type { AudioOutputDevice, AudioPlaybackState, LibraryScanResult, Track } from './types/app-types';
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

export const createAppPlaybackControlsRuntime = (context: AppPlaybackControlsRuntimeContext) => {
    const refreshAvailableAudioOutputDevices = async (): Promise<AudioOutputDevice[]> => {
        const outputDevices = await AudioListOutputDevices() as AudioOutputDevice[];
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
        if (manualTrackSelection && context.playbackSequencingService.getPlaybackOrderMode() === 'shuffle-library') {
            context.playlistController().activatePlaybackQueueSource();
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
            const nextState = replayGainReleaseTrackPaths.length > 1
                ? await AudioLoadTrackWithReplayGainContext(track.path, replayGainReleaseTrackPaths) as AudioPlaybackState
                : await AudioLoadTrack(track.path) as AudioPlaybackState;
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
                    const scanResult = await ScanConfiguredLibraryFolders() as LibraryScanResult;
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
        context.tagRequestVersion += 1;
        void context.hydrateCurrentTrackTag(index, context.tagRequestVersion);

        await context.applyCoverArtForTrack(index);
        updateMediaSessionMetadata();
        context.libraryController().renderFolder('none');

        context.artistInfoRequestVersion += 1;
        void context.hydrateCurrentArtistInfo(index);
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

        context.playbackMutationVersion += 1;
        context.logPlaybackDebug(`Play request index=${context.currentTrackIndex} path="${context.tracks[context.currentTrackIndex]?.path || ''}"`);
        try {
            const nextState = await AudioPlay() as AudioPlaybackState;
            context.logPlaybackDebug(`Play success ${formatPlaybackStateForLog(nextState)}`);
            context.applyPlaybackState(nextState);
        } catch (error) {
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
        try {
            const nextState = await AudioPause() as AudioPlaybackState;
            context.logPlaybackDebug(`Pause success ${formatPlaybackStateForLog(nextState)}`);
            context.applyPlaybackState(nextState);
        } catch (error) {
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
            const nextIndex = context.nextTrackIndexForDirection(direction);
            if (nextIndex === undefined) {
                context.logPlaybackDebug(`GoToTrack direction=${direction} found no next index on attempt=${attempt}`);
                return;
            }

            context.logPlaybackDebug(`GoToTrack candidate direction=${direction} nextIndex=${nextIndex} path="${context.tracks[nextIndex]?.path || ''}" attempt=${attempt}`);
            await loadTrack(nextIndex);
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

        context.gaplessQueueRequestVersion += 1;
        context.queuedGaplessTrackPath = '';
        try {
            const nextState = await AudioStop() as AudioPlaybackState;
            context.applyPlaybackState(nextState);
        } catch (error) {
            context.handleAudioError(error);
        }
    };

    const mediaSessionController = createMediaSessionController({
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
                const nextState = await AudioSeek(targetSeconds) as AudioPlaybackState;
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
