import type { SidebarElements } from '../components/sidebar';
import type { ListenBrainzSocialEvent } from '../types/app-types';

type SidebarSection = 'library' | 'social';

type ListenBrainzSocialControllerOptions = {
    elements: Pick<SidebarElements, 'sidebarToggle' | 'libraryExpandToggle' | 'sidebarSectionTrigger' | 'sidebarSectionTriggerLabel' | 'sidebarSectionMenu' | 'sidebarSectionOptionLibrary' | 'sidebarSectionOptionSocial' | 'sidebarPaneLibrary' | 'sidebarPaneSocial' | 'socialFeedStatus' | 'socialFeedList'>;
    hasAnyProviderConfigured: () => boolean;
    isSidebarVisible: () => boolean;
    fetchFollowingUsers: () => Promise<string[]>;
    fetchFollowingFeed: (count: number) => Promise<ListenBrainzSocialEvent[]>;
    openUserProfile: (provider: 'listenbrainz' | 'lastfm', userName: string) => void | Promise<void>;
    openLocalReleaseFolder: (folderPath: string) => void | Promise<void>;
    openLibrarySearch: (query: string) => void | Promise<void>;
    onShowLibrary?: () => void;
    onShowSocial?: () => void;
};

export type ListenBrainzSocialController = ReturnType<typeof createListenBrainzSocialController>;

type SocialFeedContextMenuTargets = {
    artistName: string;
    releaseName: string;
    trackName: string;
};

const socialFeedPollIntervalMs = 15000;
const socialFeedItemCount = 40;
const socialFeedUpdateAnimationMs = 420;
const sidebarSectionSwitchAnimationMs = 240;

