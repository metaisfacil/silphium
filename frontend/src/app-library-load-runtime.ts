import { appendIndexedFilesToScanCollections, clearLibraryRuntimeData, createScanCollections, mapLibraryScanResult } from './services/library-data-service';
import type {
    AppSettings,
    AudioOutputDevice,
    AudioPlaybackState,
    ImageLibraryFile,
    LibraryIndexedFilePage,
    LibraryScanProgress,
    LibraryScanResult,
    MusicBrainzTagWorkerProgress,
    PlayerCardLayout,
    TextLibraryFile,
    Track,
} from './types/app-types';
import { updateExplorationButton } from './components/media-controls-exploration';
import { applyMbLinks } from './musicbrainz';
import type { LibrarySearchStateSnapshot } from './controllers/library-controller-types';
import { setTechnicalLabel } from './utils/display-helpers';

export interface AppLibraryLoadRuntimeContext {
    libraryIndexedFilePageSize: number;
    selectedLibraryRootLabel: string;
    objectUrls: string[];
    tracks: Track[];
    textFiles: TextLibraryFile[];
    imageFiles: ImageLibraryFile[];
    currentTrackIndex: number;
    currentSettings: AppSettings;
    currentMusicBrainzTagWorkerProgress: MusicBrainzTagWorkerProgress;
    availableAudioOutputDevices: AudioOutputDevice[];
    libraryTotalLoadEstimateMs: number;
    libraryClientFinalizeEstimateMs: number;
    activeLibraryLoadScanResolvedAtMs: number | null;
    fullLibraryScanLoadActive: boolean;
    suppressAutoSelectAfterFullLibraryScan: boolean;
    trackIndexByPath: Map<string, number>;
    textFileIndexByPath: Map<string, number>;
    imageFileIndexByPath: Map<string, number>;
    trackTitle: HTMLElement;
    trackAlbum: HTMLElement;
    trackPosition: HTMLElement;
    trackArtist: HTMLElement;
    trackTechnical: HTMLButtonElement;
    trackTechnicalAlt: HTMLButtonElement;
    trackArtistHeader: HTMLElement;
    trackReleaseAlbum: HTMLElement;
    trackReleaseLabel: HTMLElement;
    trackReleaseCat: HTMLElement;
    trackReleaseYear: HTMLElement;
    trackTitleInline: HTMLElement;
    trackGenreInline: HTMLElement;
    lyricsContent: HTMLElement;
    playerLane: HTMLElement;
    lyricsPanel: HTMLElement;
    coverArt: HTMLImageElement;
    coverArtBackground: HTMLImageElement;
    aboutVersion: HTMLElement;
    closeSidebarQueueMenu: () => void;
    closeListenBrainzFeedbackMenu: () => void;
    closeMusicBrainzEntityModal: () => void;
    closeTechnicalInfoModal: () => void;
    clearReplayGainReleaseDynamicRangeCache: () => void;
    audioStop: () => Promise<AudioPlaybackState>;
    applyPlaybackState: (state: AudioPlaybackState) => void;
    handleAudioError: (error: unknown) => void;
    clearCoverArtCache: () => void;
    clearResolvedCoverArtCache: () => void;
    clearArtistInfoCache: () => void;
    clearImageModalCache: () => void;
    resetLibraryState: () => void;
    resetPlaylistState: () => void;
    resetScrobbleState: () => void;
    resetShuffleHistory: () => void;
    setBackgroundCover: (coverSrc?: string) => void;
    setCoverFlipped: (flipped: boolean) => void;
    resetArtistInfoPanel: () => void;
    renderLibraryFolder: () => void;
    updateMediaSessionMetadata: () => void;
    beginLibraryLoadTracking: () => void;
    markLibraryScanResolved: () => void;
    finishLibraryLoadTracking: () => void;
    scanConfiguredLibraryFoldersBackend: () => Promise<LibraryScanResult>;
    setLibraryLoading: (loading: boolean) => void;
    setLibraryLoadingEtaSeconds: (value: number | null) => void;
    setLibraryLoadingStatusLabel: (value: string) => void;
    setLibraryPathMessage: (value: string) => void;
    setForceReloadEtaSeconds: (value: number | null) => void;
    setLibraryRootName: (value: string) => void;
    setLibraryIndexTruncated: (value: boolean) => void;
    getLibraryRootName: () => string;
    getCurrentFolderPath: () => string;
    setCurrentFolderPath: (value: string) => void;
    getLibrarySearchStateSnapshot: () => LibrarySearchStateSnapshot | null;
    restoreLibrarySearchState: (snapshot: LibrarySearchStateSnapshot) => void;
    navigateToFolder: (folderPath: string) => void;
    rebuildLibraryTree: (rootName: string, truncated: boolean, tracks: Track[], textFiles: TextLibraryFile[], imageFiles: ImageLibraryFile[]) => Promise<void>;
    firstTrackIndexFromRandomAlbumFolder: () => number;
    getPlaybackState: () => AudioPlaybackState;
    loadTrack: (index: number) => Promise<void>;
    updatePlayButton: () => void;
    refreshPlaylistOpenModal: () => void;
    scheduleLibraryIncrementalFolderRefresh: () => void;
    scheduleNowPlayingCoverRefresh: () => void;
    refreshOverviewDashboard?: () => void;
    applyPlayerCardLayout: (layout: PlayerCardLayout) => void;
    getStoredLayout: () => PlayerCardLayout;
    resetListenBrainzFeedbackState: () => void;
    listAudioOutputDevices: () => Promise<AudioOutputDevice[]>;
    getSettings: () => Promise<AppSettings>;
    setLissajousEnabled: (enabled: boolean) => void;
    applyUiDitheringSetting: () => void;
    handleSocialSettingsChanged: () => void;
    getMusicBrainzTagWorkerProgress: () => Promise<MusicBrainzTagWorkerProgress>;
    setMusicBrainzTagWorkerProgress: (value: MusicBrainzTagWorkerProgress) => void;
    setPlaybackOrderMode: (mode: AppSettings['playbackOrder']) => void;
    completeStartupIfReady: () => Promise<void>;
    refreshListenBrainzFeedbackForCurrentTrack: (force?: boolean) => Promise<void>;
    getAppVersion: () => Promise<string>;
    ensureTrackIndexForPath?: (path: string) => number;
    rebuildTrackPathIndex: () => void;
    rebuildTextFilePathIndex: () => void;
    rebuildImageFilePathIndex: () => void;
    setFolderCoverPath: (folder: string, coverPath: string) => void;
    logRescan: (message: string, ...args: unknown[]) => void;
    loadIndexedFilePage: (kind: 'track' | 'text-file' | 'image-file', offset: number, limit: number) => Promise<LibraryIndexedFilePage>;
}

