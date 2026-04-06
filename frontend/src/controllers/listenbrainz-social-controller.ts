import type { SidebarElements } from '../components/sidebar';
import type { ListenBrainzSocialEvent } from '../types/app-types';

type SidebarSection = 'library' | 'social';

type ListenBrainzSocialControllerOptions = {
    elements: Pick<SidebarElements, 'sidebarToggle' | 'sidebarSectionTrigger' | 'sidebarSectionTriggerLabel' | 'sidebarSectionMenu' | 'sidebarSectionOptionLibrary' | 'sidebarSectionOptionSocial' | 'sidebarPaneLibrary' | 'sidebarPaneSocial' | 'socialFeedStatus' | 'socialFeedList'>;
    getToken: () => string;
    isSidebarVisible: () => boolean;
    fetchFollowingUsers: () => Promise<string[]>;
    fetchFollowingFeed: (count: number) => Promise<ListenBrainzSocialEvent[]>;
};

export type ListenBrainzSocialController = ReturnType<typeof createListenBrainzSocialController>;

const socialFeedPollIntervalMs = 15000;
const socialFeedItemCount = 40;
const socialFeedUpdateAnimationMs = 420;
const sidebarSectionSwitchAnimationMs = 240;

const listenBrainzUserIcon = '<svg class="social-feed-listenbrainz-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 27 30" aria-hidden="true"><polygon fill="#353070" points="13 1 1 8 1 22 13 29 13 1"/><polygon fill="#eb743b" points="14 1 26 8 26 22 14 29 14 1"/></svg>';

const escapeHtml = (value: string): string => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatMusicServiceLabel = (event: ListenBrainzSocialEvent): string => {
    const explicitName = (event.trackMetadata.additionalInfo.musicServiceName || '').trim();
    if (explicitName !== '') {
        return explicitName;
    }

    const domain = (event.trackMetadata.additionalInfo.musicService || '').trim().toLowerCase();
    if (domain === '') {
        return '';
    }

    return domain.replace(/^www\./, '').replace(/\.[a-z0-9]+$/, '');
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

    const renderEmptyState = (title: string, detail: string): string => `
        <div class="social-feed-empty">
            <p class="social-feed-empty-title">${escapeHtml(title)}</p>
            <p class="social-feed-empty-detail">${escapeHtml(detail)}</p>
        </div>
    `;

    const renderEvents = (): string => {
        if (socialEvents.length === 0) {
            if (options.getToken().trim() === '') {
                return renderEmptyState(
                    'ListenBrainz token required',
                    'Add your ListenBrainz user token in Settings to load the people you follow and their recent scrobbles.',
                );
            }

            if (followingUsers.length === 0) {
                return renderEmptyState(
                    'No followed users yet',
                    'This view reads your ListenBrainz following feed. Follow a few people there and their new scrobbles will appear here.',
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
            const trackName = (event.trackMetadata.trackName || '').trim() || 'Unknown track';
            const artistName = (event.trackMetadata.artistName || '').trim() || 'Unknown artist';
            const releaseName = (event.trackMetadata.releaseName || '').trim();
            const serviceLabel = formatMusicServiceLabel(event);
            const secondaryLine = releaseName !== ''
                ? `${artistName} • ${releaseName}`
                : artistName;
            const badges: string[] = [];
            if (event.playingNow) {
                badges.push('<span class="social-feed-badge is-live">Live</span>');
            }
            if (serviceLabel !== '') {
                badges.push(`<span class="social-feed-badge">${escapeHtml(serviceLabel)}</span>`);
            }

            return `
                <article class="social-feed-card${event.playingNow ? ' is-live' : ''}">
                    <div class="social-feed-card-header">
                        <div class="social-feed-identity">
                            <span class="social-feed-avatar" aria-hidden="true">${listenBrainzUserIcon}</span>
                            <div class="social-feed-user-copy">
                                <p class="social-feed-user">${escapeHtml((event.userName || '').trim() || 'Unknown user')}</p>
                                <p class="social-feed-verb">${event.playingNow ? 'is listening now' : 'scrobbled recently'}</p>
                            </div>
                        </div>
                        <span class="social-feed-time" title="${escapeHtml(absoluteTime)}">${escapeHtml(relativeTime)}</span>
                    </div>
                    <p class="social-feed-track">${escapeHtml(trackName)}</p>
                    <p class="social-feed-meta">${escapeHtml(secondaryLine)}</p>
                    ${badges.length > 0 ? `<div class="social-feed-badges">${badges.join('')}</div>` : ''}
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

        sidebarPaneLibrary.hidden = !showingLibrary;
        sidebarPaneSocial.hidden = showingLibrary;

        if (lastErrorMessage !== '') {
            socialFeedStatus.textContent = socialEvents.length > 0 ? `Showing cached results. ${lastErrorMessage}` : lastErrorMessage;
        } else if (refreshInFlight && socialEvents.length === 0) {
            socialFeedStatus.textContent = 'Loading...';
        } else {
            socialFeedStatus.textContent = '';
        }

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
        if (activeSection !== 'social' || options.getToken().trim() === '' || !options.isSidebarVisible()) {
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

        const token = options.getToken().trim();
        if (token === '') {
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
            setSectionMenuOpen(false);
            return;
        }

        activeSection = 'library';
        stopPolling();
        setSectionMenuOpen(false);
        render();
        animateSectionSwitch();
    };

    const showSocial = (): void => {
        if (activeSection === 'social') {
            setSectionMenuOpen(false);
            return;
        }

        activeSection = 'social';
        setSectionMenuOpen(false);
        render();
        animateSectionSwitch();
        void refreshSocialFeed(false);
        scheduleNextPoll();
    };

    const handleSettingsChanged = (): void => {
        if (options.getToken().trim() === '') {
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
    document.addEventListener('click', (event) => {
        if (!sectionMenuOpen) {
            return;
        }

        const target = event.target;
        if (!(target instanceof Node)) {
            return;
        }

        if (sidebarSectionTrigger.contains(target) || sidebarSectionMenu.contains(target)) {
            return;
        }

        setSectionMenuOpen(false);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !sectionMenuOpen) {
            return;
        }

        event.preventDefault();
        setSectionMenuOpen(false);
        sidebarSectionTrigger.focus();
    });
    sidebarToggle.addEventListener('click', () => {
        window.setTimeout(() => {
            if (!options.isSidebarVisible()) {
                stopPolling();
                setSectionMenuOpen(false);
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