const listenBrainzUserIcon = '<svg class="social-feed-listenbrainz-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 27 30" aria-hidden="true"><polygon fill="#353070" points="13 1 1 8 1 22 13 29 13 1"/><polygon fill="#eb743b" points="14 1 26 8 26 22 14 29 14 1"/></svg>';
const lastFmUserIcon = '<svg class="social-feed-lastfm-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" aria-hidden="true"><g fill-rule="evenodd"><path fill="#fbfbfb" d="M125.78 125.25c-41.65 3.9-63.03 30.12-63.04 77.29-.01 32.45 10.87 53.98 32.86 65.02 22.61 11.35 60.18 9.34 81.94-4.38 3.1-1.96 6.05-4.25 6.05-4.7 0-.58-9.43-25.78-9.8-26.21-.17-.2-1.5.75-2.97 2.1-16.9 15.53-42.34 19.7-57.31 9.4-23.15-15.92-24.22-67.89-1.8-86.25 12.84-10.5 35.78-10.24 48.64.56 8.78 7.37 12.06 14.01 22.47 45.44 8.7 26.26 9.88 29.26 14.56 37.1 14.13 23.7 37.01 34.16 74.69 34.16 42.82 0 64.06-13.2 65.32-40.6.9-19.63-8.18-33.79-26.52-41.36-6.48-2.68-11.19-3.95-27.67-7.48-20.7-4.43-25.12-7.8-25.17-19.15-.05-11.28 7.3-16.78 22.44-16.77 14.42 0 21.45 4.56 23.73 15.35.34 1.65.66 3.05.69 3.1.08.13 30.3-3.4 30.93-3.61 1.99-.67-2.52-14.97-6.65-21.1-15.13-22.46-69.3-24.98-91.27-4.25-14.75 13.92-16.12 41.79-2.78 56.86 6.7 7.58 14.98 11.11 39.28 16.74 23.68 5.49 28.99 8.68 30.7 18.5 2.18 12.54-7.9 18.62-31.08 18.74-23.64.12-37.71-7.03-47.62-24.2-2.97-5.15-4.58-9.31-11.6-30.15-13-38.55-19.06-48.99-34.33-59.13-12.3-8.18-35.42-12.84-54.69-11.03"/><path fill="#e41c24" d="M66.8.63A78.3 78.3 0 0 0 .6 67.23c-.91 6.3-.91 259.23 0 265.53a78.2 78.2 0 0 0 66.64 66.64c6.3.91 259.22.91 265.52 0a78.2 78.2 0 0 0 66.64-66.64c.91-6.3.91-259.22 0-265.52A78.2 78.2 0 0 0 332.76.6C326.72-.27 72.61-.24 66.8.63m83.6 125.35c24.92 3.4 40.14 13.76 51.3 34.96 3.32 6.3 5.84 12.94 13.1 34.46 7.02 20.84 8.63 25 11.6 30.15 9.9 17.16 23.98 24.32 47.62 24.2 23.18-.12 33.26-6.2 31.08-18.74-1.71-9.82-7.02-13.01-30.7-18.5-18.13-4.2-22.87-5.68-29.09-9.07-13.86-7.57-19.58-18.43-19.04-36.13.84-27.23 20.8-42.33 55.96-42.3 30.85.01 48.87 11.25 53.06 33.08.95 4.95 1.04 6 .53 6.17-.62.2-30.85 3.74-30.93 3.61-.03-.05-.35-1.45-.7-3.1-2.26-10.79-9.3-15.34-23.72-15.35-15.14-.01-22.5 5.49-22.44 16.77.05 11.35 4.47 14.72 25.17 19.15 16.48 3.53 21.2 4.8 27.67 7.48 18.34 7.57 27.42 21.73 26.52 41.36-1.26 27.4-22.5 40.6-65.32 40.6-37.68 0-60.56-10.46-74.69-34.15-4.68-7.85-5.86-10.85-14.56-37.11-10.4-31.43-13.7-38.07-22.47-45.44-12.86-10.8-35.8-11.07-48.63-.56-22.43 18.36-21.36 70.33 1.79 86.25 14.97 10.3 40.41 6.13 57.31-9.4 1.47-1.35 2.8-2.3 2.97-2.1.37.43 9.8 25.63 9.8 26.2 0 .46-2.95 2.75-6.05 4.7-21.76 13.73-59.33 15.74-81.94 4.39-21.99-11.04-32.87-32.57-32.86-65.02 0-47.17 21.39-73.38 63.04-77.3 3.73-.35 20.27.15 24.61.74"/></g></svg>';

const escapeHtml = (value: string): string => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const socialEventProvider = (event: ListenBrainzSocialEvent): 'listenbrainz' | 'lastfm' => {
    const explicitName = (event.trackMetadata.additionalInfo.musicServiceName || '').trim().toLowerCase();
    if (explicitName === 'last.fm' || explicitName === 'lastfm') {
        return 'lastfm';
    }

    const serviceDomain = (event.trackMetadata.additionalInfo.musicService || '').trim().toLowerCase();
    if (serviceDomain === 'last.fm' || serviceDomain === 'lastfm' || serviceDomain.includes('last.fm')) {
        return 'lastfm';
    }

    return 'listenbrainz';
};
const formatRelativeTime = (timestampSeconds: number): string => {
    if (!Number.isFinite(timestampSeconds) || timestampSeconds <= 0) {
        return 'just now';
    }

    const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Math.floor(timestampSeconds));
    if (deltaSeconds < 15) {
        return 'just now';
    }

    if (deltaSeconds < 60) {
        return `${deltaSeconds}s ago`;
    }

    const deltaMinutes = Math.floor(deltaSeconds / 60);
    if (deltaMinutes < 60) {
        return `${deltaMinutes}m ago`;
    }

    const deltaHours = Math.floor(deltaMinutes / 60);
    if (deltaHours < 24) {
        return `${deltaHours}h ago`;
    }

    const deltaDays = Math.floor(deltaHours / 24);
    if (deltaDays < 7) {
        return `${deltaDays}d ago`;
    }

    return new Date(timestampSeconds * 1000).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const normalizeErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message.trim() || 'ListenBrainz social feed request failed.';
    }

    if (typeof error === 'string') {
        return error.trim() || 'ListenBrainz social feed request failed.';
    }

    return 'ListenBrainz social feed request failed.';
};

