import { describe, expect, it, vi } from 'vitest';

import { createAppQueueMenuRuntime } from './app-queue-menu-runtime';

const createContext = ({ sidebarOpen }: { sidebarOpen: boolean }) => {
    const libraryController = {
        setSidebarAutoFolderPath: vi.fn(),
        isSidebarOpen: vi.fn(() => sidebarOpen),
        setSidebarOpen: vi.fn(),
        navigateToFolder: vi.fn(),
    };

    const sidebarController = {
        showLibrary: vi.fn(),
    };

    const context = {
        currentTrackIndex: 0,
        tracks: [{ folderPath: 'Library/Artist/Album', path: 'Library/Artist/Album/track.flac' }],
        libraryController,
        sidebarController,
    };

    return {
        context: context as unknown as Parameters<typeof createAppQueueMenuRuntime>[0],
        libraryController,
        sidebarController,
    };
};

describe('createAppQueueMenuRuntime openCurrentTrackFolderInSidebar', () => {
    it('switches to Library and opens the sidebar when closed', () => {
        const { context, libraryController, sidebarController } = createContext({ sidebarOpen: false });
        const runtime = createAppQueueMenuRuntime(context);

        runtime.openCurrentTrackFolderInSidebar();

        expect(sidebarController.showLibrary).toHaveBeenCalledTimes(1);
        expect(libraryController.setSidebarAutoFolderPath).toHaveBeenCalledWith('Library/Artist/Album');
        expect(libraryController.setSidebarOpen).toHaveBeenCalledWith(true);
        expect(libraryController.navigateToFolder).not.toHaveBeenCalled();
    });

    it('switches to Library and navigates when the sidebar is already open', () => {
        const { context, libraryController, sidebarController } = createContext({ sidebarOpen: true });
        const runtime = createAppQueueMenuRuntime(context);

        runtime.openCurrentTrackFolderInSidebar();

        expect(sidebarController.showLibrary).toHaveBeenCalledTimes(1);
        expect(libraryController.setSidebarAutoFolderPath).toHaveBeenCalledWith('Library/Artist/Album');
        expect(libraryController.setSidebarOpen).not.toHaveBeenCalled();
        expect(libraryController.navigateToFolder).toHaveBeenCalledWith('Library/Artist/Album');
    });
});

describe('createAppQueueMenuRuntime addSidebarSelectionToPlaylist', () => {
    it('shows an error and blocks append when duplicate prevention is enabled for the current track', async () => {
        const appendTracksToPlaylist = vi.fn(async () => true);
        const openErrorModal = vi.fn();
        const prompt = vi.fn(async () => ({
            selectedPath: '/playlists/demo.m3u8',
            duplicatePreventionEnabled: true,
        }));

        const context = {
            currentTrackIndex: 0,
            tracks: [
                { path: '/music/track-0.flac', folderPath: '/music' },
                { path: '/music/track-1.flac', folderPath: '/music' },
            ],
            playlistTargetModalController: { prompt },
            playlistController: {
                getAvailablePlaylistTargets: vi.fn(() => [{ path: '/playlists/demo.m3u8', label: 'demo.m3u8' }]),
                openPlaylistTarget: vi.fn(async () => null),
                createPlaylistTarget: vi.fn(async () => null),
                isTrackAlreadyInLoadedPlaylist: vi.fn(() => true),
                appendTracksToPlaylist,
            },
            openErrorModal,
        } as unknown as Parameters<typeof createAppQueueMenuRuntime>[0];

        const runtime = createAppQueueMenuRuntime(context);

        await runtime.addSidebarSelectionToPlaylist({
            trackIndexes: [0],
            folderPath: '',
            folderLabel: '',
            folderTarget: false,
            trackIndexesScopedToSelection: true,
        });

        expect(openErrorModal).toHaveBeenCalledWith(
            'Track already in playlist',
            'The current track is already in the active playlist. Disable duplicate prevention to add it again.',
        );
        expect(appendTracksToPlaylist).not.toHaveBeenCalled();
    });

    it('allows append when duplicate prevention is disabled', async () => {
        const appendTracksToPlaylist = vi.fn(async () => true);
        const openErrorModal = vi.fn();
        const prompt = vi.fn(async () => ({
            selectedPath: '/playlists/demo.m3u8',
            duplicatePreventionEnabled: false,
        }));

        const context = {
            currentTrackIndex: 0,
            tracks: [
                { path: '/music/track-0.flac', folderPath: '/music' },
                { path: '/music/track-1.flac', folderPath: '/music' },
            ],
            playlistTargetModalController: { prompt },
            playlistController: {
                getAvailablePlaylistTargets: vi.fn(() => [{ path: '/playlists/demo.m3u8', label: 'demo.m3u8' }]),
                openPlaylistTarget: vi.fn(async () => null),
                createPlaylistTarget: vi.fn(async () => null),
                isTrackAlreadyInLoadedPlaylist: vi.fn(() => true),
                appendTracksToPlaylist,
            },
            openErrorModal,
        } as unknown as Parameters<typeof createAppQueueMenuRuntime>[0];

        const runtime = createAppQueueMenuRuntime(context);

        await runtime.addSidebarSelectionToPlaylist({
            trackIndexes: [0],
            folderPath: '',
            folderLabel: '',
            folderTarget: false,
            trackIndexesScopedToSelection: true,
        });

        expect(appendTracksToPlaylist).toHaveBeenCalledWith('/playlists/demo.m3u8', [0]);
        expect(openErrorModal).not.toHaveBeenCalled();
    });
});
