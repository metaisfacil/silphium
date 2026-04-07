import { describe, expect, it, vi } from 'vitest';

import { createAppQueueMenuRuntime } from './app-queue-menu-runtime';

const createContext = ({ sidebarOpen }: { sidebarOpen: boolean }) => {
    const libraryController = {
        setSidebarAutoFolderPath: vi.fn(),
        isSidebarOpen: vi.fn(() => sidebarOpen),
        setSidebarOpen: vi.fn(),
        navigateToFolder: vi.fn(),
    };

    const listenBrainzSocialController = {
        showLibrary: vi.fn(),
    };

    const context = {
        currentTrackIndex: 0,
        tracks: [{ folderPath: 'Library/Artist/Album', path: 'Library/Artist/Album/track.flac' }],
        libraryController,
        listenBrainzSocialController,
    };

    return {
        context: context as unknown as Parameters<typeof createAppQueueMenuRuntime>[0],
        libraryController,
        listenBrainzSocialController,
    };
};

describe('createAppQueueMenuRuntime openCurrentTrackFolderInSidebar', () => {
    it('switches to Library and opens the sidebar when closed', () => {
        const { context, libraryController, listenBrainzSocialController } = createContext({ sidebarOpen: false });
        const runtime = createAppQueueMenuRuntime(context);

        runtime.openCurrentTrackFolderInSidebar();

        expect(listenBrainzSocialController.showLibrary).toHaveBeenCalledTimes(1);
        expect(libraryController.setSidebarAutoFolderPath).toHaveBeenCalledWith('Library/Artist/Album');
        expect(libraryController.setSidebarOpen).toHaveBeenCalledWith(true);
        expect(libraryController.navigateToFolder).not.toHaveBeenCalled();
    });

    it('switches to Library and navigates when the sidebar is already open', () => {
        const { context, libraryController, listenBrainzSocialController } = createContext({ sidebarOpen: true });
        const runtime = createAppQueueMenuRuntime(context);

        runtime.openCurrentTrackFolderInSidebar();

        expect(listenBrainzSocialController.showLibrary).toHaveBeenCalledTimes(1);
        expect(libraryController.setSidebarAutoFolderPath).toHaveBeenCalledWith('Library/Artist/Album');
        expect(libraryController.setSidebarOpen).not.toHaveBeenCalled();
        expect(libraryController.navigateToFolder).toHaveBeenCalledWith('Library/Artist/Album');
    });
});