const normalizedEventTimestamp = (event: ListenBrainzSocialEvent): number => {
    if (Number.isFinite(event.listenedAt || 0) && (event.listenedAt || 0) > 0) {
        return Math.floor(event.listenedAt || 0);
    }

    if (Number.isFinite(event.created) && event.created > 0) {
        return Math.floor(event.created);
    }

    return 0;
};

const normalizedUserKey = (event: ListenBrainzSocialEvent): string => (event.userName || '').trim().toLowerCase();

const isNewerSocialEvent = (candidate: ListenBrainzSocialEvent, current: ListenBrainzSocialEvent): boolean => {
    const candidateTimestamp = normalizedEventTimestamp(candidate);
    const currentTimestamp = normalizedEventTimestamp(current);

    if (candidateTimestamp !== currentTimestamp) {
        return candidateTimestamp > currentTimestamp;
    }

    if (Boolean(candidate.playingNow) !== Boolean(current.playingNow)) {
        return Boolean(candidate.playingNow);
    }

    return candidate.id > current.id;
};

const dedupeAndSortEvents = (events: ListenBrainzSocialEvent[]): ListenBrainzSocialEvent[] => {
    const latestEventsByUser = new Map<string, ListenBrainzSocialEvent>();
    const unkeyedEvents: ListenBrainzSocialEvent[] = [];

    for (const event of events) {
        if (event.hidden) {
            continue;
        }

        const userKey = normalizedUserKey(event);
        if (userKey === '') {
            unkeyedEvents.push(event);
            continue;
        }

        const existingEvent = latestEventsByUser.get(userKey);
        if (!existingEvent || isNewerSocialEvent(event, existingEvent)) {
            latestEventsByUser.set(userKey, event);
        }
    }

    return [...latestEventsByUser.values(), ...unkeyedEvents]
        .sort((left, right) => {
            const timestampDelta = normalizedEventTimestamp(right) - normalizedEventTimestamp(left);
            if (timestampDelta !== 0) {
                return timestampDelta;
            }

            return right.id - left.id;
        });
};

const socialFeedEventSignature = (events: ListenBrainzSocialEvent[]): string => events.map((event) => [
    normalizedUserKey(event),
    event.id,
    normalizedEventTimestamp(event),
    event.playingNow ? 1 : 0,
    event.trackMetadata.trackName || '',
].join(':')).join('|');

