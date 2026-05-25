import { ClipboardSetText } from '../wailsjs/runtime/runtime';
import { OpenFolderInFileBrowser, ResolveLibraryFolderForPath, RunCustomSendToAction, GetLibraryFolderTrackCount, GetLibraryFolderTrackPaths } from '../wailsjs/go/main/App';
import type { AppQueueMenuRuntimeContext } from './app-runtime-setup';
import type { ListenBrainzFeedbackScore } from './controllers/listenbrainz-controller';
import type { CustomSendToAction, CustomSendToActionScope, PlaybackOrderMode } from './types/app-types';
import { cleanSidebarQueueSelectionLabel, renderSendToButtons } from './utils/display-helpers';

export type SidebarQueueSelectionContext = {
    trackIndexes: number[];
    folderPath: string;
    folderLabel: string;
    folderTarget: boolean;
    trackIndexesScopedToSelection: boolean;
};

type FileBrowserAppBindings = {
    OpenFileInFileBrowser?: (path: string) => Promise<boolean>;
};

export const createAppQueueMenuRuntime = (context: AppQueueMenuRuntimeContext) => {
    let pendingSidebarQueueMenuPositionFrame = 0;
    let pendingTrackMetaMenuPositionFrame = 0;
    let pendingPlayOrderMenuPositionFrame = 0;

    const playbackOrderMenuItemLabel = (mode: PlaybackOrderMode): string => {
        switch (mode) {
            case 'ordered-release':
                return 'Ordered: Release';
            case 'shuffle-release':
                return 'Shuffle: Release';
            case 'ordered-source':
                return 'Ordered: Current Source';
            case 'shuffle-source':
                return 'Shuffle: Current Source';
            case 'ordered-library':
                return 'Ordered: Full Library';
            case 'shuffle-library':
                return 'Shuffle: Full Library';
        }
    };

    const fileBrowserBindings = (): FileBrowserAppBindings | null => {
        const goBindings = (window as typeof window & {
            go?: {
                main?: {
                    App?: FileBrowserAppBindings;
                };
            };
        }).go;

        return goBindings?.main?.App ?? null;
    };

    const openFileInBrowser = async (path: string): Promise<boolean> => {
        const bindings = fileBrowserBindings();
        const openFile = bindings?.OpenFileInFileBrowser;
        if (typeof openFile !== 'function') {
            return false;
        }

        return await openFile(path);
    };

    const scheduleMenuPosition = (
        menu: HTMLElement,
        clientX: number,
        clientY: number,
        pendingFrameId: number,
        setPendingFrameId: (frameId: number) => void,
    ): void => {
        if (pendingFrameId !== 0) {
            window.cancelAnimationFrame(pendingFrameId);
        }

        menu.style.visibility = 'hidden';
        setPendingFrameId(window.requestAnimationFrame(() => {
            setPendingFrameId(0);
            if (menu.hidden) {
                menu.style.visibility = '';
                return;
            }

            const margin = 10;
            const rect = menu.getBoundingClientRect();
            const clampedX = Math.min(clientX, window.innerWidth - rect.width - margin);
            const clampedY = Math.min(clientY, window.innerHeight - rect.height - margin);

            menu.style.left = `${Math.max(margin, clampedX)}px`;
            menu.style.top = `${Math.max(margin, clampedY)}px`;
            menu.style.visibility = '';
        }));
    };

    const closePlayOrderMenu = (): void => {
        if (pendingPlayOrderMenuPositionFrame !== 0) {
            window.cancelAnimationFrame(pendingPlayOrderMenuPositionFrame);
            pendingPlayOrderMenuPositionFrame = 0;
        }
        context.playOrderMenu.style.visibility = '';
        context.playOrderMenu.hidden = true;
    };

    const closeTrackMetaMenu = (): void => {
        if (pendingTrackMetaMenuPositionFrame !== 0) {
            window.cancelAnimationFrame(pendingTrackMetaMenuPositionFrame);
            pendingTrackMetaMenuPositionFrame = 0;
        }
        context.trackMetaMenu.style.visibility = '';
        context.trackMetaMenu.hidden = true;
        context.trackMetaMenuTarget = null;
        context.trackMetaMenuActionScope = null;
        context.trackMetaMenuActionPath = '';
        context.trackMetaArtistFilterQuery = '';
        context.trackMetaFilterArtistBtn.hidden = true;
        context.trackMetaArtistDivider.hidden = true;
        context.trackMetaSendToList.innerHTML = '';
        context.trackMetaSendToDivider.hidden = true;
    };

    const captureSidebarQueueSelectionContext = (): SidebarQueueSelectionContext | null => {
        const trackIndexes = context.sidebarQueueTrackIndexes.filter((trackIndex: number) => (
            Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < context.tracks.length
        ));

        if (trackIndexes.length === 0 && !context.sidebarQueueFolderTarget) {
            return null;
        }

        return {
            trackIndexes,
            folderPath: context.sidebarQueueFolderPath,
            folderLabel: context.sidebarQueueFolderLabel,
            folderTarget: context.sidebarQueueFolderTarget,
            trackIndexesScopedToSelection: context.sidebarQueueTrackIndexesScopedToSelection,
        };
    };

    const closeSidebarQueueMenu = (): void => {
        if (pendingSidebarQueueMenuPositionFrame !== 0) {
            window.cancelAnimationFrame(pendingSidebarQueueMenuPositionFrame);
            pendingSidebarQueueMenuPositionFrame = 0;
        }
        context.sidebarQueueMenu.style.visibility = '';
        context.sidebarQueueMenu.hidden = true;
        context.sidebarQueueTrackIndexes = [];
        context.sidebarQueueFeedbackTrackIndex = null;
        context.sidebarQueueFolderPath = '';
        context.sidebarQueueFolderLabel = '';
        context.sidebarQueueFolderTarget = false;
        context.sidebarQueueTrackIndexesScopedToSelection = false;
        context.sidebarQueueFileActionPath = '';
        context.sidebarQueueIncludeFileActions = false;
        context.sidebarQueueSendToActionScope = null;
        context.sidebarQueuePlay.hidden = false;
        context.sidebarQueueAddNext.hidden = false;
        context.sidebarQueueEnd.hidden = false;
        context.sidebarQueueAddToPlaylist.hidden = false;
        context.sidebarQueueBrowserActionsDivider.hidden = true;
        context.sidebarQueueOpenInBrowser.hidden = true;
        context.sidebarQueueOpenInBrowser.textContent = 'Open folder in browser';
        context.sidebarQueueTreeToggleDivider.hidden = true;
        context.sidebarQueueTreeToggleBtn.hidden = true;
        context.sidebarQueueTreeToggleBtn.textContent = 'Expand all';
        delete context.sidebarQueueTreeToggleBtn.dataset.folderPath;
        delete context.sidebarQueueTreeToggleBtn.dataset.expandAll;
        context.sidebarQueueSendToList.innerHTML = '';
        context.sidebarQueueSendToDivider.hidden = true;
    };

    const sendToActionsForScope = (scope: CustomSendToActionScope): CustomSendToAction[] => {
        return context.currentSettings.customSendToActions.filter((action: CustomSendToAction) => action.scope === scope);
    };

    const logSendToFrontend = (message: string): void => {
        void context.logFrontendMessage(`[SEND-TO] ${message}`).catch(() => undefined);
    };

    const runCustomSendToAction = async (action: CustomSendToAction, path: string): Promise<void> => {
        const commandTemplate = action.commandTemplate.trim();
        const targetPath = path.trim();
        logSendToFrontend(`launch requested: scope=${action.scope} title=${JSON.stringify(action.title)} target=${JSON.stringify(targetPath)}`);
        if (commandTemplate === '' || targetPath === '') {
            logSendToFrontend(`launch aborted before backend call: empty command or target (scope=${action.scope} title=${JSON.stringify(action.title)})`);
            return;
        }

        try {
            const launched = await RunCustomSendToAction(commandTemplate, targetPath);
            if (!launched) {
                logSendToFrontend(`backend returned launched=false: scope=${action.scope} title=${JSON.stringify(action.title)} target=${JSON.stringify(targetPath)}`);
                context.openErrorModal('Send To Failed', 'Unable to launch the selected action for this path. Check the command template in Settings > Actions.');
                return;
            }

            logSendToFrontend(`backend accepted launch: scope=${action.scope} title=${JSON.stringify(action.title)} target=${JSON.stringify(targetPath)}`);
        } catch (error) {
            console.error(error);
            logSendToFrontend(`backend call threw error: scope=${action.scope} title=${JSON.stringify(action.title)} target=${JSON.stringify(targetPath)} error=${String(error)}`);
            context.openErrorModal('Send To Failed', 'Unable to launch the selected action for this path. Check the command template in Settings > Actions.');
        }
    };

    const resolveFolderSendToTargetPath = (fallbackFolderPath: string, trackIndexes: number[]): string => {
        for (const trackIndex of trackIndexes) {
            if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= context.tracks.length) {
                continue;
            }

            const trackFolderPath = (context.tracks[trackIndex].folderPath || '').trim();
            if (trackFolderPath !== '') {
                return trackFolderPath;
            }
        }

        return fallbackFolderPath;
    };

    const openSidebarQueueMenu = (
        clientX: number,
        clientY: number,
        trackIndexes: number[],
        feedbackTrackIndex?: number,
        includeFileActions = false,
        fileActionPath = '',
        folderPath?: string,
        folderLabel?: string,
        folderTarget = false,
        trackIndexesScopedToSelection = false,
        searchTreeExpandAll?: boolean,
    ): void => {
        const normalizedFolderPath = (folderPath || '').trim();
        const normalizedFileActionPath = fileActionPath.trim();
        if (trackIndexes.length === 0 && normalizedFolderPath === '' && !folderTarget && normalizedFileActionPath === '') {
            return;
        }

        closePlayOrderMenu();
        closeTrackMetaMenu();
        context.closeListenBrainzFeedbackMenu();
        context.playlistController.closeMenu();

        context.sidebarQueueTrackIndexes = trackIndexes;
        context.sidebarQueueFolderPath = normalizedFolderPath;
        context.sidebarQueueFolderLabel = (folderLabel || '').trim() || normalizedFolderPath;
        const isFolderTarget = folderTarget || normalizedFolderPath !== '';
        context.sidebarQueueFolderTarget = isFolderTarget;
        context.sidebarQueueTrackIndexesScopedToSelection = trackIndexesScopedToSelection;
        context.sidebarQueueIncludeFileActions = includeFileActions;
        context.sidebarQueueFileActionPath = normalizedFileActionPath;
        const showTrackActions = trackIndexes.length > 0 || isFolderTarget;
        context.sidebarQueuePlay.hidden = !showTrackActions;
        context.sidebarQueueAddNext.hidden = !showTrackActions;
        context.sidebarQueueEnd.hidden = !showTrackActions;
        context.sidebarQueueAddToPlaylist.hidden = !showTrackActions;
        const canShowFeedbackActions = !isFolderTarget
            && Number.isInteger(feedbackTrackIndex)
            && (feedbackTrackIndex as number) >= 0
            && (feedbackTrackIndex as number) < context.tracks.length;
        const hasListenBrainzToken = context.hasListenBrainzScrobbling();
        context.sidebarQueueFeedbackTrackIndex = canShowFeedbackActions ? (feedbackTrackIndex as number) : null;
        context.sidebarQueueFeedbackDivider.hidden = !canShowFeedbackActions;
        context.sidebarQueueLove.hidden = !canShowFeedbackActions;
        context.sidebarQueueHate.hidden = !canShowFeedbackActions;
        context.sidebarQueueLove.disabled = canShowFeedbackActions ? !hasListenBrainzToken : false;
        context.sidebarQueueHate.disabled = canShowFeedbackActions ? !hasListenBrainzToken : false;
        context.sidebarQueueLove.setAttribute('aria-disabled', context.sidebarQueueLove.disabled ? 'true' : 'false');
        context.sidebarQueueHate.setAttribute('aria-disabled', context.sidebarQueueHate.disabled ? 'true' : 'false');
        const feedbackDisabledTitle = 'Set a ListenBrainz token in Settings to enable Love/Hate.';
        const feedbackEnabledTitle = 'Submit ListenBrainz feedback for this track.';
        context.sidebarQueueLove.title = canShowFeedbackActions ? (hasListenBrainzToken ? feedbackEnabledTitle : feedbackDisabledTitle) : '';
        context.sidebarQueueHate.title = canShowFeedbackActions ? (hasListenBrainzToken ? feedbackEnabledTitle : feedbackDisabledTitle) : '';
        let sendToActions: CustomSendToAction[] = [];
        context.sidebarQueueSendToActionScope = null;
        if (isFolderTarget && normalizedFolderPath !== '') {
            context.sidebarQueueSendToActionScope = 'folder';
            context.sidebarQueueFileActionPath = resolveFolderSendToTargetPath(normalizedFolderPath, trackIndexes);
            sendToActions = sendToActionsForScope('folder');
        } else if (context.sidebarQueueIncludeFileActions && context.sidebarQueueFileActionPath !== '') {
            context.sidebarQueueSendToActionScope = 'file';
            sendToActions = sendToActionsForScope('file');
        }

        logSendToFrontend(
            `menu opened: scope=${context.sidebarQueueSendToActionScope || 'none'} folderTarget=${String(isFolderTarget)} sourcePath=${JSON.stringify(normalizedFolderPath)} targetPath=${JSON.stringify(context.sidebarQueueFileActionPath)} actionCount=${sendToActions.length}`,
        );

        const showSendToActions = sendToActions.length > 0 && context.sidebarQueueFileActionPath !== '';
        context.sidebarQueueSendToDivider.hidden = !showSendToActions;
        if (showSendToActions) {
            renderSendToButtons(context.sidebarQueueSendToList, sendToActions, 'playlist-menu-item');
        } else {
            context.sidebarQueueSendToList.innerHTML = '';
        }
        const showSearchTreeToggle = isFolderTarget && normalizedFolderPath !== '' && typeof searchTreeExpandAll === 'boolean';
        context.sidebarQueueTreeToggleDivider.hidden = !showSearchTreeToggle;
        context.sidebarQueueTreeToggleBtn.hidden = !showSearchTreeToggle;
        if (showSearchTreeToggle) {
            context.sidebarQueueTreeToggleBtn.textContent = searchTreeExpandAll ? 'Expand all' : 'Collapse all';
            context.sidebarQueueTreeToggleBtn.dataset.folderPath = normalizedFolderPath;
            context.sidebarQueueTreeToggleBtn.dataset.expandAll = searchTreeExpandAll ? 'true' : 'false';
        } else {
            context.sidebarQueueTreeToggleBtn.textContent = 'Expand all';
            delete context.sidebarQueueTreeToggleBtn.dataset.folderPath;
            delete context.sidebarQueueTreeToggleBtn.dataset.expandAll;
        }
        const showOpenInBrowserAction = isFolderTarget
            ? normalizedFolderPath !== ''
            : context.sidebarQueueFileActionPath !== '';
        const showBrowserActionsDivider = showOpenInBrowserAction
            && (showTrackActions || showSendToActions || showSearchTreeToggle || canShowFeedbackActions);
        context.sidebarQueueBrowserActionsDivider.hidden = !showBrowserActionsDivider;
        context.sidebarQueueOpenInBrowser.hidden = !showOpenInBrowserAction;
        context.sidebarQueueOpenInBrowser.textContent = isFolderTarget ? 'Open folder in browser' : 'Open file in browser';
        context.sidebarQueueMenu.hidden = false;
        scheduleMenuPosition(
            context.sidebarQueueMenu,
            clientX,
            clientY,
            pendingSidebarQueueMenuPositionFrame,
            (frameId) => {
                pendingSidebarQueueMenuPositionFrame = frameId;
            },
        );
    };

    const closeQueueConfirmModal = (confirmed: boolean): void => {
        context.queueConfirmModal.classList.remove('is-visible');
        context.queueConfirmModal.hidden = true;
        if (context.queueConfirmResolver) {
            const resolver = context.queueConfirmResolver;
            context.queueConfirmResolver = null;
            resolver(confirmed);
        }
    };

    const openQueueConfirmModal = (title: string, message: string): Promise<boolean> => {
        if (context.queueConfirmResolver) {
            context.queueConfirmResolver(false);
            context.queueConfirmResolver = null;
        }

        context.queueConfirmTitle.textContent = title;
        context.queueConfirmMessage.textContent = message;
        context.queueConfirmModal.hidden = false;
        window.requestAnimationFrame(() => {
            context.queueConfirmModal.classList.add('is-visible');
        });

        return new Promise<boolean>((resolve) => {
            context.queueConfirmResolver = resolve;
        });
    };

    const resolveSidebarQueueTrackIndexesForAction = async (
        actionLabel: string,
        selection: SidebarQueueSelectionContext,
    ): Promise<number[]> => {
        if (selection.trackIndexesScopedToSelection) {
            return selection.trackIndexes;
        }
        if (!selection.folderTarget) {
            return selection.trackIndexes;
        }

        const descendantCount = await GetLibraryFolderTrackCount(selection.folderPath) as number;
        if (!Number.isFinite(descendantCount) || descendantCount <= 0) {
            return [];
        }

        if (descendantCount > context.sidebarQueueDescendantPromptThreshold) {
            const formattedDescendantCount = descendantCount.toLocaleString('en-US');
            const folderLabel = selection.folderLabel || selection.folderPath;
            const shouldProceed = await openQueueConfirmModal(
                `${actionLabel} ${formattedDescendantCount} tracks?`,
                `${actionLabel} for "${folderLabel}" requires scanning ${formattedDescendantCount} descendant files and may significantly reduce performance. Continue?`,
            );
            if (!shouldProceed) {
                return [];
            }
        }

        const trackPaths = await GetLibraryFolderTrackPaths(selection.folderPath) as string[];
        return trackPaths.map((trackPath) => context.ensureTrackIndexForPath(trackPath)).filter((trackIndex) => trackIndex >= 0);
    };

    const playlistTargetMessageForSelection = (selection: SidebarQueueSelectionContext, trackIndexes: number[]): string => {
        const formattedCount = trackIndexes.length.toLocaleString('en-US');
        if (selection.folderTarget) {
            const folderLabel = cleanSidebarQueueSelectionLabel(selection.folderLabel) || selection.folderPath || 'this folder';
            const trackLabel = trackIndexes.length === 1 ? '1 track' : `${formattedCount} tracks`;
            return `Add ${trackLabel} from "${folderLabel}" to:`;
        }

        if (trackIndexes.length === 1) {
            const track = context.tracks[trackIndexes[0]];
            const trackLabel = track?.displayTitle || track?.name || 'this track';
            return `Add "${trackLabel}" to:`;
        }

        return `Add ${formattedCount} tracks to:`;
    };

    const addSidebarSelectionToPlaylist = async (selection: SidebarQueueSelectionContext): Promise<void> => {
        const trackIndexes = await resolveSidebarQueueTrackIndexesForAction('Add to playlist', selection);
        if (trackIndexes.length === 0) {
            return;
        }

        const playlistPath = await context.playlistTargetModalController.prompt({
            title: 'Add to playlist',
            message: playlistTargetMessageForSelection(selection, trackIndexes),
            confirmLabel: 'Add to playlist',
            getPlaylists: () => context.playlistController.getAvailablePlaylistTargets(),
            onOpenPlaylist: () => context.playlistController.openPlaylistTarget(),
            onCreatePlaylist: () => context.playlistController.createPlaylistTarget(),
            emptyStateMessage: 'No playlists are available yet. Open one or create one below.',
            duplicatePreventionLabel: 'Block duplicate current track in active playlist',
        });
        if (!playlistPath) {
            return;
        }

        if (
            playlistPath.duplicatePreventionEnabled
            && trackIndexes.includes(context.currentTrackIndex)
            && context.playlistController.isTrackAlreadyInLoadedPlaylist(playlistPath.selectedPath, context.currentTrackIndex)
        ) {
            context.openErrorModal(
                'Track already in playlist',
                'The current track is already in the active playlist. Disable duplicate prevention to add it again.',
            );
            return;
        }

        const appended = await context.playlistController.appendTracksToPlaylist(playlistPath.selectedPath, trackIndexes);
        if (!appended) {
            context.openErrorModal('Add to playlist failed', 'Silphium could not append the selected items to that playlist.');
        }
    };

    const playSidebarQueueSelection = async (trackIndexes: number[]): Promise<void> => {
        const [firstTrackIndex, ...remainingTrackIndexes] = trackIndexes.filter((trackIndex) => (
            Number.isInteger(trackIndex) && trackIndex >= 0 && trackIndex < context.tracks.length
        ));
        if (!Number.isInteger(firstTrackIndex)) {
            return;
        }

        if (context.fullLibraryScanLoadActive) {
            context.suppressAutoSelectAfterFullLibraryScan = true;
        }

        await context.loadTrack(firstTrackIndex, true, trackIndexes, true);
        context.playlistController.replacePlaybackQueue(trackIndexes, 0);
        if (remainingTrackIndexes.length > 0) {
            await context.queueGaplessNextTrack(undefined, trackIndexes);
        }
        await context.playCurrentTrack();
    };

    const isDropWithinSidebarBrowser = (clientX: number, clientY: number): boolean => {
        const dropTarget = document.elementFromPoint(clientX, clientY);
        return dropTarget !== null && context.libraryBrowser.contains(dropTarget);
    };

    const resolveDroppedLibraryFolderPath = async (path: string): Promise<string> => {
        const normalizedPath = path.trim();
        if (normalizedPath === '') {
            return '';
        }
        return (await ResolveLibraryFolderForPath(normalizedPath) as string).trim();
    };

    const playDroppedLibraryFolder = async (folderPath: string): Promise<boolean> => {
        const normalizedFolderPath = folderPath.trim();
        if (normalizedFolderPath === '') {
            return false;
        }

        const trackPaths = await GetLibraryFolderTrackPaths(normalizedFolderPath) as string[];
        const trackIndexes = trackPaths.map((trackPath) => context.ensureTrackIndexForPath(trackPath)).filter((trackIndex) => trackIndex >= 0);
        if (trackIndexes.length === 0) {
            return false;
        }

        context.libraryController.setSidebarAutoFolderPath(normalizedFolderPath);
        await playSidebarQueueSelection(trackIndexes);
        return true;
    };

    const playDroppedTrackPath = async (path: string): Promise<boolean> => {
        const normalizedPath = path.trim();
        if (normalizedPath === '') {
            return false;
        }

        const resolvedFolderPath = await resolveDroppedLibraryFolderPath(normalizedPath);
        if (resolvedFolderPath === '') {
            return false;
        }

        const trackIndex = context.ensureTrackIndexForPath(normalizedPath);
        if (trackIndex < 0) {
            return false;
        }

        await playSidebarQueueSelection([trackIndex]);
        return true;
    };

    const handleDroppedFolderPath = async (clientX: number, clientY: number, droppedPath: string): Promise<boolean> => {
        const resolvedFolderPath = await resolveDroppedLibraryFolderPath(droppedPath);
        if (resolvedFolderPath === '') {
            return false;
        }

        if (isDropWithinSidebarBrowser(clientX, clientY)) {
            context.libraryController.setSidebarAutoFolderPath(resolvedFolderPath);
            navigateSidebarToFolder(resolvedFolderPath);
            return true;
        }

        return await playDroppedLibraryFolder(resolvedFolderPath);
    };

    const submitSidebarQueueFeedback = async (trackIndex: number | null, score: ListenBrainzFeedbackScore): Promise<void> => {
        if (trackIndex === null) {
            return;
        }

        const track = context.tracks[trackIndex];
        if (!track) {
            return;
        }

        await context.ensureTrackTagsResolved(trackIndex);
        const latestTrack = context.tracks[trackIndex];
        const recordingMbid = latestTrack ? (latestTrack.mbIds.recordingId || '').trim() : '';
        if (recordingMbid === '') {
            context.openErrorModal('Missing MusicBrainz Recording ID', 'This track does not have a recording MBID, so Love/Hate cannot be submitted. Tag the file using MusicBrainz Picard first.');
            return;
        }

        await context.submitListenBrainzFeedbackForTrack(trackIndex, score);
    };

    const openTrackMetaMenu = (
        clientX: number,
        clientY: number,
        includeFolderAction: boolean,
        copyAction: 'none' | 'file' | 'folder',
        actionScope: CustomSendToActionScope | null,
        actionPath: string,
        artistFilterQuery = '',
        showArtistFilterAction = false,
    ): void => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        closePlayOrderMenu();
        context.closeListenBrainzFeedbackMenu();
        context.trackMetaCopyFilePathBtn.hidden = copyAction !== 'file';
        context.trackMetaCopyFolderPathBtn.hidden = copyAction !== 'folder';
        context.trackMetaCopyDivider.hidden = copyAction === 'none';
        context.trackMetaParentFolderBtn.hidden = !includeFolderAction;
        context.trackMetaBrowserFolderBtn.hidden = !includeFolderAction;
        context.trackMetaMenuActionScope = actionScope;
        context.trackMetaMenuActionPath = actionPath.trim();
        context.trackMetaArtistFilterQuery = showArtistFilterAction ? artistFilterQuery.trim() : '';
        const showArtistFilter = showArtistFilterAction && context.trackMetaArtistFilterQuery !== '';
        context.trackMetaFilterArtistBtn.hidden = !showArtistFilter;
        context.trackMetaArtistDivider.hidden = !showArtistFilter;
        const scopedActions = actionScope === null ? [] : sendToActionsForScope(actionScope);
        const showScopedActions = scopedActions.length > 0 && context.trackMetaMenuActionPath !== '';
        context.trackMetaSendToDivider.hidden = !showScopedActions;
        if (showScopedActions) {
            renderSendToButtons(context.trackMetaSendToList, scopedActions, 'track-meta-menu-item');
        } else {
            context.trackMetaSendToList.innerHTML = '';
        }
        context.trackMetaMenu.hidden = false;
        scheduleMenuPosition(
            context.trackMetaMenu,
            clientX,
            clientY,
            pendingTrackMetaMenuPositionFrame,
            (frameId) => {
                pendingTrackMetaMenuPositionFrame = frameId;
            },
        );
    };

    const navigateSidebarToFolder = (nextFolderPath: string): void => {
        context.libraryController.navigateToFolder(nextFolderPath);
    };

    const openCurrentTrackFolderInSidebar = (): void => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        const targetFolderPath = context.tracks[context.currentTrackIndex].folderPath || '';
        context.sidebarController.showLibrary();
        context.libraryController.setSidebarAutoFolderPath(targetFolderPath);

        if (!context.libraryController.isSidebarOpen()) {
            context.libraryController.setSidebarOpen(true);
            return;
        }

        navigateSidebarToFolder(targetFolderPath);
    };

    const openCurrentTrackFolderInFileBrowser = async (): Promise<void> => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        const trackPath = context.tracks[context.currentTrackIndex].path || '';
        if (trackPath !== '') {
            try {
                await OpenFolderInFileBrowser(trackPath);
            } catch (error) {
                console.error(error);
            }
        }
    };

    const openSidebarQueueItemInFileBrowser = async (): Promise<void> => {
        const folderTarget = context.sidebarQueueFolderTarget;
        const targetPath = (folderTarget ? context.sidebarQueueFolderPath : context.sidebarQueueFileActionPath).trim();
        if (targetPath === '') {
            return;
        }

        try {
            if (folderTarget) {
                await OpenFolderInFileBrowser(targetPath);
                return;
            }

            await openFileInBrowser(targetPath);
        } catch (error) {
            console.error(error);
        }
    };

    const copyCurrentTrackFilePath = async (): Promise<void> => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        const trackPath = (context.tracks[context.currentTrackIndex].path || '').trim();
        if (trackPath !== '') {
            try {
                await ClipboardSetText(trackPath);
            } catch (error) {
                console.error(error);
            }
        }
    };

    const copyCurrentTrackFolderPath = async (): Promise<void> => {
        if (context.currentTrackIndex < 0 || context.currentTrackIndex >= context.tracks.length) {
            return;
        }

        const folderPath = (context.tracks[context.currentTrackIndex].folderPath || '').trim();
        if (folderPath !== '') {
            try {
                await ClipboardSetText(folderPath);
            } catch (error) {
                console.error(error);
            }
        }
    };

    const updatePlayOrderMenuState = (): void => {
        const playbackOrderMode = context.playbackSequencingService.getPlaybackOrderMode();
        const items = context.playOrderMenu.querySelectorAll('.play-order-item');
        items.forEach((item: Element) => {
            if (!(item instanceof HTMLButtonElement)) {
                return;
            }

            const mode = item.dataset.playOrder as PlaybackOrderMode | undefined;
            if (mode) {
                item.textContent = playbackOrderMenuItemLabel(mode);
            }
            const selected = mode === playbackOrderMode;
            item.setAttribute('aria-checked', selected ? 'true' : 'false');
            item.dataset.selected = selected ? 'true' : 'false';
        });

        context.playPause.title = `Playback order: ${playbackOrderMenuItemLabel(playbackOrderMode)} (right-click to change)`;
    };

    const openPlayOrderMenu = (clientX: number, clientY: number): void => {
        closeTrackMetaMenu();
        context.closeListenBrainzFeedbackMenu();
        updatePlayOrderMenuState();
        context.playOrderMenu.hidden = false;
        scheduleMenuPosition(
            context.playOrderMenu,
            clientX,
            clientY,
            pendingPlayOrderMenuPositionFrame,
            (frameId) => {
                pendingPlayOrderMenuPositionFrame = frameId;
            },
        );
    };

    return {
        addSidebarSelectionToPlaylist,
        captureSidebarQueueSelectionContext,
        closePlayOrderMenu,
        closeQueueConfirmModal,
        closeSidebarQueueMenu,
        closeTrackMetaMenu,
        copyCurrentTrackFilePath,
        copyCurrentTrackFolderPath,
        handleDroppedFolderPath,
        logSendToFrontend,
        openCurrentTrackFolderInFileBrowser,
        openCurrentTrackFolderInSidebar,
        openSidebarQueueItemInFileBrowser,
        openPlayOrderMenu,
        openQueueConfirmModal,
        openSidebarQueueMenu,
        openTrackMetaMenu,
        playDroppedTrackPath,
        playSidebarQueueSelection,
        resolveSidebarQueueTrackIndexesForAction,
        runCustomSendToAction,
        sendToActionsForScope,
        submitSidebarQueueFeedback,
        updatePlayOrderMenuState,
    };
};