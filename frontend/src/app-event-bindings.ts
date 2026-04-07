import { BrowserOpenURL, EventsOn, OnFileDrop } from '../wailsjs/runtime/runtime';
import type { ListenBrainzFeedbackScore } from './controllers/listenbrainz-controller';
import type { AppEventBindingsContext } from './app-bootstrap-setup';
import { openMbLink } from './musicbrainz';
import type { AudioPlaybackState, LibraryScanProgress, LibraryScanResult, MusicBrainzTagWorkerProgress, PlaybackOrderMode } from './types/app-types';
import { hasExternalFileDragPayload, isSupportedAudioFilePath } from './utils/main-helpers';

type VolumeControlBindingsContext = {
    document: Document;
    volume: HTMLInputElement;
    volumeBtn: HTMLButtonElement;
    audioSetVolume: (volumeValue: number) => Promise<AudioPlaybackState>;
    applyPlaybackState: (state: AudioPlaybackState) => void;
    handleAudioError: (error: unknown) => void;
};

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

    volumeRow.addEventListener('pointerenter', () => {
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

export const setupAppEventBindings = (context: AppEventBindingsContext): void => {
    const {
        window,
        document,
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
        librarySidebar,
        librarySearch,
        sidebarToggle,
        playerCard,
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
        handleDroppedFolderPath,
        playDroppedTrackPath,
        openCoverImageModal,
        toggleCoverFlipFromSecondaryInput,
        toggleCoverFlipFromContextMenu,
        openTechnicalInfoModal,
        openAboutModal,
        captureSidebarQueueSelectionContext,
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
        openPlayOrderMenu,
        setPlaybackOrderMode,
        savePlaybackOrderSetting,
        openCurrentTrackFolderInSidebar,
        openCurrentTrackFolderInFileBrowser,
        copyCurrentTrackFilePath,
        copyCurrentTrackFolderPath,
        trackMetaMenuTarget,
        trackMetaMenuActionScope,
        trackMetaMenuActionPath,
        goToTrack,
        toggleCurrentTrack,
        updateLyricsPanelVisibility,
        hideToTrayWhenMinimized,
        unlockMediaSessionAnchorFromUserGesture,
        handleFocusedHardwareMediaKey,
        handleFocusedKeyboardShortcut,
        focusedShortcutBindingsUseCode,
        setCtrlHeldState,
        handleLibraryScanUpdatedEvent,
        updateLibraryLoadingEtaFromProgress,
        normalizeMusicBrainzTagWorkerProgress,
        setMusicBrainzTagWorkerProgress,
        dispatchExternalPlaybackAction,
        playlistControllerLoadPlaylistByPath,
        handleDocumentClickWithinSettings,
        playerCardResizeObserver,
        logRescan,
    } = context;

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
        const droppedPaths = (paths || []).map((path) => path.trim()).filter((path) => path !== '');
        if (droppedPaths.length === 0) {
            return;
        }

        const droppedPlaylistPath = droppedPaths.find((path) => /\.(m3u8?|M3U8?)$/.test(path));
        if (droppedPlaylistPath) {
            void playlistControllerLoadPlaylistByPath(droppedPlaylistPath).catch((error: unknown) => {
                console.error(error);
            });
            return;
        }

        const droppedAudioPath = droppedPaths.find((path) => isSupportedAudioFilePath(path));
        if (droppedAudioPath) {
            void playDroppedTrackPath(droppedAudioPath).catch((error: unknown) => {
                console.error(error);
            });
            return;
        }

        const droppedFolderPath = droppedPaths.find((path) => !/\.(m3u8?|M3U8?)$/.test(path) && !isSupportedAudioFilePath(path));
        if (!droppedFolderPath) {
            return;
        }

        void handleDroppedFolderPath(x, y, droppedFolderPath).catch((error: unknown) => {
            console.error(error);
        });
    }, false);

    coverFront.addEventListener('click', (event: MouseEvent) => {
        if (context.coverFlipped || event.ctrlKey || performance.now() < context.suppressCoverFrontClickUntil) {
            return;
        }

        openCoverImageModal();
    });

    coverFrame.addEventListener('mousedown', (event: MouseEvent) => {
        toggleCoverFlipFromSecondaryInput(event);
    });

    coverFrame.addEventListener('pointerdown', (event: PointerEvent) => {
        toggleCoverFlipFromSecondaryInput(event);
    });

    coverFrame.addEventListener('contextmenu', (event: MouseEvent) => {
        toggleCoverFlipFromContextMenu(event);
    });

    coverFrame.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }

        event.preventDefault();

        if (!coverArt.classList.contains('is-visible') || !coverArt.src) {
            return;
        }

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

    playPause.addEventListener('click', () => { void toggleCurrentTrack(); });
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

    back.addEventListener('click', () => { goToTrack(-1); });
    forward.addEventListener('click', () => { goToTrack(1); });
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
        const target = e.target as Node;
        const clickPath = e.composedPath();
        const shouldSuppressSidebarOutsideClose = suppressSidebarOutsideCloseOnce
            && libraryController.isSidebarOpen()
            && !clickPath.includes(librarySidebar)
            && !clickPath.includes(sidebarToggle)
            && !clickPath.includes(libraryAbout);
        suppressSidebarOutsideCloseOnce = false;

        if (!playOrderMenu.hidden && !playOrderMenu.contains(target)) closePlayOrderMenu();
        if (!trackMetaMenu.hidden && !trackMetaMenu.contains(target)) closeTrackMetaMenu();
        if (!sidebarQueueMenu.hidden && !sidebarQueueMenu.contains(target)) closeSidebarQueueMenu();
        if (!queueConfirmModal.hidden && !queueConfirmModal.contains(target)) closeQueueConfirmModal(false);
        if (!listenBrainzFeedbackMenu.hidden && !listenBrainzFeedbackMenu.contains(target) && !listenBrainzLoveBtn.contains(target)) closeListenBrainzFeedbackMenu();
        if (!volumeRow.contains(target)) volumeRow.classList.remove('open');
        if (playlistTargetModalController.handleDocumentClick(target) || playlistController.handleDocumentClick(target)) return;
        if (clickPath.includes(settingsElements.settingsModal)) return;
        if (handleDocumentClickWithinSettings(target)) return;
        if (musicBrainzEntityModal.contains(target) || sidebarQueueMenu.contains(target) || queueConfirmModal.contains(target) || errorModal.contains(target) || technicalInfoModal.contains(target) || aboutModal.contains(target) || textFileModal.contains(target) || imageModalController.contains(target)) return;
        if (clickPath.includes(trackMetaMenu) || clickPath.includes(listenBrainzFeedbackMenu)) return;
        if (shouldSuppressSidebarOutsideClose) return;
        if (!libraryController.isSidebarOpen()) return;
        if (clickPath.includes(librarySidebar) || clickPath.includes(sidebarToggle) || clickPath.includes(libraryAbout)) return;
        libraryController.setSidebarOpen(false);
    });

    document.addEventListener('contextmenu', (event: MouseEvent) => {
        if (toggleCoverFlipFromContextMenu(event)) return;
        const target = event.target as Node;
        if (!sidebarQueueMenu.hidden && !sidebarQueueMenu.contains(target)) closeSidebarQueueMenu();
        if (!listenBrainzFeedbackMenu.hidden && !listenBrainzFeedbackMenu.contains(target) && !listenBrainzLoveBtn.contains(target)) closeListenBrainzFeedbackMenu();
        if (listenBrainzLoveBtn.contains(target) || listenBrainzFeedbackMenu.contains(target)) return;
        if (trackTitle.contains(target) || trackAlbum.contains(target) || trackArtist.contains(target) || trackTitleInline.contains(target) || trackReleaseAlbum.contains(target) || trackArtistHeader.contains(target) || trackMetaMenu.contains(target)) return;
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

    document.addEventListener('pointerdown', () => { unlockMediaSessionAnchorFromUserGesture(); }, { capture: true, passive: true });
    document.addEventListener('keydown', () => { unlockMediaSessionAnchorFromUserGesture(); }, { capture: true });
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
    EventsOn('silphium:library:scan-updated', (scanResult: LibraryScanResult) => { handleLibraryScanUpdatedEvent(scanResult); });
    EventsOn('silphium:library:scan-progress', (scanProgress: LibraryScanProgress) => { updateLibraryLoadingEtaFromProgress(scanProgress); });
    EventsOn('silphium:musicbrainz:tag-worker-progress', (progress: MusicBrainzTagWorkerProgress) => {
        context.currentMusicBrainzTagWorkerProgress = normalizeMusicBrainzTagWorkerProgress(progress);
        setMusicBrainzTagWorkerProgress(context.currentMusicBrainzTagWorkerProgress);
    });
    EventsOn('silphium:media:key', (action: string) => {
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