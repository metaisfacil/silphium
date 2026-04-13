import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListenBrainzSocialEvent } from '../types/app-types';
import { createListenBrainzSocialController } from './listenbrainz-social-controller';

const createEvent = (overrides: Partial<ListenBrainzSocialEvent> = {}): ListenBrainzSocialEvent => ({
    id: 1,
    created: 1710000100,
    eventType: 'listen',
    hidden: false,
    userName: 'alice',
    listenedAt: 1710000000,
    listenedAtIso: '2024-03-09T16:00:00Z',
    playingNow: false,
    trackMetadata: {
        artistName: 'Artist One',
        trackName: 'Track One',
        releaseName: 'Album One',
        additionalInfo: {
            musicServiceName: 'Spotify',
        },
    },
    ...overrides,
});

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const mountController = (options?: {
    token?: string;
    hasAnyProviderConfigured?: boolean;
    isSidebarVisible?: () => boolean;
    fetchFollowingUsers?: () => Promise<string[]>;
    fetchFollowingFeed?: (count: number) => Promise<ListenBrainzSocialEvent[]>;
    openUserProfile?: (provider: 'listenbrainz' | 'lastfm', userName: string) => void | Promise<void>;
    openLocalReleaseFolder?: (folderPath: string) => void | Promise<void>;
    openLibrarySearch?: (query: string) => void | Promise<void>;
}) => {
    document.body.innerHTML = `
        <button id="sidebar-toggle" type="button"></button>
        <button id="sidebar-section-trigger" type="button"><span id="sidebar-section-trigger-label"></span></button>
        <div id="sidebar-section-menu" hidden>
            <button id="sidebar-section-option-library" type="button"></button>
            <button id="sidebar-section-option-social" type="button"></button>
        </div>
        <section id="sidebar-pane-library"></section>
        <section id="sidebar-pane-social" hidden></section>
        <p id="social-feed-status"></p>
        <div id="social-feed-list"></div>
    `;

    const sidebarToggle = document.querySelector('#sidebar-toggle') as HTMLButtonElement;
    const sidebarSectionTrigger = document.querySelector('#sidebar-section-trigger') as HTMLButtonElement;
    const sidebarSectionTriggerLabel = document.querySelector('#sidebar-section-trigger-label') as HTMLSpanElement;
    const sidebarSectionMenu = document.querySelector('#sidebar-section-menu') as HTMLDivElement;
    const sidebarSectionOptionLibrary = document.querySelector('#sidebar-section-option-library') as HTMLButtonElement;
    const sidebarSectionOptionSocial = document.querySelector('#sidebar-section-option-social') as HTMLButtonElement;
    const sidebarPaneLibrary = document.querySelector('#sidebar-pane-library') as HTMLElement;
    const sidebarPaneSocial = document.querySelector('#sidebar-pane-social') as HTMLElement;
    const socialFeedStatus = document.querySelector('#social-feed-status') as HTMLParagraphElement;
    const socialFeedList = document.querySelector('#social-feed-list') as HTMLDivElement;

    const fetchFollowingUsers = options?.fetchFollowingUsers || vi.fn(async () => ['alice', 'bob']);
    const fetchFollowingFeed = options?.fetchFollowingFeed || vi.fn(async () => [createEvent()]);
    const openUserProfile = options?.openUserProfile || vi.fn();
    const openLocalReleaseFolder = options?.openLocalReleaseFolder || vi.fn();
    const openLibrarySearch = options?.openLibrarySearch || vi.fn();

    const controller = createListenBrainzSocialController({
        elements: {
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
        },
        hasAnyProviderConfigured: () => options?.hasAnyProviderConfigured ?? (options?.token ?? 'token').trim() !== '',
        isSidebarVisible: options?.isSidebarVisible || (() => true),
        fetchFollowingUsers,
        fetchFollowingFeed,
        openUserProfile,
        openLocalReleaseFolder,
        openLibrarySearch,
    });

    return {
        controller,
        sidebarSectionTrigger,
        sidebarSectionTriggerLabel,
        sidebarSectionMenu,
        sidebarSectionOptionLibrary,
        sidebarSectionOptionSocial,
        sidebarPaneLibrary,
        sidebarPaneSocial,
        socialFeedStatus,
        socialFeedList,
        fetchFollowingUsers,
        fetchFollowingFeed,
        openUserProfile,
        openLocalReleaseFolder,
        openLibrarySearch,
    };
};

