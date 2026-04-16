import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPlaylistTargetModalElements, renderPlaylistTargetModal } from '../components/overlays/playlist-target-modal';
import { createPlaylistTargetModalController } from './playlist-target-modal-controller';

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
};

describe('createPlaylistTargetModalController', () => {
    beforeEach(() => {
        vi.stubGlobal('requestAnimationFrame', ((callback: FrameRequestCallback): number => {
            callback(0);
            return 0;
        }) as typeof requestAnimationFrame);
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('renders playlist choices and resolves the selected playlist path', async () => {
        document.body.innerHTML = renderPlaylistTargetModal();
        const elements = getPlaylistTargetModalElements(document);
        const controller = createPlaylistTargetModalController(elements);

        const prompt = controller.prompt({
            title: 'Add to playlist',
            message: 'Add "Track 1" to:',
            confirmLabel: 'Add to playlist',
            getPlaylists: () => [
                { path: '/playlists/alpha.m3u8', label: 'alpha.m3u8' },
                { path: '/playlists/beta.m3u8', label: 'beta.m3u8' },
            ],
        });

        expect(elements.playlistTargetModal.hidden).toBe(false);
        expect(elements.playlistTargetTitle.textContent).toBe('Add to playlist');
        expect(elements.playlistTargetMessage.textContent).toBe('Add "Track 1" to:');
        expect(elements.playlistTargetSelect.disabled).toBe(false);
        expect(Array.from(elements.playlistTargetSelect.options).map((option) => option.value)).toEqual([
            '/playlists/alpha.m3u8',
            '/playlists/beta.m3u8',
        ]);

        elements.playlistTargetSelect.value = '/playlists/beta.m3u8';
        elements.playlistTargetConfirm.click();

        await expect(prompt).resolves.toEqual({
            selectedPath: '/playlists/beta.m3u8',
            duplicatePreventionEnabled: false,
        });
    });

    it('returns duplicate-prevention selection when the option is enabled', async () => {
        document.body.innerHTML = renderPlaylistTargetModal();
        const elements = getPlaylistTargetModalElements(document);
        const controller = createPlaylistTargetModalController(elements);

        const prompt = controller.prompt({
            title: 'Add to playlist',
            message: 'Add "Track 1" to:',
            getPlaylists: () => [
                { path: '/playlists/alpha.m3u8', label: 'alpha.m3u8' },
            ],
            duplicatePreventionLabel: 'Block duplicate current track in active playlist',
        });

        expect(elements.playlistTargetDuplicateWrap.hidden).toBe(false);
        elements.playlistTargetDuplicateCheckbox.checked = true;
        elements.playlistTargetConfirm.click();

        await expect(prompt).resolves.toEqual({
            selectedPath: '/playlists/alpha.m3u8',
            duplicatePreventionEnabled: true,
        });
    });

    it('shows an empty-state hint and closes on escape when no playlists exist', async () => {
        document.body.innerHTML = renderPlaylistTargetModal();
        const elements = getPlaylistTargetModalElements(document);
        const controller = createPlaylistTargetModalController(elements);

        const prompt = controller.prompt({
            title: 'Add to playlist',
            message: 'Add 12 tracks to:',
            getPlaylists: () => [],
            emptyStateMessage: 'Open or create a playlist first.',
        });

        expect(elements.playlistTargetSelect.disabled).toBe(true);
        expect(elements.playlistTargetConfirm.disabled).toBe(true);
        expect(elements.playlistTargetHint.hidden).toBe(false);
        expect(elements.playlistTargetHint.textContent).toBe('Open or create a playlist first.');
        expect(controller.handleEscape()).toBe(true);

        await expect(prompt).resolves.toBeNull();
    });

    it('refreshes the dropdown after creating a playlist target', async () => {
        document.body.innerHTML = renderPlaylistTargetModal();
        const elements = getPlaylistTargetModalElements(document);
        const controller = createPlaylistTargetModalController(elements);
        const playlists: Array<{ path: string; label: string }> = [];
        const onCreatePlaylist = vi.fn(async () => {
            playlists.push({ path: '/playlists/new-empty.m3u8', label: 'new-empty.m3u8' });
            return playlists[0];
        });

        const prompt = controller.prompt({
            title: 'Add to playlist',
            message: 'Add 1 track to:',
            confirmLabel: 'Add',
            getPlaylists: () => playlists,
            onCreatePlaylist,
        });

        expect(elements.playlistTargetSelect.disabled).toBe(true);
        elements.playlistTargetCreate.click();
        await flushPromises();

        expect(onCreatePlaylist).toHaveBeenCalledTimes(1);
        expect(elements.playlistTargetSelect.disabled).toBe(false);
        expect(elements.playlistTargetSelect.value).toBe('/playlists/new-empty.m3u8');

        elements.playlistTargetConfirm.click();
        await expect(prompt).resolves.toEqual({
            selectedPath: '/playlists/new-empty.m3u8',
            duplicatePreventionEnabled: false,
        });
    });
});