export const createAppLibraryLoadRuntime = (context: AppLibraryLoadRuntimeContext) => {
    let deferredHydrationPending = false;
    let deferredHydrationLoadInFlight = false;
    let deferredHydrationBootstrapInFlight = false;
    let libraryScanLoadInFlight = false;
    let queuedDeferredHydrationScanResult: LibraryScanResult | null = null;
    let historicalTotalLoadEtaHandle: number | null = null;
    let historicalTotalLoadEtaStartedAtMs: number | null = null;

    const setFinalizingLibraryStatus = (): void => {
        context.setLibraryLoadingStatusLabel('Finalizing library...');
        context.setLibraryLoadingEtaSeconds(null);
        context.setForceReloadEtaSeconds(null);
    };

    const setScanningLibraryStatus = (): void => {
        context.setLibraryLoadingStatusLabel('Scanning library folders...');
        context.setLibraryLoadingEtaSeconds(null);
        context.setForceReloadEtaSeconds(null);
    };

    const setLoadingLibraryFilesStatus = (): void => {
        context.setLibraryPathMessage('Loading library files…');
        context.setLibraryLoadingStatusLabel('Loading library files...');
        context.setLibraryLoadingEtaSeconds(null);
        context.setForceReloadEtaSeconds(null);
    };

    const stopHistoricalTotalLoadEtaCountdown = (): void => {
        if (historicalTotalLoadEtaHandle !== null) {
            window.clearInterval(historicalTotalLoadEtaHandle);
            historicalTotalLoadEtaHandle = null;
        }

        historicalTotalLoadEtaStartedAtMs = null;
    };

    const historicalTotalLoadEtaSeconds = (): number | null => {
        if (historicalTotalLoadEtaStartedAtMs === null || context.libraryTotalLoadEstimateMs <= 0) {
            return null;
        }

        const elapsedMs = Math.max(0, performance.now() - historicalTotalLoadEtaStartedAtMs);
        const remainingMs = Math.max(0, context.libraryTotalLoadEstimateMs - elapsedMs);
        if (remainingMs <= 0) {
            return null;
        }

        return Math.max(1, Math.ceil(remainingMs / 1000));
    };

    const syncHistoricalTotalLoadEta = (): void => {
        const etaSeconds = historicalTotalLoadEtaSeconds();
        if (etaSeconds === null) {
            if (context.fullLibraryScanLoadActive && context.activeLibraryLoadScanResolvedAtMs === null) {
                setScanningLibraryStatus();
                return;
            }

            context.setLibraryLoadingStatusLabel('');
        }

        context.setLibraryLoadingEtaSeconds(etaSeconds);
        context.setForceReloadEtaSeconds(etaSeconds);
    };

    const startHistoricalTotalLoadEtaCountdown = (): void => {
        stopHistoricalTotalLoadEtaCountdown();
        if (context.libraryTotalLoadEstimateMs <= 0) {
            return;
        }

        historicalTotalLoadEtaStartedAtMs = performance.now();
        syncHistoricalTotalLoadEta();
        historicalTotalLoadEtaHandle = window.setInterval(() => {
            if (!context.fullLibraryScanLoadActive) {
                stopHistoricalTotalLoadEtaCountdown();
                return;
            }

            syncHistoricalTotalLoadEta();
        }, 1000);
    };

    const hasDeferredHydrationWork = (scanResult: LibraryScanResult): boolean => {
        if (!scanResult.deferredFiles) {
            return false;
        }

        return (scanResult.trackCount || 0) > 0
            || (scanResult.textFileCount || 0) > 0
            || (scanResult.imageFileCount || 0) > 0;
    };

    const hasCompleteLibraryPayload = (scanResult: LibraryScanResult): boolean => {
        const trackCount = Math.max(scanResult.trackCount || 0, (scanResult.trackFiles || []).length);
        const textFileCount = Math.max(scanResult.textFileCount || 0, (scanResult.textFiles || []).length);

        return (scanResult.trackFiles || []).length >= trackCount
            && (scanResult.textFiles || []).length >= textFileCount;
    };

    const requiresPagedIndexedFileTransfer = (scanResult: LibraryScanResult): boolean => {
        if (scanResult.deferredFiles) {
            return false;
        }

        return !hasCompleteLibraryPayload(scanResult);
    };

    const loadLibraryScanWithExclusion = async (
        scanResult: LibraryScanResult,
        options?: { autoSelectStartingTrack?: boolean; preserveFolderView?: boolean; currentFolderPath?: string },
    ): Promise<void> => {
        libraryScanLoadInFlight = true;
        try {
            await loadLibraryScan(scanResult, options);
        } finally {
            libraryScanLoadInFlight = false;
        }
    };

    const completeDeferredHydrationLoad = async (scanResult: LibraryScanResult): Promise<void> => {
        deferredHydrationLoadInFlight = true;
        queuedDeferredHydrationScanResult = null;
        const requiresPagedTransfer = requiresPagedIndexedFileTransfer(scanResult);
        try {
            stopHistoricalTotalLoadEtaCountdown();
            if (requiresPagedTransfer) {
                setLoadingLibraryFilesStatus();
            } else {
                context.markLibraryScanResolved();
                context.setLibraryLoadingStatusLabel('');
            }

            if (!requiresPagedTransfer && context.libraryClientFinalizeEstimateMs > 0) {
                const finalizeEtaSeconds = Math.max(1, Math.ceil(context.libraryClientFinalizeEstimateMs / 1000));
                context.setLibraryLoadingEtaSeconds(finalizeEtaSeconds);
                context.setForceReloadEtaSeconds(finalizeEtaSeconds);
            }
            await loadLibraryScanWithExclusion(scanResult);
            if (requiresPagedTransfer) {
                context.markLibraryScanResolved();
            }
        } catch (error) {
            console.error(error);
        } finally {
            finishActiveLibraryLoad();
        }
    };

    const finishActiveLibraryLoad = (): void => {
        if (!context.fullLibraryScanLoadActive && !deferredHydrationPending && !deferredHydrationLoadInFlight) {
            return;
        }

        deferredHydrationPending = false;
        deferredHydrationLoadInFlight = false;
        stopHistoricalTotalLoadEtaCountdown();
        context.finishLibraryLoadTracking();
        context.setLibraryLoading(false);
        context.fullLibraryScanLoadActive = false;
        context.suppressAutoSelectAfterFullLibraryScan = false;
    };

    const clearLibrarySelection = async (): Promise<void> => {
        deferredHydrationPending = false;
        deferredHydrationLoadInFlight = false;
        stopHistoricalTotalLoadEtaCountdown();
        context.closeSidebarQueueMenu();
        context.closeListenBrainzFeedbackMenu();
        context.closeMusicBrainzEntityModal();
        context.closeTechnicalInfoModal();
        context.clearReplayGainReleaseDynamicRangeCache();

        try {
            const nextState = await context.audioStop();
            context.applyPlaybackState(nextState);
        } catch (error) {
            context.handleAudioError(error);
        }

        context.objectUrls = clearLibraryRuntimeData({
            objectUrls: context.objectUrls,
            clearCoverArtCache: context.clearCoverArtCache,
            clearArtistInfoCache: context.clearArtistInfoCache,
            clearImageModalCache: context.clearImageModalCache,
            resetLibraryState: context.resetLibraryState,
            resetPlaylistState: context.resetPlaylistState,
        });

        context.tracks = [];
        context.textFiles = [];
        context.imageFiles = [];
        context.trackIndexByPath.clear();
        context.textFileIndexByPath.clear();
        context.imageFileIndexByPath.clear();
        context.refreshOverviewDashboard?.();

        context.currentTrackIndex = -1;
        context.resetScrobbleState();
        context.resetShuffleHistory();

        context.trackTitle.textContent = 'Unknown Title';
        context.trackAlbum.textContent = 'Unknown Album';
        context.trackPosition.textContent = '';
        context.trackArtist.textContent = 'Unknown Artist';
        setTechnicalLabel(context.trackTechnical, '');
        context.trackTechnical.disabled = true;
        setTechnicalLabel(context.trackTechnicalAlt, '');
        context.trackTechnicalAlt.disabled = true;
        context.trackArtistHeader.textContent = '';
        context.trackReleaseAlbum.textContent = '';
        context.trackReleaseLabel.textContent = '';
        context.trackReleaseCat.textContent = '';
        context.trackReleaseYear.textContent = '';
        context.trackTitleInline.textContent = '';
        context.trackGenreInline.textContent = '';
        context.lyricsContent.textContent = '';
        context.playerLane.classList.remove('lyrics-visible');
        context.lyricsPanel.setAttribute('aria-hidden', 'true');
        applyMbLinks(context.trackTitle, context.trackAlbum, context.trackArtist, {});
        applyMbLinks(context.trackTitleInline, context.trackReleaseAlbum, context.trackArtistHeader, {});
        updateExplorationButton(document, undefined);
        context.resetListenBrainzFeedbackState();

        context.coverArt.removeAttribute('src');
        context.coverArtBackground.removeAttribute('src');
        context.coverArtBackground.classList.remove('is-visible');
        context.coverArt.classList.remove('is-visible');
        context.setBackgroundCover();
        context.setCoverFlipped(false);
        context.resetArtistInfoPanel();
        context.renderLibraryFolder();
        context.updateMediaSessionMetadata();
    };

    const updateLibraryLoadingEtaFromProgress = (progress: LibraryScanProgress): void => {
        const normalizedPhase = String(progress?.phase || '').trim().toLowerCase();
        const includeClientTail = normalizedPhase === 'finalizing';
        const clientTailSeconds = includeClientTail && context.libraryClientFinalizeEstimateMs > 0
            ? Math.max(1, Math.ceil(context.libraryClientFinalizeEstimateMs / 1000))
            : 0;
        const historicalEtaSeconds = historicalTotalLoadEtaSeconds();

        if (!progress || !Number.isFinite(progress.etaSeconds)) {
            context.setLibraryLoadingStatusLabel('');
            const fallbackEtaSeconds = historicalEtaSeconds ?? (clientTailSeconds > 0 ? clientTailSeconds : null);
            context.setLibraryLoadingEtaSeconds(fallbackEtaSeconds);
            context.setForceReloadEtaSeconds(fallbackEtaSeconds);
            return;
        }

        if (normalizedPhase === 'finalizing' && progress.etaSeconds <= 0 && clientTailSeconds <= 0) {
            stopHistoricalTotalLoadEtaCountdown();
            setFinalizingLibraryStatus();
            return;
        }

        context.setLibraryLoadingStatusLabel('');
        stopHistoricalTotalLoadEtaCountdown();
        const backendSeconds = Math.max(0, Math.ceil(progress.etaSeconds));
        const blendedEtaSeconds = backendSeconds + clientTailSeconds;
        const nextEtaSeconds = blendedEtaSeconds > 0 ? blendedEtaSeconds : null;
        context.setLibraryLoadingEtaSeconds(nextEtaSeconds);
        context.setForceReloadEtaSeconds(nextEtaSeconds);
    };

    const hasConfiguredLibraryFolders = (): boolean => context.currentSettings.libraryFolders.length > 0;

    const initialScanCollectionOptions = {
        includeImageFiles: false,
    } as const;

    const loadPagedScanCollections = async (scanResult: LibraryScanResult) => {
        if (scanResult.deferredFiles) {
            return createScanCollections(scanResult);
        }

        if (!requiresPagedIndexedFileTransfer(scanResult)) {
            return await mapLibraryScanResult(scanResult, initialScanCollectionOptions);
        }

        const scanCollections = createScanCollections(scanResult);
        const totalTrackCount = Math.max(scanResult.trackCount || 0, (scanResult.trackFiles || []).length);
        const totalTextFileCount = Math.max(scanResult.textFileCount || 0, (scanResult.textFiles || []).length);
        const totalFileCount = totalTrackCount + totalTextFileCount;
        let loadedFileCount = 0;
        const transferStartedAtMs = performance.now();

        setLoadingLibraryFilesStatus();

        const updateTransferEta = (): void => {
            if (totalFileCount <= 0 || loadedFileCount <= 0) {
                return;
            }

            const elapsedTransferMs = Math.max(1, performance.now() - transferStartedAtMs);
            const measuredRemainingMs = loadedFileCount < totalFileCount
                ? Math.max(0, (elapsedTransferMs / loadedFileCount) * (totalFileCount - loadedFileCount))
                : 0;

            const remainingMs = measuredRemainingMs;
            if (remainingMs > 0) {
                context.setLibraryLoadingStatusLabel('');
                context.setLibraryLoadingEtaSeconds(Math.max(1, Math.ceil(remainingMs / 1000)));
                context.setForceReloadEtaSeconds(Math.max(1, Math.ceil(remainingMs / 1000)));
            }
        };

        const pageKinds = [
            { kind: 'track' as const, totalEntries: totalTrackCount },
            { kind: 'text-file' as const, totalEntries: totalTextFileCount },
        ];

        for (const pageKind of pageKinds) {
            for (let offset = 0; offset < pageKind.totalEntries; offset += context.libraryIndexedFilePageSize) {
                const page = await context.loadIndexedFilePage(pageKind.kind, offset, context.libraryIndexedFilePageSize);
                const entries = page.entries || [];
                await appendIndexedFilesToScanCollections(scanCollections, pageKind.kind, entries, initialScanCollectionOptions);
                loadedFileCount += entries.length;
                updateTransferEta();
            }
        }

        context.setLibraryLoadingStatusLabel('');
        return scanCollections;
    };

    const loadLibraryScan = async (scanResult: LibraryScanResult, options?: { autoSelectStartingTrack?: boolean; preserveFolderView?: boolean; currentFolderPath?: string }): Promise<void> => {
        const startTime = performance.now();
        context.logRescan('loadLibraryScan START: preserveFolderView=%s, %d tracks, %d text, %d images',
            options?.preserveFolderView || false, scanResult.trackCount, scanResult.textFileCount, scanResult.imageFileCount);

        if (!scanResult) {
            return;
        }

        let stepTime = performance.now();
        context.closeSidebarQueueMenu();
        context.closeMusicBrainzEntityModal();
        context.closeTechnicalInfoModal();
        context.clearReplayGainReleaseDynamicRangeCache();
        context.logRescan('  - closed modals: %.2fms', performance.now() - stepTime);

        const playbackStateBeforeScanSwap = context.getPlaybackState();
        const preserveManualTrackPlayback = context.suppressAutoSelectAfterFullLibraryScan
            && playbackStateBeforeScanSwap.loaded
            && playbackStateBeforeScanSwap.sourcePath.trim() !== '';
        const previouslyPlayingTrack = preserveManualTrackPlayback && context.currentTrackIndex >= 0 && context.currentTrackIndex < context.tracks.length
            ? context.tracks[context.currentTrackIndex]
            : null;

        if (!preserveManualTrackPlayback) {
            try {
                stepTime = performance.now();
                const nextState = await context.audioStop();
                context.applyPlaybackState(nextState);
                context.logRescan('  - audio stop: %.2fms', performance.now() - stepTime);
            } catch (error) {
                context.handleAudioError(error);
            }
        } else {
            context.logRescan('  - preserving manual playback during scan swap');
        }

        stepTime = performance.now();
        const scanCollections = await loadPagedScanCollections(scanResult);
        context.logRescan('  - loaded paged collections: %.2fms', performance.now() - stepTime);

        const previousRootName = context.getLibraryRootName().trim();
        const nextRootName = context.selectedLibraryRootLabel;
        const canPreserveExistingFolderView = previousRootName !== '' && previousRootName === nextRootName;
        const folderPathBeforeSwap = canPreserveExistingFolderView
            ? context.getCurrentFolderPath()
            : '';
        const searchStateBeforeSwap = canPreserveExistingFolderView
            ? context.getLibrarySearchStateSnapshot()
            : null;
        const shouldRestoreSearchState = (searchStateBeforeSwap?.query || '').trim() !== '';

        stepTime = performance.now();
        context.objectUrls = clearLibraryRuntimeData({
            objectUrls: context.objectUrls,
            clearCoverArtCache: context.clearCoverArtCache,
            clearArtistInfoCache: context.clearArtistInfoCache,
            resetLibraryState: context.resetLibraryState,
            resetPlaylistState: context.resetPlaylistState,
        });
        context.logRescan('  - cleared runtime data: %.2fms', performance.now() - stepTime);

        stepTime = performance.now();
        context.tracks = scanCollections.tracks;
        context.textFiles = scanCollections.textFiles;
        context.imageFiles = scanCollections.imageFiles;
        context.rebuildTrackPathIndex();
        context.rebuildTextFilePathIndex();
        context.rebuildImageFilePathIndex();
        context.refreshOverviewDashboard?.();

        if (preserveManualTrackPlayback) {
            const normalizedSourcePath = playbackStateBeforeScanSwap.sourcePath.trim().toLowerCase();
            context.currentTrackIndex = normalizedSourcePath
                ? context.tracks.findIndex((candidate) => candidate.path.toLowerCase() === normalizedSourcePath)
                : -1;

            if (context.currentTrackIndex < 0 && previouslyPlayingTrack) {
                const normalizedPreviousRelativePath = previouslyPlayingTrack.relativePath.trim().toLowerCase();
                if (normalizedPreviousRelativePath) {
                    context.currentTrackIndex = context.tracks.findIndex((candidate) => {
                        return candidate.relativePath.trim().toLowerCase() === normalizedPreviousRelativePath;
                    });
                }

                if (context.currentTrackIndex < 0) {
                    const normalizedPreviousName = previouslyPlayingTrack.name.trim().toLowerCase();
                    if (normalizedPreviousName) {
                        context.currentTrackIndex = context.tracks.findIndex((candidate) => {
                            return candidate.name.trim().toLowerCase() === normalizedPreviousName;
                        });
                    }
                }
            }

            if (context.currentTrackIndex >= 0) {
                if (previouslyPlayingTrack && previouslyPlayingTrack.path.toLowerCase() === context.tracks[context.currentTrackIndex].path.toLowerCase()) {
                    context.tracks[context.currentTrackIndex] = {
                        ...context.tracks[context.currentTrackIndex],
                        title: previouslyPlayingTrack.title,
                        displayTitle: previouslyPlayingTrack.displayTitle,
                        displayAlbum: previouslyPlayingTrack.displayAlbum,
                        displayArtist: previouslyPlayingTrack.displayArtist,
                        displayTrackNumber: previouslyPlayingTrack.displayTrackNumber,
                        displayTrackTotal: previouslyPlayingTrack.displayTrackTotal,
                        displayTechnical: previouslyPlayingTrack.displayTechnical,
                        displayLyrics: previouslyPlayingTrack.displayLyrics,
                        tagsResolved: previouslyPlayingTrack.tagsResolved,
                        mbMetadataResolved: previouslyPlayingTrack.mbMetadataResolved,
                        technicalDetails: { ...previouslyPlayingTrack.technicalDetails },
                        allFileTags: { ...previouslyPlayingTrack.allFileTags },
                        mbIds: { ...previouslyPlayingTrack.mbIds },
                        artistMbids: [...previouslyPlayingTrack.artistMbids],
                        mbArtistCredits: [...previouslyPlayingTrack.mbArtistCredits],
                    };
                }
            }
        }

        context.logRescan('  - updated indices: %.2fms', performance.now() - stepTime);

        stepTime = performance.now();
        for (const [folder, coverPath] of scanCollections.coverPathEntries) {
            context.setFolderCoverPath(folder, coverPath);
        }
        context.logRescan('  - set cover paths: %.2fms', performance.now() - stepTime);

        stepTime = performance.now();
        await context.rebuildLibraryTree(
            context.selectedLibraryRootLabel,
            scanResult.truncated,
            context.tracks,
            context.textFiles,
            context.imageFiles,
        );
        context.logRescan('  - rebuilt library tree: %.2fms', performance.now() - stepTime);

        if (context.tracks.length === 0 && (scanResult.trackCount || 0) === 0) {
            context.logRescan('loadLibraryScan: no tracks found');
            context.closeListenBrainzFeedbackMenu();
            context.currentTrackIndex = -1;
            context.setCurrentFolderPath('');
            context.trackTitle.textContent = 'No audio tracks found';
            context.trackAlbum.textContent = 'Unknown Album';
            context.trackPosition.textContent = '';
            context.trackArtist.textContent = 'Unknown Artist';
            setTechnicalLabel(context.trackTechnical, '');
            context.trackTechnical.disabled = true;
            setTechnicalLabel(context.trackTechnicalAlt, '');
            context.trackTechnicalAlt.disabled = true;
            context.trackArtistHeader.textContent = '';
            context.trackReleaseAlbum.textContent = '';
            context.trackReleaseLabel.textContent = '';
            context.trackReleaseCat.textContent = '';
            context.trackReleaseYear.textContent = '';
            context.trackTitleInline.textContent = '';
            context.trackGenreInline.textContent = '';
            context.lyricsContent.textContent = '';
            context.playerLane.classList.remove('lyrics-visible');
            context.lyricsPanel.setAttribute('aria-hidden', 'true');
            context.coverArt.removeAttribute('src');
            context.coverArtBackground.removeAttribute('src');
            context.coverArtBackground.classList.remove('is-visible');
            context.coverArt.classList.remove('is-visible');
            context.setBackgroundCover();
            context.setCoverFlipped(false);
            context.resetArtistInfoPanel();
            updateExplorationButton(document, undefined);
            context.resetListenBrainzFeedbackState();
            if (shouldRestoreSearchState && searchStateBeforeSwap) {
                context.restoreLibrarySearchState(searchStateBeforeSwap);
            } else {
                context.renderLibraryFolder();
            }
            context.refreshPlaylistOpenModal();
            context.logRescan('loadLibraryScan END: total time %.2fms (no tracks)', performance.now() - startTime);
            return;
        }

        if (shouldRestoreSearchState && searchStateBeforeSwap) {
            context.restoreLibrarySearchState(searchStateBeforeSwap);
        } else {
            const preferredFolderPath = options?.currentFolderPath ?? folderPathBeforeSwap;
            if (preferredFolderPath) {
                context.navigateToFolder(preferredFolderPath);
            } else {
                context.setCurrentFolderPath('');
                context.renderLibraryFolder();
            }
        }

        if (!options?.preserveFolderView) {
            context.resetShuffleHistory();

            const playbackStateAfterScanSwap = context.getPlaybackState();
            const hasActivePlaybackAfterScanSwap = playbackStateAfterScanSwap.loaded
                && playbackStateAfterScanSwap.playing
                && playbackStateAfterScanSwap.sourcePath.trim() !== '';

            if (context.tracks.length > 0 && options?.autoSelectStartingTrack !== false && !context.suppressAutoSelectAfterFullLibraryScan && !hasActivePlaybackAfterScanSwap) {
                const startingTrackIndex = context.firstTrackIndexFromRandomAlbumFolder();
                void context.loadTrack(startingTrackIndex);
            }
        }

        context.updatePlayButton();
        context.refreshPlaylistOpenModal();
        context.logRescan('loadLibraryScan END: total time %.2fms', performance.now() - startTime);
    };

    const scanConfiguredLibraryFolders = async (): Promise<void> => {
        if (!hasConfiguredLibraryFolders()) {
            await clearLibrarySelection();
            return;
        }

        deferredHydrationPending = false;
        deferredHydrationLoadInFlight = false;
        deferredHydrationBootstrapInFlight = true;
        context.fullLibraryScanLoadActive = true;
        context.suppressAutoSelectAfterFullLibraryScan = false;
        context.beginLibraryLoadTracking();
        context.setLibraryLoading(true);
        context.setLibraryLoadingEtaSeconds(null);
        context.setLibraryLoadingStatusLabel('');
        startHistoricalTotalLoadEtaCountdown();
        let keepLoadingForDeferredHydration = false;
        try {
            context.setLibraryPathMessage(context.currentSettings.libraryFolders.length > 1 ? 'Scanning library folders…' : 'Scanning folder…');
            const scanResult = await context.scanConfiguredLibraryFoldersBackend();
            const requiresPagedTransfer = requiresPagedIndexedFileTransfer(scanResult);
            if (!scanResult.deferredFiles) {
                stopHistoricalTotalLoadEtaCountdown();
                if (requiresPagedTransfer) {
                    setLoadingLibraryFilesStatus();
                } else {
                    context.markLibraryScanResolved();
                }

                if (!requiresPagedTransfer && context.libraryClientFinalizeEstimateMs > 0) {
                    const finalizeEtaSeconds = Math.max(1, Math.ceil(context.libraryClientFinalizeEstimateMs / 1000));
                    context.setLibraryLoadingEtaSeconds(finalizeEtaSeconds);
                    context.setForceReloadEtaSeconds(finalizeEtaSeconds);
                }
            }
            keepLoadingForDeferredHydration = hasDeferredHydrationWork(scanResult);
            deferredHydrationPending = keepLoadingForDeferredHydration;
            deferredHydrationBootstrapInFlight = false;
            await loadLibraryScanWithExclusion(scanResult);
            if (!scanResult.deferredFiles && requiresPagedTransfer) {
                context.markLibraryScanResolved();
            }
            if (keepLoadingForDeferredHydration && queuedDeferredHydrationScanResult && !queuedDeferredHydrationScanResult.deferredFiles) {
                keepLoadingForDeferredHydration = false;
                await completeDeferredHydrationLoad(queuedDeferredHydrationScanResult);
            }
            deferredHydrationPending = keepLoadingForDeferredHydration;
        } finally {
            deferredHydrationBootstrapInFlight = false;
            if (!keepLoadingForDeferredHydration) {
                finishActiveLibraryLoad();
            }
        }
    };

    const handleLibraryScanUpdatedEvent = async (scanResult: LibraryScanResult): Promise<void> => {
        const startTime = performance.now();
        context.logRescan('handleLibraryScanUpdatedEvent START: %d tracks, %d text, %d images',
            scanResult.trackCount, scanResult.textFileCount, scanResult.imageFileCount);

        if (!hasConfiguredLibraryFolders() || !scanResult) {
            return;
        }

        const shouldTreatAsDeferredHydrationCompletion = !scanResult.deferredFiles
            && !deferredHydrationLoadInFlight
            && context.fullLibraryScanLoadActive
            && context.activeLibraryLoadScanResolvedAtMs === null
            && (deferredHydrationPending || deferredHydrationBootstrapInFlight);

        if (shouldTreatAsDeferredHydrationCompletion) {
            if (libraryScanLoadInFlight || deferredHydrationBootstrapInFlight) {
                queuedDeferredHydrationScanResult = scanResult;
                context.logRescan('Queued deferred hydration completion while the startup scan bootstrap is still in flight');
                return;
            }

            await completeDeferredHydrationLoad(scanResult);

            context.logRescan('handleLibraryScanUpdatedEvent END: took %.2fms (hydration complete)', performance.now() - startTime);
            return;
        }

        const previousRootName = context.getLibraryRootName().trim();
        const nextRootName = context.selectedLibraryRootLabel;
        if (!previousRootName || previousRootName !== nextRootName) {
            context.setCurrentFolderPath('');
        }

        context.setLibraryRootName(nextRootName);
        context.setLibraryIndexTruncated(!!scanResult.truncated);
        context.clearResolvedCoverArtCache();
        const playbackState = context.getPlaybackState();
        if (!(playbackState.loaded && playbackState.playing)) {
            context.scheduleLibraryIncrementalFolderRefresh();
        } else {
            context.logRescan('Skipped incremental folder refresh during active playback');
        }
        context.scheduleNowPlayingCoverRefresh();
        context.logRescan('handleLibraryScanUpdatedEvent END: took %.2fms', performance.now() - startTime);
    };

    return {
        clearLibrarySelection,
        handleLibraryScanUpdatedEvent,
        hasConfiguredLibraryFolders,
        loadLibraryScan,
        scanConfiguredLibraryFolders,
        updateLibraryLoadingEtaFromProgress,
    };
};