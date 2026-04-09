import {
    AudioGetVisualizationFrame,
    GetLastFmFollowing,
    GetLastFmFollowingFeed,
    GetLibraryFolderCoverPath,
    GetListenBrainzFollowing,
    GetListenBrainzFollowingFeed,
    GetListenBrainzRecordingFeedback,
    ReadFileBase64,
    ReadTrackEmbeddedCover,
    ReadTrackTags,
    SubmitLastFm,
    SubmitLastFmLove,
    SubmitLastFmUnlove,
    SubmitListenBrainz,
    SubmitListenBrainzRecordingFeedback,
} from '../wailsjs/go/main/App';
import { BrowserOpenURL } from '../wailsjs/runtime/runtime';
import type { AppCoreServicesRuntimeContext } from './app-runtime-setup';
import { createListenBrainzController, type ListenBrainzFeedbackScore } from './controllers/listenbrainz-controller';
import { createListenBrainzSocialController } from './controllers/listenbrainz-social-controller';
import { createSidebarController } from './controllers/sidebar-controller';
import { createVisualizerController } from './controllers/visualizer-controller';
import { createCoverArtService } from './services/cover-art-service';
import { createPlaybackSequencingService } from './services/playback-sequencing-service';
import { createPlaybackStateService } from './services/playback-state-service';
import { createScrobbleService } from './services/scrobble-service';
import { createTrackMetadataService } from './services/track-metadata-service';
import { openMbLink } from './musicbrainz';
import { lookupMusicBrainzTrackMetadata, setMusicBrainzRequestLogServerResolver } from './utils/musicbrainz-entity-helpers';
import { scheduleLastFmRequest } from './utils/lastfm-request-scheduler';
import { scheduleListenBrainzRequest } from './utils/musicbrainz-request-scheduler';
import type { AudioVisualizationFrame, ListenBrainzSocialEvent, PlayerCardLayout, Track } from './types/app-types';
import { firstTagValue, hasActiveSelectionWithin, normalizedTrackNumber } from './utils/display-helpers';

