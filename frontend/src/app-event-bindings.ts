import { BrowserOpenURL, EventsOn, OnFileDrop } from '../wailsjs/runtime/runtime';
import type { ListenBrainzFeedbackScore } from './controllers/listenbrainz-controller';
import type { AppEventBindingsContext } from './app-bootstrap-setup';
import { openMbLink } from './musicbrainz';
import type { AudioPlaybackState, LibraryScanProgress, LibraryScanResult, MusicBrainzTagWorkerProgress, PlaybackOrderMode, Track } from './types/app-types';
import { openMusicBrainzLibrarySearch } from './utils/musicbrainz-entity-helpers';
import {
    logBridgeEvent,
    summarizeLibraryScanProgressForBridge,
    summarizeLibraryScanResultForBridge,
} from './utils/bridge-trace';
import { hasExternalFileDragPayload, isSupportedAudioFilePath } from './utils/main-helpers';
import { formatPerfLogMessage } from './utils/perf-log';

type VolumeControlBindingsContext = {
    document: Document;
    volume: HTMLInputElement;
    volumeBtn: HTMLButtonElement;
    audioSetVolume: (volumeValue: number) => Promise<AudioPlaybackState>;
    applyPlaybackState: (state: AudioPlaybackState) => void;
    handleAudioError: (error: unknown) => void;
};

type ClickStepMetric = {
    label: string;
    elapsedMs: number;
};

type TrackNavigationBindingsContext = {
    back: HTMLElement;
    forward: HTMLElement;
    unlockMediaSessionAnchorFromUserGesture: () => void;
    goToTrack: (direction: -1 | 1) => void;
    logTransportGesture?: (name: string, target: HTMLElement) => void;
};

type ExternalFileDropContext = Pick<
    AppEventBindingsContext,
    | 'ensureTrackIndexForPath'
    | 'handleDroppedFolderPath'
    | 'playDroppedTrackPath'
    | 'playlistControllerHandleExternalTrackDrop'
    | 'playlistControllerLoadPlaylistByPath'
>;

type SidebarShellBindingsContext = Pick<
    AppEventBindingsContext,
    | 'libraryController'
    | 'sidebarController'
    | 'sidebarToggle'
    | 'sidebarNavLibrary'
    | 'sidebarNavOverview'
    | 'sidebarNavSocial'
    | 'showOverviewPage'
>;

type OverviewAlbumActionContext = Pick<
    AppEventBindingsContext,
    | 'tracks'
    | 'openSidebarQueueMenu'
>;

type TaskbarCoverToggleContext = Pick<
    AppEventBindingsContext,
    | 'app'
    | 'libraryController'
    | 'sidebarController'
    | 'showOverviewPage'
    | 'showNowPlayingPage'
    | 'refreshCurrentTrackMetadata'
>;

type CoverFrameInteractionContext = Pick<
    AppEventBindingsContext,
    | 'app'
    | 'coverArt'
    | 'playerLane'
>;

const clampUnitVolume = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(1, Math.max(0, value));
};

export const setupVolumeControlBindings = (context: VolumeControlBindingsContext): HTMLElement => {
    const {
        document,
        volume,
        volumeBtn,
        audioSetVolume,
        applyPlaybackState,
        handleAudioError,
    } = context;

    const volumeRow = volumeBtn.closest('.volume-wrap') as HTMLElement;
    const volumeHoverTarget = volumeBtn.querySelector('.control-icon') as HTMLElement | null;
    const HIDE_DELAY_MS = 500;
    const WHEEL_STEP = 0.05;
    let closeTimeout: ReturnType<typeof setTimeout> | undefined;
    let lastNonZeroVolume = clampUnitVolume(Number(volume.value));
    if (lastNonZeroVolume <= 0) {
        lastNonZeroVolume = 0.8;
    }

    const clearCloseTimeout = (): void => {
        if (closeTimeout === undefined) {
            return;
        }

        clearTimeout(closeTimeout);
        closeTimeout = undefined;
    };

    const showVolumePopout = (): void => {
        clearCloseTimeout();
        volumeRow.classList.add('open');
    };

    const isVolumePopoutOpen = (): boolean => volumeRow.classList.contains('open');

    const queueCloseVolumePopout = (): void => {
        clearCloseTimeout();
        closeTimeout = setTimeout(() => {
            volumeRow.classList.remove('open');
            closeTimeout = undefined;
        }, HIDE_DELAY_MS);
    };

    const setVolume = (value: number): void => {
        const normalizedValue = clampUnitVolume(value);
        volume.value = String(normalizedValue);
        const muted = normalizedValue <= 0;
        volumeBtn.classList.toggle('is-muted', muted);
        volumeBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
        if (normalizedValue > 0) {
            lastNonZeroVolume = normalizedValue;
        }

        void (async () => {
            try {
                const nextState = await audioSetVolume(normalizedValue);
                applyPlaybackState(nextState);
            } catch (error) {
                handleAudioError(error);
            }
        })();
    };

    const syncVolumeButtonState = (): void => {
        const normalizedValue = clampUnitVolume(Number(volume.value));
        const muted = normalizedValue <= 0;
        volumeBtn.classList.toggle('is-muted', muted);
        volumeBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    };

    volume.addEventListener('input', () => {
        setVolume(Number(volume.value));
    });

    syncVolumeButtonState();

    volumeBtn.addEventListener('click', () => {
        const currentVolume = clampUnitVolume(Number(volume.value));
        if (currentVolume > 0) {
            lastNonZeroVolume = currentVolume;
        }

        setVolume(currentVolume > 0 ? 0 : lastNonZeroVolume);
    });

    volumeBtn.addEventListener('wheel', (event: WheelEvent) => {
        event.preventDefault();
        const direction = event.deltaY < 0 ? 1 : -1;
        const nextVolume = clampUnitVolume(Number(volume.value) + (direction * WHEEL_STEP));
        setVolume(nextVolume);
    }, { passive: false });

    (volumeHoverTarget ?? volumeBtn).addEventListener('pointerenter', () => {
        showVolumePopout();
    });

    volumeRow.addEventListener('pointerenter', () => {
        if (!isVolumePopoutOpen()) {
            return;
        }

        showVolumePopout();
    });

    volumeRow.addEventListener('pointerleave', () => {
        queueCloseVolumePopout();
    });

    volumeRow.addEventListener('focusin', () => {
        showVolumePopout();
    });

    volumeRow.addEventListener('focusout', () => {
        const activeElement = document.activeElement;
        if (activeElement instanceof Node && volumeRow.contains(activeElement)) {
            return;
        }

        queueCloseVolumePopout();
    });

    return volumeRow;
};

