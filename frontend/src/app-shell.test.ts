import { describe, expect, it } from 'vitest';

import { getAppShellElements, renderAppShell } from './app-shell';
import { renderPlayPauseIcon } from './components/media-controls';

describe('app shell', () => {
    it('renders the application shell and resolves the main element references', () => {
        document.body.innerHTML = '<div id="app"></div>';

        const app = document.querySelector('#app') as HTMLDivElement;
        renderAppShell(app);

        const elements = getAppShellElements(document);

        expect(app.querySelector('#bg-layer-a')).toBeTruthy();
        expect(app.querySelector('#bg-layer-b')).toBeTruthy();
        expect(app.querySelector('#library-sidebar')).toBeTruthy();
        expect(app.querySelector('#player-card')).toBeTruthy();
        expect(app.querySelector('#about-modal')).toBeTruthy();
        expect(app.querySelector('#share-modal')).toBeTruthy();
        expect(app.querySelector('#playlist-modal')).toBeTruthy();

        expect(elements.bgLayerA.id).toBe('bg-layer-a');
        expect(elements.bgLayerB.id).toBe('bg-layer-b');
        expect(elements.sidebarToggle.id).toBe('sidebar-toggle');
        expect(elements.playPause.id).toBe('play-pause');
        expect(elements.playlistMenuElements).toBeTruthy();
        expect(elements.playlistTargetModalElements).toBeTruthy();
        expect(elements.playlistModalElements).toBeTruthy();
        expect(elements.imageModalElements).toBeTruthy();
        expect(elements.settingsElements).toBeTruthy();
    });

    it('renders both play and pause icons', () => {
        const playIcon = renderPlayPauseIcon('play');
        const pauseIcon = renderPlayPauseIcon('pause');

        expect(playIcon).toContain('<svg');
        expect(pauseIcon).toContain('<svg');
        expect(pauseIcon).not.toEqual(playIcon);
    });
});