export const createListenBrainzSocialController = (options: ListenBrainzSocialControllerOptions) => {
    const {
        sidebarToggle,
        libraryExpandToggle,
        sidebarSectionTrigger,
        sidebarSectionTriggerLabel,
        sidebarSectionMenu,
        sidebarSectionOptionLibrary,
        sidebarSectionOptionSocial,
        sidebarPaneLibrary,
        sidebarPaneSocial,
        socialFeedStatus,
        socialFeedList,
    } = options.elements;

    let activeSection: SidebarSection = 'library';
    let sectionMenuOpen = false;
    let refreshInFlight = false;
    let lastErrorMessage = '';
    let followingUsers: string[] = [];
    let socialEvents: ListenBrainzSocialEvent[] = [];
    let animateNextRender = false;
    let pollHandle: number | undefined;
    let updateAnimationHandle: number | undefined;
    let sectionSwitchAnimationHandle: number | undefined;
    const ownerDocument = socialFeedList.ownerDocument;
    const socialFeedContextMenu = ownerDocument.createElement('div');
    socialFeedContextMenu.className = 'social-feed-context-menu';
    socialFeedContextMenu.hidden = true;
    socialFeedContextMenu.setAttribute('role', 'menu');
    socialFeedContextMenu.setAttribute('aria-label', 'Search scrobble in library');
    sidebarPaneSocial.append(socialFeedContextMenu);

    const stopPolling = (): void => {
        if (pollHandle !== undefined) {
            window.clearTimeout(pollHandle);
            pollHandle = undefined;
        }
    };

    const clearUpdateAnimation = (): void => {
        if (updateAnimationHandle !== undefined) {
            window.clearTimeout(updateAnimationHandle);
            updateAnimationHandle = undefined;
        }

        socialFeedList.classList.remove('is-animating');
    };

    const clearSectionSwitchAnimation = (): void => {
        if (sectionSwitchAnimationHandle !== undefined) {
            window.clearTimeout(sectionSwitchAnimationHandle);
            sectionSwitchAnimationHandle = undefined;
        }

        sidebarPaneLibrary.classList.remove('is-section-entering');
        sidebarPaneSocial.classList.remove('is-section-entering');
    };

    const animateSectionSwitch = (): void => {
        clearSectionSwitchAnimation();

        const enteringPane = activeSection === 'library' ? sidebarPaneLibrary : sidebarPaneSocial;
        enteringPane.classList.add('is-section-entering');
        sectionSwitchAnimationHandle = window.setTimeout(() => {
            enteringPane.classList.remove('is-section-entering');
            sectionSwitchAnimationHandle = undefined;
        }, sidebarSectionSwitchAnimationMs);
    };

    const setSectionMenuOpen = (open: boolean): void => {
        sectionMenuOpen = open;
        sidebarSectionMenu.hidden = !open;
        sidebarSectionTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        sidebarSectionTrigger.classList.toggle('is-open', open);
    };

    const closeSocialFeedContextMenu = (): void => {
        socialFeedContextMenu.hidden = true;
        socialFeedContextMenu.innerHTML = '';
    };

    const openSocialFeedContextMenu = (clientX: number, clientY: number, targets: SocialFeedContextMenuTargets): void => {
        const actions = [
            {
                label: 'Search artist',
                query: targets.artistName,
                kind: 'artist',
            },
            {
                label: 'Search album',
                query: targets.releaseName,
                kind: 'album',
            },
            {
                label: 'Search track',
                query: targets.trackName,
                kind: 'track',
            },
        ];

        socialFeedContextMenu.innerHTML = actions.map(({ label, query, kind }) => `
            <button
                class="social-feed-context-menu-item"
                type="button"
                role="menuitem"
                data-social-library-query-kind="${kind}"
                data-social-library-query="${escapeHtml(query)}"
                title="${escapeHtml(query || label)}"
                ${query === '' ? 'disabled' : ''}
            >${escapeHtml(label)}</button>
        `).join('');

        socialFeedContextMenu.hidden = false;

        const margin = 10;
        const rect = socialFeedContextMenu.getBoundingClientRect();
        const clampedX = Math.min(clientX, window.innerWidth - rect.width - margin);
        const clampedY = Math.min(clientY, window.innerHeight - rect.height - margin);

        socialFeedContextMenu.style.left = `${Math.max(margin, clampedX)}px`;
        socialFeedContextMenu.style.top = `${Math.max(margin, clampedY)}px`;
    };

    const renderEmptyState = (title: string, detail: string): string => `
        <div class="social-feed-empty">
            <p class="social-feed-empty-title">${escapeHtml(title)}</p>
            <p class="social-feed-empty-detail">${escapeHtml(detail)}</p>
        </div>
    `;

    const renderEvents = (): string => {
        if (socialEvents.length === 0) {
            if (refreshInFlight) {
                return '';
            }

            if (!options.hasAnyProviderConfigured()) {
                return renderEmptyState(
                    'Social account required',
                    'Add your ListenBrainz token or Last.fm credentials in Settings to load the people you follow and their recent scrobbles.',
                );
            }

            if (followingUsers.length === 0) {
                return renderEmptyState(
                    'No followed users yet',
                    'This view reads your ListenBrainz and Last.fm following feeds. Follow a few people there and their scrobbles will appear here.',
                );
            }

            return renderEmptyState(
                'No recent scrobbles',
                'Your followed users have not submitted any recent listens to ListenBrainz yet.',
            );
        }

        return socialEvents.map((event) => {
            const timestampSeconds = normalizedEventTimestamp(event);
            const relativeTime = formatRelativeTime(timestampSeconds);
            const absoluteTime = timestampSeconds > 0
                ? new Date(timestampSeconds * 1000).toLocaleString()
                : 'Unknown time';
            const rawTrackName = (event.trackMetadata.trackName || '').trim();
            const rawArtistName = (event.trackMetadata.artistName || '').trim();
            const rawReleaseName = (event.trackMetadata.releaseName || '').trim();
            const trackName = rawTrackName || 'Unknown track';
            const artistName = rawArtistName || 'Unknown artist';
            const releaseName = rawReleaseName;
            const localReleaseFolderPath = (event.trackMetadata.additionalInfo.localReleaseFolderPath || '').trim();
            const provider = socialEventProvider(event);
            const iconMarkup = provider === 'lastfm' ? lastFmUserIcon : listenBrainzUserIcon;
            const metaMarkup = releaseName !== ''
                ? `${escapeHtml(artistName)} <span aria-hidden="true">•</span> ${localReleaseFolderPath !== ''
                    ? `<button class="social-feed-meta-link" type="button" data-social-release-folder-path="${escapeHtml(localReleaseFolderPath)}">${escapeHtml(releaseName)}</button>`
                    : escapeHtml(releaseName)}`
                : escapeHtml(artistName);

            return `
                <article
                    class="social-feed-card${event.playingNow ? ' is-live' : ''}"
                    data-social-artist-query="${escapeHtml(rawArtistName)}"
                    data-social-release-query="${escapeHtml(rawReleaseName)}"
                    data-social-track-query="${escapeHtml(rawTrackName)}"
                >
                    <div class="social-feed-card-header">
                        <div class="social-feed-identity">
                            <span class="social-feed-avatar" aria-hidden="true">${iconMarkup}</span>
                            <div class="social-feed-user-copy">
                                <button class="social-feed-user social-feed-user-link" type="button" data-social-user-name="${escapeHtml((event.userName || '').trim())}" data-social-user-provider="${provider}">${escapeHtml((event.userName || '').trim() || 'Unknown user')}</button>
                                <p class="social-feed-verb">${event.playingNow ? 'is listening now' : 'scrobbled recently'}</p>
                            </div>
                        </div>
                        <span class="social-feed-time" title="${escapeHtml(absoluteTime)}">${escapeHtml(relativeTime)}</span>
                    </div>
                    <p class="social-feed-track">${escapeHtml(trackName)}</p>
                    <p class="social-feed-meta">${metaMarkup}</p>
                </article>
            `;
        }).join('');
    };

    const render = (): void => {
        const showingLibrary = activeSection === 'library';

        sidebarSectionTriggerLabel.textContent = showingLibrary ? 'LIBRARY' : 'SOCIAL';
        sidebarSectionOptionLibrary.classList.toggle('is-active', showingLibrary);
        sidebarSectionOptionLibrary.setAttribute('aria-checked', showingLibrary ? 'true' : 'false');
        sidebarSectionOptionSocial.classList.toggle('is-active', !showingLibrary);
        sidebarSectionOptionSocial.setAttribute('aria-checked', showingLibrary ? 'false' : 'true');

        libraryExpandToggle.hidden = !showingLibrary;
        sidebarPaneLibrary.hidden = !showingLibrary;
        sidebarPaneSocial.hidden = showingLibrary;

        if (lastErrorMessage !== '') {
            socialFeedStatus.textContent = socialEvents.length > 0 ? `Showing cached results. ${lastErrorMessage}` : lastErrorMessage;
        } else if (refreshInFlight && socialEvents.length === 0) {
            socialFeedStatus.textContent = 'Loading...';
        } else {
            socialFeedStatus.textContent = '';
        }

        closeSocialFeedContextMenu();
        socialFeedList.innerHTML = renderEvents();
        if (animateNextRender) {
            clearUpdateAnimation();
            void socialFeedList.offsetWidth;
            socialFeedList.classList.add('is-animating');
            updateAnimationHandle = window.setTimeout(() => {
                socialFeedList.classList.remove('is-animating');
                updateAnimationHandle = undefined;
            }, socialFeedUpdateAnimationMs);
            animateNextRender = false;
        }
    };

    const scheduleNextPoll = (): void => {
        stopPolling();
        if (activeSection !== 'social' || !options.hasAnyProviderConfigured() || !options.isSidebarVisible()) {
            return;
        }

        pollHandle = window.setTimeout(() => {
            void refreshSocialFeed(false).finally(() => {
                scheduleNextPoll();
            });
        }, socialFeedPollIntervalMs);
    };

    const refreshSocialFeed = async (manualRefresh: boolean): Promise<void> => {
        if (refreshInFlight) {
            return;
        }

        if (!options.hasAnyProviderConfigured()) {
            followingUsers = [];
            socialEvents = [];
            lastErrorMessage = '';
            render();
            return;
        }

        if (!manualRefresh && !options.isSidebarVisible()) {
            render();
            return;
        }

        refreshInFlight = true;
        lastErrorMessage = '';
        render();

        try {
            const [rawFollowingUsers, rawEvents] = await Promise.all([
                options.fetchFollowingUsers(),
                options.fetchFollowingFeed(socialFeedItemCount),
            ]);
            const nextEvents = dedupeAndSortEvents(rawEvents || []);

            followingUsers = [...new Set((rawFollowingUsers || []).map((userName) => userName.trim()).filter((userName) => userName !== ''))]
                .sort((left, right) => left.localeCompare(right));
            animateNextRender = nextEvents.length > 0 && socialFeedEventSignature(nextEvents) !== socialFeedEventSignature(socialEvents);
            socialEvents = nextEvents;
        } catch (error) {
            lastErrorMessage = normalizeErrorMessage(error);
            animateNextRender = false;
        } finally {
            refreshInFlight = false;
            render();
        }
    };

    const showLibrary = (): void => {
        if (activeSection === 'library') {
            closeSocialFeedContextMenu();
            setSectionMenuOpen(false);
            return;
        }

        activeSection = 'library';
        stopPolling();
        closeSocialFeedContextMenu();
        setSectionMenuOpen(false);
        options.onShowLibrary?.();
        render();
        animateSectionSwitch();
    };

    const showSocial = (): void => {
        if (activeSection === 'social') {
            closeSocialFeedContextMenu();
            setSectionMenuOpen(false);
            return;
        }

        activeSection = 'social';
        closeSocialFeedContextMenu();
        setSectionMenuOpen(false);
        options.onShowSocial?.();
        animateSectionSwitch();
        void refreshSocialFeed(false);
        scheduleNextPoll();
    };

    const handleSettingsChanged = (): void => {
        if (!options.hasAnyProviderConfigured()) {
            followingUsers = [];
            socialEvents = [];
            lastErrorMessage = '';
            stopPolling();
            clearUpdateAnimation();
            clearSectionSwitchAnimation();
            setSectionMenuOpen(false);
            render();
            return;
        }

        closeSocialFeedContextMenu();
        if (activeSection === 'social') {
            void refreshSocialFeed(true);
            scheduleNextPoll();
            return;
        }

        render();
    };

    sidebarSectionTrigger.addEventListener('click', () => {
        setSectionMenuOpen(!sectionMenuOpen);
    });
    sidebarSectionOptionLibrary.addEventListener('click', showLibrary);
    sidebarSectionOptionSocial.addEventListener('click', showSocial);
    socialFeedList.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const releaseButton = target.closest('[data-social-release-folder-path]');
        if (releaseButton instanceof HTMLButtonElement) {
            const folderPath = (releaseButton.dataset.socialReleaseFolderPath || '').trim();
            if (folderPath !== '') {
                void options.openLocalReleaseFolder(folderPath);
            }
            return;
        }

        const userButton = target.closest('[data-social-user-name][data-social-user-provider]');
        if (!(userButton instanceof HTMLButtonElement)) {
            return;
        }

        const userName = (userButton.dataset.socialUserName || '').trim();
        const provider = userButton.dataset.socialUserProvider;
        if (userName === '' || (provider !== 'listenbrainz' && provider !== 'lastfm')) {
            return;
        }

        void options.openUserProfile(provider, userName);
    });
    socialFeedList.addEventListener('contextmenu', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            closeSocialFeedContextMenu();
            return;
        }

        const socialCard = target.closest('.social-feed-card');
        if (!(socialCard instanceof HTMLElement)) {
            closeSocialFeedContextMenu();
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        openSocialFeedContextMenu(event.clientX, event.clientY, {
            artistName: (socialCard.dataset.socialArtistQuery || '').trim(),
            releaseName: (socialCard.dataset.socialReleaseQuery || '').trim(),
            trackName: (socialCard.dataset.socialTrackQuery || '').trim(),
        });
    });
    socialFeedContextMenu.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }

        const actionButton = target.closest('[data-social-library-query]');
        if (!(actionButton instanceof HTMLButtonElement)) {
            return;
        }

        const query = (actionButton.dataset.socialLibraryQuery || '').trim();
        closeSocialFeedContextMenu();
        if (query === '') {
            return;
        }

        void options.openLibrarySearch(query);
    });
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }

        if (!socialFeedContextMenu.hidden) {
            if (socialFeedContextMenu.contains(target)) {
                return;
            }

            closeSocialFeedContextMenu();
        }

        if (!sectionMenuOpen) {
            return;
        }

        if (sidebarSectionTrigger.contains(target) || sidebarSectionMenu.contains(target)) {
            return;
        }

        setSectionMenuOpen(false);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
            return;
        }

        if (!socialFeedContextMenu.hidden) {
            event.preventDefault();
            closeSocialFeedContextMenu();
            return;
        }

        if (!sectionMenuOpen) {
            return;
        }

        event.preventDefault();
        setSectionMenuOpen(false);
        sidebarSectionTrigger.focus();
    });
    document.addEventListener('contextmenu', (event) => {
        const target = event.target;
        if (!(target instanceof Node)) {
            closeSocialFeedContextMenu();
            return;
        }

        if (!socialFeedContextMenu.hidden && !socialFeedContextMenu.contains(target)) {
            closeSocialFeedContextMenu();
        }
    });
    document.addEventListener('scroll', () => {
        closeSocialFeedContextMenu();
    }, { capture: true });
    sidebarToggle.addEventListener('click', () => {
        window.setTimeout(() => {
            if (!options.isSidebarVisible()) {
                stopPolling();
                setSectionMenuOpen(false);
                closeSocialFeedContextMenu();
                clearSectionSwitchAnimation();
                return;
            }

            if (activeSection === 'social' && options.isSidebarVisible()) {
                void refreshSocialFeed(false);
                scheduleNextPoll();
            }
        }, 0);
    });

    render();

    return {
        handleSettingsChanged,
        isSocialActive: (): boolean => activeSection === 'social',
        refresh: async (): Promise<void> => {
            await refreshSocialFeed(true);
        },
        showLibrary,
        showSocial,
    };
};