export const handleExternalFileDrop = async (
    context: ExternalFileDropContext,
    clientX: number,
    clientY: number,
    paths: string[],
): Promise<void> => {
    const droppedPaths = (paths || []).map((path) => path.trim()).filter((path) => path !== '');
    if (droppedPaths.length === 0) {
        return;
    }

    const droppedAudioPaths = droppedPaths.filter((path) => isSupportedAudioFilePath(path));
    if (droppedAudioPaths.length > 0) {
        const droppedTrackIndexes = droppedAudioPaths
            .map((path) => context.ensureTrackIndexForPath(path))
            .filter((trackIndex) => Number.isInteger(trackIndex) && trackIndex >= 0);

        if (droppedTrackIndexes.length > 0 && await context.playlistControllerHandleExternalTrackDrop(clientX, clientY, droppedTrackIndexes)) {
            return;
        }
    }

    const droppedPlaylistPath = droppedPaths.find((path) => /\.(m3u8?|M3U8?)$/.test(path));
    if (droppedPlaylistPath) {
        await context.playlistControllerLoadPlaylistByPath(droppedPlaylistPath);
        return;
    }

    const droppedAudioPath = droppedAudioPaths[0];
    if (droppedAudioPath) {
        await context.playDroppedTrackPath(droppedAudioPath);
        return;
    }

    const droppedFolderPath = droppedPaths.find((path) => !/\.(m3u8?|M3U8?)$/.test(path) && !isSupportedAudioFilePath(path));
    if (!droppedFolderPath) {
        return;
    }

    await context.handleDroppedFolderPath(clientX, clientY, droppedFolderPath);
};

export const setupTrackNavigationBindings = (context: TrackNavigationBindingsContext): void => {
    const {
        back,
        forward,
        unlockMediaSessionAnchorFromUserGesture,
        goToTrack,
        logTransportGesture = () => undefined,
    } = context;

    back.addEventListener('pointerdown', () => {
        logTransportGesture('back pointerdown', back);
        unlockMediaSessionAnchorFromUserGesture();
    }, { passive: true });

    forward.addEventListener('pointerdown', () => {
        logTransportGesture('forward pointerdown', forward);
        unlockMediaSessionAnchorFromUserGesture();
    }, { passive: true });

    back.addEventListener('click', () => {
        logTransportGesture('back click', back);
        goToTrack(-1);
    });

    forward.addEventListener('click', () => {
        logTransportGesture('forward click', forward);
        goToTrack(1);
    });
};

export const triggerSidebarOpenInBrowserAction = (
    openSidebarQueueItemInFileBrowser: () => Promise<void>,
    closeSidebarQueueMenu: () => void,
): void => {
    void openSidebarQueueItemInFileBrowser();
    closeSidebarQueueMenu();
};

export const triggerTrackMetaArtistFilterAction = (
    query: string,
    openLibrarySearch: (query: string, options?: { expandFilteredFolders?: boolean }) => void,
    closeTrackMetaMenu: () => void,
): void => {
    closeTrackMetaMenu();
    openMusicBrainzLibrarySearch(query, openLibrarySearch);
};