describe('createListenBrainzSocialController', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-06T12:00:00Z'));
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('loads and renders the social feed when the social tab opens', async () => {
        const {
            sidebarSectionTrigger,
            sidebarSectionTriggerLabel,
            sidebarSectionMenu,
            sidebarSectionOptionSocial,
            sidebarPaneLibrary,
            sidebarPaneSocial,
            socialFeedList,
            fetchFollowingUsers,
            fetchFollowingFeed,
        } = mountController({
            fetchFollowingFeed: vi.fn(async () => [
                createEvent(),
                createEvent({
                    id: 2,
                    userName: 'alice',
                    created: 1710000200,
                    listenedAt: 1710000150,
                    trackMetadata: {
                        artistName: 'Artist Two',
                        trackName: 'Track Two',
                        releaseName: 'Album Two',
                        additionalInfo: {
                            musicServiceName: 'Spotify',
                        },
                    },
                }),
                createEvent({
                    id: 3,
                    userName: 'bob',
                    created: 1710000180,
                    listenedAt: 1710000140,
                    trackMetadata: {
                        artistName: 'Artist Three',
                        trackName: 'Track Three',
                        releaseName: 'Album Three',
                        additionalInfo: {
                            musicServiceName: 'ListenBrainz',
                        },
                    },
                }),
            ]),
        });

        expect(sidebarSectionTriggerLabel.textContent).toBe('LIBRARY');

        sidebarSectionTrigger.click();
        expect(sidebarSectionMenu.hidden).toBe(false);

        sidebarSectionOptionSocial.click();
        await flushPromises();

        await vi.waitFor(() => {
            expect(socialFeedList.textContent).toContain('Track Two');
        });

        expect(fetchFollowingUsers).toHaveBeenCalledTimes(1);
        expect(fetchFollowingFeed).toHaveBeenCalledWith(40);
        expect(sidebarSectionTriggerLabel.textContent).toBe('SOCIAL');
        expect(sidebarPaneLibrary.hidden).toBe(true);
        expect(sidebarPaneSocial.hidden).toBe(false);
        expect(socialFeedList.textContent).toContain('Track Two');
        expect(socialFeedList.textContent).not.toContain('Track One');
        expect(socialFeedList.textContent).toContain('Track Three');
        expect(socialFeedList.textContent).toContain('alice');
        expect(socialFeedList.textContent).toContain('bob');
    });

    it('shows an account-required empty state when no social provider is configured', async () => {
        const {
            sidebarSectionOptionSocial,
            socialFeedList,
            fetchFollowingUsers,
            fetchFollowingFeed,
        } = mountController({ hasAnyProviderConfigured: false });

        sidebarSectionOptionSocial.click();
        await flushPromises();

        expect(fetchFollowingUsers).not.toHaveBeenCalled();
        expect(fetchFollowingFeed).not.toHaveBeenCalled();
        expect(socialFeedList.textContent).toContain('Social account required');
    });

    it('polls again while the social tab stays active', async () => {
        const { sidebarSectionOptionSocial, fetchFollowingFeed } = mountController();

        sidebarSectionOptionSocial.click();
        await flushPromises();

        expect(fetchFollowingFeed).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(15000);
        await flushPromises();

        expect(fetchFollowingFeed).toHaveBeenCalledTimes(2);
    });

    it('keeps background polling silent once the feed has loaded', async () => {
        let resolveSecondFeedRequest: (events: ListenBrainzSocialEvent[]) => void = () => undefined;
        const fetchFollowingFeed = vi.fn<[count: number], Promise<ListenBrainzSocialEvent[]>>()
            .mockResolvedValueOnce([createEvent()])
            .mockImplementationOnce(async (_count: number) => await new Promise<ListenBrainzSocialEvent[]>((resolve) => {
                resolveSecondFeedRequest = resolve;
            }));
        const { sidebarSectionOptionSocial, socialFeedStatus } = mountController({ fetchFollowingFeed });

        sidebarSectionOptionSocial.click();
        await flushPromises();

        await vi.waitFor(() => {
            expect(socialFeedStatus.textContent).toBe('');
        });

        await vi.advanceTimersByTimeAsync(15000);
        await flushPromises();

        expect(fetchFollowingFeed).toHaveBeenCalledTimes(2);
        expect(socialFeedStatus.textContent).toBe('');

        resolveSecondFeedRequest([createEvent({ id: 2, trackMetadata: {
            artistName: 'Artist Two',
            trackName: 'Track Two',
            releaseName: 'Album Two',
            additionalInfo: {
                musicServiceName: 'Spotify',
            },
        } })]);
        await flushPromises();

        expect(socialFeedStatus.textContent).toBe('');
    });

    it('does not show no-followed empty state while loading', async () => {
        let resolveFollowingUsers: (value: string[]) => void = () => undefined;
        let resolveFollowingFeed: (value: ListenBrainzSocialEvent[]) => void = () => undefined;
        const fetchFollowingUsers = vi.fn(async () => await new Promise<string[]>((resolve) => {
            resolveFollowingUsers = resolve;
        }));
        const fetchFollowingFeed = vi.fn(async () => await new Promise<ListenBrainzSocialEvent[]>((resolve) => {
            resolveFollowingFeed = resolve;
        }));
        const { sidebarSectionOptionSocial, socialFeedList, socialFeedStatus } = mountController({
            fetchFollowingUsers,
            fetchFollowingFeed,
        });

        sidebarSectionOptionSocial.click();
        await flushPromises();

        expect(fetchFollowingUsers).toHaveBeenCalledTimes(1);
        expect(fetchFollowingFeed).toHaveBeenCalledTimes(1);
        expect(socialFeedStatus.textContent).toBe('Loading...');
        expect(socialFeedList.textContent || '').not.toContain('No followed users yet');

        resolveFollowingUsers([]);
        resolveFollowingFeed([]);
        await flushPromises();

        await vi.waitFor(() => {
            expect(socialFeedStatus.textContent).toBe('');
        });
        expect(socialFeedList.textContent).toContain('No followed users yet');
    });

    it('animates the feed when new scrobbles arrive', async () => {
        let nextEvents = [createEvent()];
        const fetchFollowingFeed = vi.fn(async () => nextEvents);
        const { controller, sidebarSectionOptionSocial, socialFeedList } = mountController({ fetchFollowingFeed });

        sidebarSectionOptionSocial.click();
        await flushPromises();

        await vi.waitFor(() => {
            expect(socialFeedList.textContent).toContain('Track One');
        });

        nextEvents = [createEvent({
            id: 2,
            created: 1710000200,
            listenedAt: 1710000150,
            trackMetadata: {
                artistName: 'Artist Two',
                trackName: 'Track Two',
                releaseName: 'Album Two',
                additionalInfo: {
                    musicServiceName: 'Spotify',
                },
            },
        })];

        await controller.refresh();
        await flushPromises();

        expect(socialFeedList.classList.contains('is-animating')).toBe(true);
        expect(socialFeedList.textContent).toContain('Track Two');

        await vi.advanceTimersByTimeAsync(420);

        expect(socialFeedList.classList.contains('is-animating')).toBe(false);
    });

    it('switches back to the library pane when requested programmatically', async () => {
        const { controller, sidebarSectionOptionSocial, sidebarSectionTriggerLabel, sidebarPaneLibrary, sidebarPaneSocial } = mountController();

        sidebarSectionOptionSocial.click();
        await flushPromises();

        controller.showLibrary();

        expect(sidebarSectionTriggerLabel.textContent).toBe('LIBRARY');
        expect(sidebarPaneLibrary.hidden).toBe(false);
        expect(sidebarPaneSocial.hidden).toBe(true);
        expect(controller.isSocialActive()).toBe(false);
    });

    it('opens the user profile when a username is clicked', async () => {
        const openUserProfile = vi.fn();
        const {
            sidebarSectionOptionSocial,
            socialFeedList,
        } = mountController({
            openUserProfile,
            fetchFollowingFeed: vi.fn(async () => [
                createEvent({
                    userName: 'lastfm-user',
                    trackMetadata: {
                        artistName: 'Artist One',
                        trackName: 'Track One',
                        releaseName: 'Album One',
                        additionalInfo: {
                            musicServiceName: 'Last.fm',
                        },
                    },
                }),
            ]),
        });

        sidebarSectionOptionSocial.click();
        await flushPromises();

        await vi.waitFor(() => {
            expect(socialFeedList.textContent).toContain('lastfm-user');
        });

        const userButton = socialFeedList.querySelector('[data-social-user-name="lastfm-user"]') as HTMLButtonElement | null;
        expect(userButton).not.toBeNull();
        userButton?.click();

        expect(openUserProfile).toHaveBeenCalledWith('lastfm', 'lastfm-user');
    });

    it('opens a local album folder when a resolved release title is clicked', async () => {
        const openLocalReleaseFolder = vi.fn();
        const {
            sidebarSectionOptionSocial,
            socialFeedList,
        } = mountController({
            openLocalReleaseFolder,
            fetchFollowingFeed: vi.fn(async () => [
                createEvent({
                    trackMetadata: {
                        artistName: 'Artist One',
                        trackName: 'Track One',
                        releaseName: 'Album One',
                        additionalInfo: {
                            musicServiceName: 'ListenBrainz',
                            localReleaseFolderPath: 'Library/Artist One/Album One',
                        },
                    },
                }),
            ]),
        });

        sidebarSectionOptionSocial.click();
        await flushPromises();

        await vi.waitFor(() => {
            expect(socialFeedList.textContent).toContain('Album One');
        });

        const releaseButton = socialFeedList.querySelector('[data-social-release-folder-path="Library/Artist One/Album One"]') as HTMLButtonElement | null;
        expect(releaseButton).not.toBeNull();
        releaseButton?.click();

        expect(openLocalReleaseFolder).toHaveBeenCalledWith('Library/Artist One/Album One');
    });

    it('opens a right-click menu for scrobbles that can search artist, album, or track in the library', async () => {
        const openLibrarySearch = vi.fn();
        const {
            sidebarSectionOptionSocial,
            sidebarPaneSocial,
            socialFeedList,
        } = mountController({ openLibrarySearch });

        sidebarSectionOptionSocial.click();
        await flushPromises();

        await vi.waitFor(() => {
            expect(socialFeedList.textContent).toContain('Track One');
        });

        const socialCard = socialFeedList.querySelector('.social-feed-card') as HTMLElement | null;
        expect(socialCard).not.toBeNull();
        socialCard?.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: 32,
            clientY: 48,
        }));

        const contextMenu = sidebarPaneSocial.querySelector('.social-feed-context-menu') as HTMLDivElement | null;
        expect(contextMenu).not.toBeNull();
        expect(contextMenu?.hidden).toBe(false);

        const artistAction = contextMenu?.querySelector('[data-social-library-query-kind="artist"]') as HTMLButtonElement | null;
        const albumAction = contextMenu?.querySelector('[data-social-library-query-kind="album"]') as HTMLButtonElement | null;
        const trackAction = contextMenu?.querySelector('[data-social-library-query-kind="track"]') as HTMLButtonElement | null;

        expect(artistAction?.dataset.socialLibraryQuery).toBe('Artist One');
        expect(albumAction?.dataset.socialLibraryQuery).toBe('Album One');
        expect(trackAction?.dataset.socialLibraryQuery).toBe('Track One');

        trackAction?.click();

        expect(openLibrarySearch).toHaveBeenCalledWith('Track One');
        expect(contextMenu?.hidden).toBe(true);
    });
});