export const createAppCoreServicesRuntime = (context: AppCoreServicesRuntimeContext) => {
    const defaultMusicBrainzServerUrl = 'https://musicbrainz.org';
    const defaultListenBrainzServerUrl = 'https://api.listenbrainz.org';
    const defaultLastFmServerUrl = 'https://ws.audioscrobbler.com/2.0';
    const playerCardLayoutKey = 'playerCardLayout';

    const hasLastFmCredentialsConfigured = (): boolean => context.currentSettings.lastFmApiKey.trim() !== ''
        && context.currentSettings.lastFmApiSecret.trim() !== ''
        && context.currentSettings.lastFmSessionKey.trim() !== '';

    const submitLastFmFeedbackForTrack = async (track: Track, score: ListenBrainzFeedbackScore): Promise<void> => {
        if ((score !== 1 && score !== 0) || !hasLastFmCredentialsConfigured()) {
            return;
        }

        const payload = {
            artistName: track.displayArtist || firstTagValue(track, 'artist') || 'Unknown Artist',
            trackName: track.displayTitle || track.title || track.name,
            releaseName: track.displayAlbum || firstTagValue(track, 'album') || '',
            albumArtist: firstTagValue(track, 'albumartist', 'album artist', 'album_artist') || undefined,
            trackNumber: normalizedTrackNumber(track),
            recordingMbid: track.mbIds.recordingId || undefined,
        };

        await scheduleLastFmRequest(async () => (
            score === 1 ? await SubmitLastFmLove(payload) : await SubmitLastFmUnlove(payload)
        ), {
            server: defaultLastFmServerUrl,
            path: score === 1 ? 'track.love' : 'track.unlove',
        });
    };

    const playbackStateService = createPlaybackStateService(context.playbackSessionState);
    setMusicBrainzRequestLogServerResolver(() => context.currentSettings.musicBrainzServerUrl || defaultMusicBrainzServerUrl);
    const scrobbleService = createScrobbleService({
        submitListenBrainz: async (eventType, payload, listenedAt) => await scheduleListenBrainzRequest(async () => (
            await SubmitListenBrainz(eventType, payload, listenedAt)
        ), {
            server: context.currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
            path: '/1/submit-listens',
        }),
        submitLastFm: async (eventType, payload, listenedAt) => await scheduleLastFmRequest(async () => (
            await SubmitLastFm(eventType, payload, listenedAt)
        ), {
            server: defaultLastFmServerUrl,
            path: eventType === 'playing_now' ? 'track.updateNowPlaying' : 'track.scrobble',
        }),
    }, context.scrobbleSessionState);
    const playbackSequencingService = createPlaybackSequencingService({
        getTracks: () => context.tracks,
        getCurrentTrackIndex: () => context.currentTrackIndex,
        getReleaseDepthForTrack: (track: Track) => context.releaseDepthForTrack(track),
    }, context.playbackSequencingState);
    const trackMetadataService = createTrackMetadataService({
        getTracks: () => context.tracks,
        setTrack: (index: number, track: Track) => {
            context.tracks[index] = track;
        },
        readTrackTags: ReadTrackTags,
        lookupMusicBrainzTrackMetadata: async (releaseId: string) => await lookupMusicBrainzTrackMetadata(releaseId),
        getPreferMusicBrainzMetadata: () => context.currentSettings.preferMusicBrainzMetadata,
        getCurrentTrackIndex: () => context.currentTrackIndex,
        getTagRequestVersion: () => context.tagRequestVersion,
    });
    const coverArtService = createCoverArtService({
        getCoverArtPriority: () => context.currentSettings.coverArtPriority,
        getLibraryFolderCoverPath: async (folderPath: string): Promise<string> => await GetLibraryFolderCoverPath(folderPath) as string,
        readFileBase64: async (filePath: string): Promise<string> => await ReadFileBase64(filePath) as string,
        readTrackEmbeddedCover: async (trackPath: string): Promise<{ base64?: string; mimeType?: string }> => await ReadTrackEmbeddedCover(trackPath) as { base64?: string; mimeType?: string },
        registerObjectUrl: (url: string): void => {
            context.objectUrls.push(url);
        },
    });

    const visualizerController = createVisualizerController({
        canvas: context.playerVisualizerCanvas,
        getPlaybackState: () => playbackStateService.getPlaybackState(),
        fetchVisualizationFrame: async (frameCount: number): Promise<AudioVisualizationFrame> => (
            await AudioGetVisualizationFrame(frameCount) as AudioVisualizationFrame
        ),
        getCoverArtImageSource: () => context.getCoverArtImageSource?.(),
    });
    visualizerController.setMode(context.currentSettings.visualizerMode);
    visualizerController.setEqualizerPosition(context.currentSettings.equalizerPosition);
    visualizerController.setLissajousScale(context.currentSettings.lissajousScale);
    visualizerController.setEnabled(context.currentSettings.lissajousEnabled);

    const listenBrainzController = createListenBrainzController({
        elements: {
            playerCard: context.playerCard,
            listenBrainzLoveBtn: context.listenBrainzLoveBtn,
            listenBrainzFeedbackMenu: context.listenBrainzFeedbackMenu,
            listenBrainzFeedbackLoveBtn: context.listenBrainzFeedbackLoveBtn,
            listenBrainzFeedbackHateBtn: context.listenBrainzFeedbackHateBtn,
        },
        getToken: () => context.currentSettings.listenBrainzUserToken,
        getTracks: () => context.tracks,
        getCurrentTrackIndex: () => context.currentTrackIndex,
        ensureTrackTagsResolved: async (index: number): Promise<void> => {
            await trackMetadataService.ensureTrackTagsResolved(index);
        },
        fetchRecordingFeedback: async (recordingMbid: string): Promise<number> => await scheduleListenBrainzRequest(async () => (
            await GetListenBrainzRecordingFeedback(recordingMbid) as number
        ), {
            server: context.currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
            path: '/1/feedback/user/{user}/get-feedback-for-recordings',
        }),
        submitRecordingFeedback: async (recordingMbid: string, score: ListenBrainzFeedbackScore): Promise<unknown> => await scheduleListenBrainzRequest(async () => (
            await SubmitListenBrainzRecordingFeedback(recordingMbid, score)
        ), {
            server: context.currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
            path: '/1/feedback/recording-feedback',
        }),
        onFeedbackSubmitted: async (track: Track, score: ListenBrainzFeedbackScore): Promise<void> => {
            await submitLastFmFeedbackForTrack(track, score);
        },
        beforeOpenMenu: () => {
            context.closePlayOrderMenu();
            context.closeTrackMetaMenu();
            context.closeSidebarQueueMenu();
            context.playlistController().closeMenu();
        },
    });

    const hasListenBrainzScrobbling = (): boolean => listenBrainzController.canScrobble();
    const hasLastFmScrobbling = (): boolean => hasLastFmCredentialsConfigured();
    const closeListenBrainzFeedbackMenu = (): void => {
        listenBrainzController.closeMenu();
    };
    const resetListenBrainzFeedbackState = (): void => {
        listenBrainzController.resetFeedbackState();
    };
    const refreshListenBrainzFeedbackForCurrentTrack = async (force = false): Promise<void> => {
        await listenBrainzController.refreshFeedbackForCurrentTrack(force);
    };
    const submitListenBrainzFeedbackForTrack = async (trackIndex: number, score: ListenBrainzFeedbackScore): Promise<void> => {
        await listenBrainzController.submitFeedbackForTrack(trackIndex, score);
    };

    const socialController = createListenBrainzSocialController({
        elements: {
            sidebarToggle: context.sidebarToggle,
            sidebarSectionTrigger: context.sidebarSectionTrigger,
            sidebarSectionTriggerLabel: context.sidebarSectionTriggerLabel,
            sidebarSectionMenu: context.sidebarSectionMenu,
            sidebarSectionOptionLibrary: context.sidebarSectionOptionLibrary,
            sidebarSectionOptionSocial: context.sidebarSectionOptionSocial,
            sidebarPaneLibrary: context.sidebarPaneLibrary,
            sidebarPaneSocial: context.sidebarPaneSocial,
            socialFeedStatus: context.socialFeedStatus,
            socialFeedList: context.socialFeedList,
        },
        hasAnyProviderConfigured: () => hasListenBrainzScrobbling() || hasLastFmScrobbling(),
        isSidebarVisible: () => context.app.classList.contains('sidebar-open'),
        fetchFollowingUsers: async (): Promise<string[]> => {
            const providers: Array<Promise<string[]>> = [];

            if (hasListenBrainzScrobbling()) {
                providers.push(scheduleListenBrainzRequest(async () => (
                    await GetListenBrainzFollowing() as string[]
                ), {
                    server: context.currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
                    path: '/1/user/{user}/following',
                }));
            }

            if (hasLastFmScrobbling()) {
                providers.push(scheduleLastFmRequest(async () => (
                    await GetLastFmFollowing() as string[]
                ), {
                    server: defaultLastFmServerUrl,
                    path: 'user.getFriends',
                }));
            }

            const merged = (await Promise.all(providers)).flat();
            return [...new Set(merged.map((name) => name.trim()).filter((name) => name !== ''))].sort((left, right) => left.localeCompare(right));
        },
        fetchFollowingFeed: async (count: number): Promise<ListenBrainzSocialEvent[]> => {
            const providers: Array<Promise<ListenBrainzSocialEvent[]>> = [];

            if (hasListenBrainzScrobbling()) {
                providers.push(scheduleListenBrainzRequest(async () => (
                    await GetListenBrainzFollowingFeed(count) as ListenBrainzSocialEvent[]
                ), {
                    server: context.currentSettings.listenBrainzServerUrl || defaultListenBrainzServerUrl,
                    path: '/1/user/{user}/feed/events/listens/following',
                }));
            }

            if (hasLastFmScrobbling()) {
                providers.push(scheduleLastFmRequest(async () => (
                    await GetLastFmFollowingFeed(count) as ListenBrainzSocialEvent[]
                ), {
                    server: defaultLastFmServerUrl,
                    path: 'user.getRecentTracks',
                }));
            }

            return (await Promise.all(providers)).flat();
        },
        openUserProfile: (provider, userName): void => {
            const encodedUserName = encodeURIComponent(userName);
            const profileUrl = provider === 'lastfm'
                ? `https://www.last.fm/user/${encodedUserName}`
                : `${(context.currentSettings.listenBrainzServerUrl || 'https://listenbrainz.org').replace(/\/+$/, '')}/user/${encodedUserName}/`;

            void BrowserOpenURL(profileUrl);
        },
    });
    const sidebarController = createSidebarController({
        showLibrary: () => {
            socialController.showLibrary();
        },
        showSocial: () => {
            socialController.showSocial();
        },
        isSocialActive: () => socialController.isSocialActive(),
    });

    const openMbOnCtrlClick = (event: MouseEvent, target: HTMLElement): void => {
        if (!event.ctrlKey) {
            return;
        }

        const eventTarget = event.target;
        if (eventTarget instanceof HTMLElement) {
            const nestedLink = eventTarget.closest('[data-mb-url]');
            if (nestedLink instanceof HTMLElement && target.contains(nestedLink)) {
                openMbLink(nestedLink);
                return;
            }
        }

        if (target.dataset.mbUrl) {
            openMbLink(target);
        }
    };

    const setCtrlHeldState = (held: boolean): void => {
        context.app.classList.toggle('ctrl-held', held);
    };

    const getStoredLayout = (): PlayerCardLayout =>
        localStorage.getItem(playerCardLayoutKey) === 'release' ? 'release' : 'default';

    localStorage.removeItem('shareImageComment');

    const applyPlayerCardLayout = (layout: PlayerCardLayout): void => {
        context.playerCard.classList.toggle('layout-release', layout === 'release');
        localStorage.setItem(playerCardLayoutKey, layout);
    };

    const trackMetaClickSuppressDurationMs = 280;
    let suppressTrackMetaClickUntil = 0;

    const suppressTrackMetaClicks = (): void => {
        suppressTrackMetaClickUntil = Date.now() + trackMetaClickSuppressDurationMs;
    };

    const shouldSuppressTrackMetaClick = (): boolean => Date.now() < suppressTrackMetaClickUntil;
    const shouldBlockTrackMetaModalOpen = (): boolean => shouldSuppressTrackMetaClick() || context.app.classList.contains('sidebar-open');

    context.trackTitle.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasActiveSelectionWithin(context.trackTitle)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackTitle);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('recording');
    });
    context.trackTitle.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        context.setTrackMetaMenuTarget(context.trackTitle);
        context.openTrackMetaMenu(event.clientX, event.clientY, true, 'file', 'track', context.tracks[context.currentTrackIndex]?.path || '');
    });
    context.trackAlbum.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasActiveSelectionWithin(context.trackAlbum)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackAlbum);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('release');
    });
    context.trackAlbum.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        context.setTrackMetaMenuTarget(context.trackAlbum);
        context.openTrackMetaMenu(event.clientX, event.clientY, false, 'folder', 'album', context.tracks[context.currentTrackIndex]?.folderPath || '');
    });
    context.trackArtist.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasActiveSelectionWithin(context.trackArtist)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackArtist);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('artist');
    });
    context.trackArtist.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const eventTarget = event.target;
        const nestedLink = eventTarget instanceof HTMLElement
            ? eventTarget.closest('[data-mb-url]')
            : null;
        const firstArtistLink = context.trackArtist.querySelector('[data-mb-url]');
        context.setTrackMetaMenuTarget(
            nestedLink instanceof HTMLElement && context.trackArtist.contains(nestedLink)
                ? nestedLink
                : (firstArtistLink instanceof HTMLElement ? firstArtistLink : context.trackArtist),
        );
        context.openTrackMetaMenu(event.clientX, event.clientY, false, null, null, '');
    });
    context.trackTitleInline.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasActiveSelectionWithin(context.trackTitleInline)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackTitleInline);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('recording');
    });
    context.trackTitleInline.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        context.setTrackMetaMenuTarget(context.trackTitleInline);
        context.openTrackMetaMenu(event.clientX, event.clientY, true, 'file', 'track', context.tracks[context.currentTrackIndex]?.path || '');
    });
    context.trackReleaseAlbum.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasActiveSelectionWithin(context.trackReleaseAlbum)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackReleaseAlbum);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('release');
    });
    context.trackReleaseAlbum.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        context.setTrackMetaMenuTarget(context.trackReleaseAlbum);
        context.openTrackMetaMenu(event.clientX, event.clientY, false, 'folder', 'album', context.tracks[context.currentTrackIndex]?.folderPath || '');
    });
    context.trackReleaseLabel.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasActiveSelectionWithin(context.trackReleaseLabel)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackReleaseLabel);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('label');
    });
    context.trackArtistHeader.addEventListener('click', (event: MouseEvent) => {
        if (shouldBlockTrackMetaModalOpen()) {
            return;
        }

        if (hasActiveSelectionWithin(context.trackArtistHeader)) {
            return;
        }

        if (event.ctrlKey) {
            openMbOnCtrlClick(event, context.trackArtistHeader);
            return;
        }

        void context.openMusicBrainzEntityForCurrentTrack('artist');
    });
    context.trackArtistHeader.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        const eventTarget = event.target;
        const nestedLink = eventTarget instanceof HTMLElement
            ? eventTarget.closest('[data-mb-url]')
            : null;
        const firstArtistLink = context.trackArtistHeader.querySelector('[data-mb-url]');
        context.setTrackMetaMenuTarget(
            nestedLink instanceof HTMLElement && context.trackArtistHeader.contains(nestedLink)
                ? nestedLink
                : (firstArtistLink instanceof HTMLElement ? firstArtistLink : context.trackArtistHeader),
        );
        context.openTrackMetaMenu(event.clientX, event.clientY, false, null, null, '');
    });

    return {
        applyPlayerCardLayout,
        closeListenBrainzFeedbackMenu,
        coverArtService,
        defaultLastFmServerUrl,
        defaultListenBrainzServerUrl,
        defaultMusicBrainzServerUrl,
        getStoredLayout,
        hasLastFmScrobbling,
        hasListenBrainzScrobbling,
        visualizerController,
        listenBrainzController,
        sidebarController,
        socialController,
        playbackSequencingService,
        playbackStateService,
        refreshListenBrainzFeedbackForCurrentTrack,
        resetListenBrainzFeedbackState,
        scrobbleService,
        setCtrlHeldState,
        submitListenBrainzFeedbackForTrack,
        suppressTrackMetaClicks,
        trackMetadataService,
    };
};