export const setupSidebarShellBindings = (context: SidebarShellBindingsContext): void => {
    const {
        libraryController,
        sidebarController,
        sidebarToggle,
        sidebarNavLibrary,
        sidebarNavOverview,
        sidebarNavSocial,
        showOverviewPage,
    } = context;

    const openSidebarLibrary = (): void => {
        libraryController.setSidebarOpen(true);
        sidebarController.showLibrary();
    };

    const openSidebarSocial = (): void => {
        libraryController.setSidebarOpen(true);
        sidebarController.showSocial();
    };

    sidebarToggle.addEventListener('click', (event) => {
        if (!libraryController.isSidebarOpen() || sidebarController.getActiveView() === 'nav') {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        sidebarController.showNavigation();
    }, { capture: true });

    sidebarNavOverview.addEventListener('click', () => {
        showOverviewPage();
        sidebarController.showNavigation();
        libraryController.setSidebarOpen(false);
    });

    sidebarNavLibrary.addEventListener('click', () => {
        openSidebarLibrary();
    });

    sidebarNavSocial.addEventListener('click', () => {
        openSidebarSocial();
    });
};

export const resolveOverviewAlbumTrackIndex = (container: HTMLElement, eventTarget: EventTarget | null): number | null => {
    const targetElement = eventTarget instanceof Element
        ? eventTarget
        : eventTarget instanceof Node
            ? eventTarget.parentElement
            : null;
    if (!targetElement) {
        return null;
    }

    const trigger = targetElement.closest('[data-overview-track-index], [data-overview-grid-track-index]') as HTMLElement | null;
    if (!trigger || !container.contains(trigger)) {
        return null;
    }

    const trackIndex = Number(trigger.dataset.overviewTrackIndex || trigger.dataset.overviewGridTrackIndex || '');
    if (!Number.isInteger(trackIndex) || trackIndex < 0) {
        return null;
    }

    return trackIndex;
};

const trackPathForOverviewAlbum = (tracks: Track[], trackIndex: number): string => {
    const track = tracks[trackIndex];
    return typeof track?.path === 'string' ? track.path : '';
};

export const openOverviewAlbumContextMenu = (
    context: OverviewAlbumActionContext,
    container: HTMLElement,
    event: MouseEvent,
): void => {
    const trackIndex = resolveOverviewAlbumTrackIndex(container, event.target);
    if (trackIndex === null) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    context.openSidebarQueueMenu(
        event.clientX,
        event.clientY,
        [trackIndex],
        trackIndex,
        true,
        trackPathForOverviewAlbum(context.tracks, trackIndex),
    );
};

export const toggleTaskbarCoverView = (context: TaskbarCoverToggleContext): void => {
    if (context.app.classList.contains('showing-overview')) {
        context.libraryController.setSidebarOpen(false);
        context.showNowPlayingPage();
        void context.refreshCurrentTrackMetadata();
        return;
    }

    context.showOverviewPage();
    context.sidebarController.showNavigation();
};

export const canInteractWithCoverFrame = (context: CoverFrameInteractionContext): boolean => {
    if (context.app.classList.contains('showing-overview') || context.playerLane.hidden) {
        return false;
    }

    return context.coverArt.classList.contains('is-visible')
        && (context.coverArt.getAttribute('src') || '').trim() !== '';
};

export const setupAppEventBindings = (context: AppEventBindingsContext): void => {
    const {
        app,
        window,
        document,
        tracks,
        coverArt,
        coverFrame,
        coverFront,
        trackTechnical,
        trackTechnicalAlt,
        libraryAbout,
        sidebarQueueAddNext,
        sidebarQueueAddToPlaylist,
        sidebarQueuePlay,
        sidebarQueueLove,
        sidebarQueueHate,
        sidebarQueueEnd,
        sidebarQueueOpenInBrowser,
        sidebarQueueTreeToggleBtn,
        sidebarQueueSendToList,
        errorBackdrop,
        errorClose,
        errorOk,
        errorModal,
        queueConfirmBackdrop,
        queueConfirmCancel,
        queueConfirmProceed,
        textFileBackdrop,
        textFileClose,
        musicBrainzEntityBackdrop,
        musicBrainzEntityClose,
        shareBackdrop,
        shareClose,
        shareCommentInput,
        shareSave,
        shareCopy,
        technicalInfoBackdrop,
        technicalInfoClose,
        aboutBackdrop,
        aboutClose,
        aboutRepoLink,
        settingsElements,
        playlistModalElements,
        playlistTargetModalElements,
        imageModalElements,
        playPause,
        playOrderMenu,
        trackMetaParentFolderBtn,
        trackMetaBrowserFolderBtn,
        trackMetaCopyFilePathBtn,
        trackMetaCopyFolderPathBtn,
        trackMetaFilterArtistBtn,
        trackMetaOpenMbBtn,
        trackMetaSendToList,
        back,
        forward,
        shareBtn,
        seek,
        volume,
        volumeBtn,
        playlistTargetModalController,
        playlistController,
        settingsController,
        libraryController,
        shareController,
        imageModalController,
        sidebarController,
        librarySidebar,
        librarySearch,
        sidebarToggle,
        sidebarNavOverview,
        sidebarNavLibrary,
        sidebarNavSocial,
        playerCard,
        taskbarShowPlayer,
        taskbarShowOverview,
        sidebarQueueMenu,
        queueConfirmModal,
        listenBrainzFeedbackMenu,
        listenBrainzLoveBtn,
        trackMetaMenu,
        musicBrainzEntityModal,
        shareModal,
        technicalInfoModal,
        aboutModal,
        textFileModal,
        trackTitle,
        trackAlbum,
        trackArtist,
        trackTitleInline,
        trackReleaseAlbum,
        trackArtistHeader,
        playerLane,
        overviewLastPlayedList,
        overviewLastAddedList,
        overviewAlbumGrid,
        handleDroppedFolderPath,
        ensureTrackIndexForPath,
        playDroppedTrackPath,
        loadTrack,
        playCurrentTrack,
        openCoverImageModal,
        toggleCoverFlipFromSecondaryInput,
        toggleCoverFlipFromContextMenu,
        openTechnicalInfoModal,
        openAboutModal,
        captureSidebarQueueSelectionContext,
        openSidebarQueueMenu,
        closeSidebarQueueMenu,
        resolveSidebarQueueTrackIndexesForAction,
        addSidebarSelectionToPlaylist,
        playSidebarQueueSelection,
        submitSidebarQueueFeedback,
        sidebarQueueFeedbackTrackIndex,
        sidebarQueueSendToActionScope,
        sidebarQueueFileActionPath,
        sendToActionsForScope,
        logSendToFrontend,
        runCustomSendToAction,
        suppressTrackMetaClicks,
        closeErrorModal,
        closeQueueConfirmModal,
        closeTextFileModal,
        closeMusicBrainzEntityModal,
        closeTechnicalInfoModal,
        closeAboutModal,
        closePlayOrderMenu,
        closeTrackMetaMenu,
        closeListenBrainzFeedbackMenu,
        openLibrarySearch,
        showOverviewPage,
        showNowPlayingPage,
        openPlayOrderMenu,
        setPlaybackOrderMode,
        savePlaybackOrderSetting,
        openCurrentTrackFolderInSidebar,
        openCurrentTrackFolderInFileBrowser,
        openSidebarQueueItemInFileBrowser,
        copyCurrentTrackFilePath,
        copyCurrentTrackFolderPath,
        trackMetaMenuTarget,
        trackMetaMenuActionScope,
        trackMetaMenuActionPath,
        trackMetaArtistFilterQuery,
        goToTrack,
        toggleCurrentTrack,
        unlockMediaSessionAnchorFromUserGesture,
        updateLyricsPanelVisibility,
        hideToTrayWhenMinimized,
        handleFocusedHardwareMediaKey,
        handleFocusedKeyboardShortcut,
        focusedShortcutBindingsUseCode,
        setCtrlHeldState,
        refreshCurrentTrackMetadata,
        handleLibraryScanUpdatedEvent,
        updateLibraryLoadingEtaFromProgress,
        normalizeMusicBrainzTagWorkerProgress,
        setMusicBrainzTagWorkerProgress,
        dispatchExternalPlaybackAction,
        logFrontendMessage,
        playlistControllerHandleExternalTrackDrop,
        playlistControllerLoadPlaylistByPath,
        handleDocumentClickWithinSettings,
        playerCardResizeObserver,
        logRescan,
    } = context;
    const devPerfLoggingEnabled = import.meta.env.DEV && typeof (globalThis as { vi?: unknown }).vi === 'undefined';
    let lastSlowClickLogAtMs = 0;

    const describeEventTarget = (target: EventTarget | null): string => {
        if (!(target instanceof Element)) {
            return 'unknown';
        }

        const tagName = target.tagName.toLowerCase();
        const id = target.id ? `#${target.id}` : '';
        const className = typeof target.className === 'string'
            ? target.className.trim().split(/\s+/).filter((name) => name !== '').slice(0, 2).map((name) => `.${name}`).join('')
            : '';
        return `${tagName}${id}${className}`;
    };

    const formatSlowClickSteps = (steps: readonly ClickStepMetric[]): string => {
        const significantSteps = steps
            .filter((step) => step.elapsedMs >= 1)
            .sort((left, right) => right.elapsedMs - left.elapsedMs)
            .slice(0, 4);
        if (significantSteps.length === 0) {
            return '';
        }

        return ` steps=${significantSteps.map((step) => `${step.label}:${step.elapsedMs.toFixed(1)}ms`).join(',')}`;
    };

    const logSlowClick = (kind: 'handler' | 'frame', elapsedMs: number, target: EventTarget | null, steps: readonly ClickStepMetric[] = []): void => {
        if (!devPerfLoggingEnabled || elapsedMs < (kind === 'handler' ? 16 : 40)) {
            return;
        }

        const nowMs = Date.now();
        if (nowMs - lastSlowClickLogAtMs < 500) {
            return;
        }

        lastSlowClickLogAtMs = nowMs;
        const message = formatPerfLogMessage(`slow click ${kind} ${elapsedMs.toFixed(1)}ms target=${describeEventTarget(target)}${formatSlowClickSteps(steps)}`);
        console.warn(message);
        void logFrontendMessage(message).catch(() => undefined);
    };

    const logTransportGesture = (name: string, target: HTMLElement): void => {
        if (!devPerfLoggingEnabled) {
            return;
        }

        const state = (target.dataset.state || '').trim();
        const suffix = state !== '' ? ` state=${state}` : '';
        const message = formatPerfLogMessage(`transport ${name}${suffix}`);
        console.warn(message);
        void logFrontendMessage(message).catch(() => undefined);
    };

    const measureClickStep = <T>(steps: ClickStepMetric[], label: string, callback: () => T): T => {
        if (!devPerfLoggingEnabled) {
            return callback();
        }

        const startedAtMs = performance.now();
        try {
            return callback();
        } finally {
            steps.push({
                label,
                elapsedMs: performance.now() - startedAtMs,
            });
        }
    };

    const preventBrowserFileDropDefault = (event: DragEvent): void => {
        if (!hasExternalFileDragPayload(event.dataTransfer)) {
            return;
        }

        event.preventDefault();
        if (event.dataTransfer && event.type !== 'drop') {
            event.dataTransfer.dropEffect = 'copy';
        }
    };

    let librarySearchMouseDownActive = false;
    let suppressSidebarOutsideCloseOnce = false;

    window.addEventListener('dragenter', preventBrowserFileDropDefault, { capture: true, passive: false });
    window.addEventListener('dragover', preventBrowserFileDropDefault, { capture: true, passive: false });
    window.addEventListener('drop', preventBrowserFileDropDefault, { capture: true, passive: false });
    document.addEventListener('dragenter', preventBrowserFileDropDefault, { capture: true, passive: false });
    document.addEventListener('dragover', preventBrowserFileDropDefault, { capture: true, passive: false });
    document.addEventListener('drop', preventBrowserFileDropDefault, { capture: true, passive: false });

    OnFileDrop((x: number, y: number, paths: string[]) => {
        void handleExternalFileDrop({
            ensureTrackIndexForPath,
            handleDroppedFolderPath,
            playDroppedTrackPath,
            playlistControllerHandleExternalTrackDrop,
            playlistControllerLoadPlaylistByPath,
        }, x, y, paths).catch((error: unknown) => {
            console.error(error);
        });
    }, false);

    const coverFrameInteractive = (): boolean => canInteractWithCoverFrame({
        app,
        coverArt,
        playerLane,
    });

    coverFront.addEventListener('click', (event: MouseEvent) => {
        if (!coverFrameInteractive() || context.coverFlipped || event.ctrlKey || performance.now() < context.suppressCoverFrontClickUntil) {
            return;
        }

        openCoverImageModal();
    });

    coverFrame.addEventListener('mousedown', (event: MouseEvent) => {
        if (!coverFrameInteractive()) {
            return;
        }

        toggleCoverFlipFromSecondaryInput(event);
    });

    coverFrame.addEventListener('pointerdown', (event: PointerEvent) => {
        if (!coverFrameInteractive()) {
            return;
        }

        toggleCoverFlipFromSecondaryInput(event);
    });

    coverFrame.addEventListener('contextmenu', (event: MouseEvent) => {
        if (!coverFrameInteractive()) {
            return;
        }

        toggleCoverFlipFromContextMenu(event);
    });

    coverFrame.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        if (!coverFrameInteractive()) {
            return;
        }

        event.preventDefault();

        openCoverImageModal();
    });

    trackTechnical.addEventListener('click', () => {
        void openTechnicalInfoModal();
    });

    trackTechnicalAlt.addEventListener('click', (event: MouseEvent) => {
        event.stopPropagation();
        void openTechnicalInfoModal();
    });

    libraryAbout.addEventListener('click', () => {
        openAboutModal();
    });

    const openOverviewAlbumTrack = (container: HTMLElement, eventTarget: EventTarget | null): void => {
        const trackIndex = resolveOverviewAlbumTrackIndex(container, eventTarget);
        if (trackIndex === null) {
            return;
        }

        libraryController.setSidebarOpen(false);
        showNowPlayingPage();
        void (async () => {
            await loadTrack(trackIndex, true, undefined, true);
            await playCurrentTrack();
        })();
    };

    overviewLastPlayedList.addEventListener('click', (event) => {
        openOverviewAlbumTrack(overviewLastPlayedList, event.target);
    });

    overviewLastPlayedList.addEventListener('contextmenu', (event) => {
        openOverviewAlbumContextMenu({ tracks, openSidebarQueueMenu }, overviewLastPlayedList, event);
    });

    overviewLastAddedList.addEventListener('click', (event) => {
        openOverviewAlbumTrack(overviewLastAddedList, event.target);
    });

    overviewLastAddedList.addEventListener('contextmenu', (event) => {
        openOverviewAlbumContextMenu({ tracks, openSidebarQueueMenu }, overviewLastAddedList, event);
    });

    overviewAlbumGrid.addEventListener('contextmenu', (event) => {
        openOverviewAlbumContextMenu({ tracks, openSidebarQueueMenu }, overviewAlbumGrid, event);
    });

    taskbarShowPlayer.addEventListener('click', () => {
        toggleTaskbarCoverView({
            app,
            libraryController,
            sidebarController,
            showOverviewPage,
            showNowPlayingPage,
            refreshCurrentTrackMetadata,
        });
    });

    taskbarShowOverview.addEventListener('click', () => {
        showOverviewPage();
        sidebarController.showNavigation();
    });

    setupSidebarShellBindings({
        libraryController,
        sidebarController,
        sidebarToggle,
        sidebarNavLibrary,
        sidebarNavOverview,
        sidebarNavSocial,
        showOverviewPage,
    });

    sidebarQueueAddNext.addEventListener('click', () => {
        const selection = captureSidebarQueueSelectionContext();
        if (selection === null) {
            return;
        }

        closeSidebarQueueMenu();
        void (async () => {
            const trackIndexes = await resolveSidebarQueueTrackIndexesForAction('Add next', selection);
            if (trackIndexes.length > 0) {
                playlistController.addToQueueNext(trackIndexes);
            }
        })();
    });

    sidebarQueueAddToPlaylist.addEventListener('click', () => {
        const selection = captureSidebarQueueSelectionContext();
        if (selection === null) {
            return;
        }

        closeSidebarQueueMenu();
        void addSidebarSelectionToPlaylist(selection).catch((error: unknown) => {
            console.error(error);
        });
    });

    sidebarQueuePlay.addEventListener('click', () => {
        const selection = captureSidebarQueueSelectionContext();
        if (selection === null) {
            return;
        }

        closeSidebarQueueMenu();
        void (async () => {
            const trackIndexes = await resolveSidebarQueueTrackIndexesForAction('Play', selection);
            if (trackIndexes.length > 0) {
                await playSidebarQueueSelection(trackIndexes);
            }
        })();
    });

    sidebarQueueLove.addEventListener('click', () => {
        closeSidebarQueueMenu();
        const trackIndex = sidebarQueueFeedbackTrackIndex();
        if (trackIndex === null) {
            return;
        }

        void submitSidebarQueueFeedback(trackIndex, 1 as ListenBrainzFeedbackScore);
    });

    sidebarQueueHate.addEventListener('click', () => {
        closeSidebarQueueMenu();
        const trackIndex = sidebarQueueFeedbackTrackIndex();
        if (trackIndex === null) {
            return;
        }

        void submitSidebarQueueFeedback(trackIndex, -1 as ListenBrainzFeedbackScore);
    });

    sidebarQueueEnd.addEventListener('click', () => {
        const selection = captureSidebarQueueSelectionContext();
        if (selection === null) {
            return;
        }

        closeSidebarQueueMenu();
        void (async () => {
            const trackIndexes = await resolveSidebarQueueTrackIndexesForAction('Queue', selection);
            if (trackIndexes.length > 0) {
                playlistController.addToQueueEnd(trackIndexes);
            }
        })();
    });

    sidebarQueueTreeToggleBtn.addEventListener('click', () => {
        const folderPath = (sidebarQueueTreeToggleBtn.dataset.folderPath || '').trim();
        const expandAll = sidebarQueueTreeToggleBtn.dataset.expandAll === 'true';
        closeSidebarQueueMenu();
        if (folderPath === '') {
            return;
        }

        libraryController.setSearchTreeSubtreeExpanded(folderPath, expandAll);
    });

    sidebarQueueOpenInBrowser.addEventListener('click', () => {
        triggerSidebarOpenInBrowserAction(openSidebarQueueItemInFileBrowser, closeSidebarQueueMenu);
    });

    sidebarQueueSendToList.addEventListener('click', (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
            logSendToFrontend('sidebar click ignored: target is not a button');
            return;
        }

        const actionIndex = Number(target.dataset.sendToActionIndex);
        const actionScope = sidebarQueueSendToActionScope();
        const actionPath = sidebarQueueFileActionPath();
        if (!Number.isInteger(actionIndex) || actionScope === null || actionPath === '') {
            logSendToFrontend(`sidebar click ignored: invalid state actionIndex=${String(actionIndex)} scope=${actionScope || 'none'} targetPath=${JSON.stringify(actionPath)}`);
            return;
        }

        const action = sendToActionsForScope(actionScope)[actionIndex];
        closeSidebarQueueMenu();
        if (!action) {
            logSendToFrontend(`sidebar click ignored: missing action for scope=${actionScope} actionIndex=${actionIndex}`);
            return;
        }

        logSendToFrontend(`sidebar click launch: scope=${actionScope} actionIndex=${actionIndex} title=${JSON.stringify(action.title)}`);
        void runCustomSendToAction(action, actionPath);
    });

    errorBackdrop.addEventListener('click', () => { suppressTrackMetaClicks(); closeErrorModal(); });
    errorClose.addEventListener('click', () => { suppressTrackMetaClicks(); closeErrorModal(); });
    errorOk.addEventListener('click', () => { suppressTrackMetaClicks(); closeErrorModal(); });
    queueConfirmBackdrop.addEventListener('click', () => { suppressTrackMetaClicks(); closeQueueConfirmModal(false); });
    queueConfirmCancel.addEventListener('click', () => { suppressTrackMetaClicks(); closeQueueConfirmModal(false); });
    queueConfirmProceed.addEventListener('click', () => { suppressTrackMetaClicks(); closeQueueConfirmModal(true); });
    textFileBackdrop.addEventListener('click', () => { suppressTrackMetaClicks(); closeTextFileModal(); });
    textFileClose.addEventListener('click', () => { suppressTrackMetaClicks(); closeTextFileModal(); });
    musicBrainzEntityBackdrop.addEventListener('click', () => { suppressTrackMetaClicks(); closeMusicBrainzEntityModal(); });
    musicBrainzEntityClose.addEventListener('click', () => { suppressTrackMetaClicks(); closeMusicBrainzEntityModal(); });
    shareBackdrop.addEventListener('click', () => { suppressTrackMetaClicks(); shareController.close(); });
    shareClose.addEventListener('click', () => { suppressTrackMetaClicks(); shareController.close(); });
    shareCommentInput.addEventListener('input', () => { shareController.renderPreview(); shareController.setStatus(''); });
    shareSave.addEventListener('click', () => { void shareController.savePreview(); });
    shareCopy.addEventListener('click', () => { void shareController.copyPreview(); });
    technicalInfoBackdrop.addEventListener('click', () => { suppressTrackMetaClicks(); closeTechnicalInfoModal(); });
    technicalInfoClose.addEventListener('click', () => { suppressTrackMetaClicks(); closeTechnicalInfoModal(); });
    aboutBackdrop.addEventListener('click', () => { suppressTrackMetaClicks(); closeAboutModal(); });
    aboutClose.addEventListener('click', () => { suppressTrackMetaClicks(); closeAboutModal(); });

    aboutRepoLink.addEventListener('click', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        void BrowserOpenURL('https://github.com/metaisfacil/silphium');
    });

    settingsElements.settingsBackdrop.addEventListener('click', suppressTrackMetaClicks);
    settingsElements.settingsClose.addEventListener('click', suppressTrackMetaClicks);
    playlistModalElements.playlistBackdrop.addEventListener('click', suppressTrackMetaClicks);
    playlistModalElements.playlistClose.addEventListener('click', suppressTrackMetaClicks);
    playlistTargetModalElements.playlistTargetBackdrop.addEventListener('click', suppressTrackMetaClicks);
    playlistTargetModalElements.playlistTargetClose.addEventListener('click', suppressTrackMetaClicks);
    playlistTargetModalElements.playlistTargetCancel.addEventListener('click', suppressTrackMetaClicks);
    playlistTargetModalElements.playlistTargetConfirm.addEventListener('click', suppressTrackMetaClicks);
    imageModalElements.imageFileBackdrop.addEventListener('click', suppressTrackMetaClicks);

    document.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Escape') {
            return;
        }

        if (playlistTargetModalController.handleEscape() || playlistController.handleEscape() || settingsController.handleEscape()) {
            return;
        }

        if (!listenBrainzFeedbackMenu.hidden) {
            closeListenBrainzFeedbackMenu();
            return;
        }
        if (!sidebarQueueMenu.hidden) {
            closeSidebarQueueMenu();
            return;
        }
        if (!queueConfirmModal.hidden) {
            closeQueueConfirmModal(false);
            return;
        }
        if (!errorModal.hidden) {
            closeErrorModal();
            return;
        }
        if (!musicBrainzEntityModal.hidden) {
            closeMusicBrainzEntityModal();
            return;
        }
        if (!shareModal.hidden) {
            shareController.close();
            return;
        }
        if (!technicalInfoModal.hidden) {
            closeTechnicalInfoModal();
            return;
        }
        if (!aboutModal.hidden) {
            closeAboutModal();
            return;
        }
        if (!textFileModal.hidden) {
            closeTextFileModal();
            return;
        }
        if (imageModalController.handleEscape()) {
            return;
        }
        if (libraryController.isSidebarOpen()) {
            libraryController.setSidebarOpen(false);
        }
    });

    playPause.addEventListener('pointerdown', () => {
        logTransportGesture('playPause pointerdown', playPause);
        unlockMediaSessionAnchorFromUserGesture();
    }, { passive: true });
    playPause.addEventListener('click', () => {
        logTransportGesture('playPause click', playPause);
        void toggleCurrentTrack();
    });
    playPause.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        openPlayOrderMenu(event.clientX, event.clientY);
    });

    playOrderMenu.addEventListener('click', (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
            return;
        }

        const nextMode = target.dataset.playOrder as PlaybackOrderMode | undefined;
        if (!nextMode) {
            return;
        }

        setPlaybackOrderMode(nextMode);
        void savePlaybackOrderSetting();
        closePlayOrderMenu();
    });

    trackMetaParentFolderBtn.addEventListener('click', () => { closeTrackMetaMenu(); openCurrentTrackFolderInSidebar(); });
    trackMetaBrowserFolderBtn.addEventListener('click', () => { closeTrackMetaMenu(); void openCurrentTrackFolderInFileBrowser(); });
    trackMetaCopyFilePathBtn.addEventListener('click', () => { closeTrackMetaMenu(); void copyCurrentTrackFilePath(); });
    trackMetaCopyFolderPathBtn.addEventListener('click', () => { closeTrackMetaMenu(); void copyCurrentTrackFolderPath(); });
    trackMetaFilterArtistBtn.addEventListener('click', () => {
        triggerTrackMetaArtistFilterAction(trackMetaArtistFilterQuery(), openLibrarySearch, closeTrackMetaMenu);
    });

    trackMetaOpenMbBtn.addEventListener('click', () => {
        const target = trackMetaMenuTarget();
        closeTrackMetaMenu();
        if (target) {
            openMbLink(target);
        }
    });

    trackMetaSendToList.addEventListener('click', (event: MouseEvent) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) {
            logSendToFrontend('track-meta click ignored: target is not a button');
            return;
        }

        const scope = trackMetaMenuActionScope();
        const actionIndex = Number(target.dataset.sendToActionIndex);
        const actionPath = trackMetaMenuActionPath();
        closeTrackMetaMenu();
        if (scope === null || !Number.isInteger(actionIndex) || actionPath === '') {
            logSendToFrontend(`track-meta click ignored: invalid state actionIndex=${String(actionIndex)} scope=${scope || 'none'} targetPath=${JSON.stringify(actionPath)}`);
            return;
        }

        const action = sendToActionsForScope(scope)[actionIndex];
        if (!action) {
            logSendToFrontend(`track-meta click ignored: missing action for scope=${scope} actionIndex=${actionIndex}`);
            return;
        }

        logSendToFrontend(`track-meta click launch: scope=${scope} actionIndex=${actionIndex} title=${JSON.stringify(action.title)}`);
        void runCustomSendToAction(action, actionPath);
    });

    setupTrackNavigationBindings({
        back,
        forward,
        unlockMediaSessionAnchorFromUserGesture,
        goToTrack,
        logTransportGesture,
    });
    shareBtn.addEventListener('click', () => { void shareController.open(); });

    seek.addEventListener('input', () => {
        context.isSeeking = true;
        context.currentTimeLabel.textContent = context.formatTime(Number(seek.value));
    });
    seek.addEventListener('change', () => {
        context.isSeeking = false;
        void (async () => {
            try {
                const nextState = await context.audioSeek(Number(seek.value));
                context.applyPlaybackState(nextState);
            } catch (error) {
                context.handleAudioError(error);
            }
        })();
    });
    seek.addEventListener('blur', () => { context.isSeeking = false; });

    const volumeRow = setupVolumeControlBindings({
        document,
        volume,
        volumeBtn,
        audioSetVolume: context.audioSetVolume,
        applyPlaybackState: context.applyPlaybackState,
        handleAudioError: context.handleAudioError,
    });

    document.addEventListener('click', (e: MouseEvent) => {
        const startedAtMs = devPerfLoggingEnabled ? performance.now() : 0;
        const clickTarget = e.target;
        const slowSteps: ClickStepMetric[] = [];
        if (devPerfLoggingEnabled) {
            requestAnimationFrame(() => {
                logSlowClick('frame', performance.now() - startedAtMs, clickTarget);
            });
        }

        const target = e.target as Node;
        const clickPath = e.composedPath();
        const pathIncludes = (node: EventTarget | null): boolean => node !== null && clickPath.includes(node);
        const sidebarOpen = libraryController.isSidebarOpen();
        const shouldSuppressSidebarOutsideClose = suppressSidebarOutsideCloseOnce
            && sidebarOpen
            && !pathIncludes(librarySidebar)
            && !pathIncludes(sidebarToggle)
            && !pathIncludes(libraryAbout);
        suppressSidebarOutsideCloseOnce = false;

        try {
            measureClickStep(slowSteps, 'dismiss-overlays', () => {
                if (!playOrderMenu.hidden && !pathIncludes(playOrderMenu)) closePlayOrderMenu();
                if (!trackMetaMenu.hidden && !pathIncludes(trackMetaMenu)) closeTrackMetaMenu();
                if (!sidebarQueueMenu.hidden && !pathIncludes(sidebarQueueMenu)) closeSidebarQueueMenu();
                if (!queueConfirmModal.hidden && !pathIncludes(queueConfirmModal)) closeQueueConfirmModal(false);
                if (!listenBrainzFeedbackMenu.hidden && !pathIncludes(listenBrainzFeedbackMenu) && !pathIncludes(listenBrainzLoveBtn)) closeListenBrainzFeedbackMenu();
                if (!pathIncludes(volumeRow)) volumeRow.classList.remove('open');
            });
            if (measureClickStep(slowSteps, 'playlist-click-hooks', () => playlistTargetModalController.handleDocumentClick(target) || playlistController.handleDocumentClick(target))) return;
            if (pathIncludes(settingsElements.settingsModal)) return;
            if (measureClickStep(slowSteps, 'settings-click-hook', () => handleDocumentClickWithinSettings(target))) return;
            const imageModalContainsTarget = measureClickStep(slowSteps, 'image-modal-contains', () => imageModalController.contains(target));
            if (pathIncludes(musicBrainzEntityModal) || pathIncludes(sidebarQueueMenu) || pathIncludes(queueConfirmModal) || pathIncludes(errorModal) || pathIncludes(technicalInfoModal) || pathIncludes(aboutModal) || pathIncludes(textFileModal) || imageModalContainsTarget) return;
            if (pathIncludes(trackMetaMenu) || pathIncludes(listenBrainzFeedbackMenu)) return;
            if (shouldSuppressSidebarOutsideClose) return;
            if (!sidebarOpen) return;
            if (pathIncludes(librarySidebar) || pathIncludes(sidebarToggle) || pathIncludes(libraryAbout)) return;
            measureClickStep(slowSteps, 'sidebar-close', () => {
                libraryController.setSidebarOpen(false);
            });
        } finally {
            logSlowClick('handler', performance.now() - startedAtMs, clickTarget, slowSteps);
        }
    });

    document.addEventListener('contextmenu', (event: MouseEvent) => {
        if (toggleCoverFlipFromContextMenu(event)) return;
        const clickPath = event.composedPath();
        const pathIncludes = (node: EventTarget | null): boolean => node !== null && clickPath.includes(node);
        if (!sidebarQueueMenu.hidden && !pathIncludes(sidebarQueueMenu)) closeSidebarQueueMenu();
        if (!listenBrainzFeedbackMenu.hidden && !pathIncludes(listenBrainzFeedbackMenu) && !pathIncludes(listenBrainzLoveBtn)) closeListenBrainzFeedbackMenu();
        if (pathIncludes(listenBrainzLoveBtn) || pathIncludes(listenBrainzFeedbackMenu)) return;
        if (pathIncludes(trackTitle) || pathIncludes(trackAlbum) || pathIncludes(trackArtist) || pathIncludes(trackTitleInline) || pathIncludes(trackReleaseAlbum) || pathIncludes(trackArtistHeader) || pathIncludes(trackMetaMenu)) return;
        if (!trackMetaMenu.hidden) closeTrackMetaMenu();
    });

    document.addEventListener('scroll', () => {
        if (!playOrderMenu.hidden) closePlayOrderMenu();
        if (!sidebarQueueMenu.hidden) closeSidebarQueueMenu();
        if (!trackMetaMenu.hidden) closeTrackMetaMenu();
        if (!listenBrainzFeedbackMenu.hidden) closeListenBrainzFeedbackMenu();
        playlistController.closeMenu();
    }, { capture: true });

    document.addEventListener('mousedown', (event: MouseEvent) => {
        if (event.button !== 0) {
            librarySearchMouseDownActive = false;
            return;
        }

        const clickPath = event.composedPath();
        librarySearchMouseDownActive = clickPath.includes(librarySearch);
    }, { capture: true });

    document.addEventListener('mouseup', (event: MouseEvent) => {
        if (!librarySearchMouseDownActive) {
            return;
        }

        librarySearchMouseDownActive = false;
        if (!libraryController.isSidebarOpen()) {
            return;
        }

        const clickPath = event.composedPath();
        if (clickPath.includes(librarySidebar)) {
            return;
        }

        suppressSidebarOutsideCloseOnce = true;
        event.preventDefault();
    }, { capture: true });

    document.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'F5' || event.repeat) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        void context.refreshCurrentTrackMetadata().catch((error: unknown) => {
            console.error(error);
            const message = error instanceof Error && error.message.trim() !== ''
                ? error.message.trim()
                : 'Unable to refresh metadata for the current track.';
            context.openErrorModal('Metadata Refresh Failed', message);
        });
    });
    document.addEventListener('keydown', (event: KeyboardEvent) => {
        const suppressCapsLockToggle = event.code === 'CapsLock' && focusedShortcutBindingsUseCode('CapsLock');
        if (handleFocusedHardwareMediaKey(event) || handleFocusedKeyboardShortcut(event) || suppressCapsLockToggle) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        if (event.key === 'Escape' && !playOrderMenu.hidden) closePlayOrderMenu();
        if (event.key === 'Escape' && !trackMetaMenu.hidden) closeTrackMetaMenu();
        if (event.key === 'Escape' && !listenBrainzFeedbackMenu.hidden) closeListenBrainzFeedbackMenu();
        if (event.key === 'Escape') playlistController.closeMenu();
    });

    document.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key === 'Control') setCtrlHeldState(true);
    });
    document.addEventListener('keyup', (event: KeyboardEvent) => {
        if (event.code === 'CapsLock' && focusedShortcutBindingsUseCode('CapsLock')) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (event.key === 'Control') setCtrlHeldState(false);
    });

    window.addEventListener('blur', () => { setCtrlHeldState(false); void hideToTrayWhenMinimized(); });
    window.addEventListener('beforeunload', () => { context.mediaSessionController.dispose(); });
    window.addEventListener('resize', () => { updateLyricsPanelVisibility(); void hideToTrayWhenMinimized(); });

    playerCardResizeObserver.observe(playerCard);

    EventsOn('silphium:library:rescan-log', (logLine: string) => { console.log(logLine); });
    EventsOn('silphium:library:scan-updated', (scanResult: LibraryScanResult) => {
        logBridgeEvent('library-event', 'scan-updated', summarizeLibraryScanResultForBridge(scanResult), {
            sink: logFrontendMessage,
        });
        void handleLibraryScanUpdatedEvent(scanResult);
    });
    EventsOn('silphium:library:scan-progress', (scanProgress: LibraryScanProgress) => {
        logBridgeEvent('library-event', 'scan-progress', summarizeLibraryScanProgressForBridge(scanProgress), {
            sink: logFrontendMessage,
        });
        updateLibraryLoadingEtaFromProgress(scanProgress);
    });
    EventsOn('silphium:musicbrainz:tag-worker-progress', (progress: MusicBrainzTagWorkerProgress) => {
        context.currentMusicBrainzTagWorkerProgress = normalizeMusicBrainzTagWorkerProgress(progress);
        setMusicBrainzTagWorkerProgress(context.currentMusicBrainzTagWorkerProgress);
    });
    EventsOn('silphium:media:key', (action: string) => {
        logBridgeEvent('transport-event', 'media-key', { action }, {
            sink: logFrontendMessage,
        });
        if (action === 'playpause') {
            dispatchExternalPlaybackAction('playpause');
            return;
        }
        if (action === 'next') {
            dispatchExternalPlaybackAction('next');
            return;
        }
        if (action === 'previous') {
            dispatchExternalPlaybackAction('previous');
            return;
        }
        if (action === 'stop') {
            dispatchExternalPlaybackAction('stop');
        }
    });

    logRescan('event bindings ready');
};