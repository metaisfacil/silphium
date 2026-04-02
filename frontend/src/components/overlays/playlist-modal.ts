export type PlaylistModalElements = {
    playlistModal: HTMLDivElement;
    playlistBackdrop: HTMLDivElement;
    playlistClose: HTMLButtonElement;
    playlistTitle: HTMLParagraphElement;
    playlistSource: HTMLSelectElement;
    playlistHydrationProgress: HTMLParagraphElement;
    playlistHydrationCount: HTMLSpanElement;
    playlistList: HTMLUListElement;
    playlistAddCurrent: HTMLButtonElement;
    playlistSaveAs: HTMLButtonElement;
};

export const renderPlaylistModal = (): string => `
    <div id="playlist-modal" class="playlist-modal" hidden>
        <div id="playlist-backdrop" class="playlist-backdrop"></div>
        <section class="playlist-dialog" role="dialog" aria-modal="true" aria-label="Playlist viewer">
            <header class="playlist-header">
                <p id="playlist-title" class="playlist-title">Playlist</p>
                <select id="playlist-source" class="playlist-source" aria-label="Select playlist view" hidden></select>
                <div class="playlist-header-actions">
                    <p id="playlist-hydration-progress" class="playlist-hydration-progress" hidden aria-live="polite">
                        <span class="playlist-hydration-spinner" aria-hidden="true"></span>
                        <span id="playlist-hydration-count" class="playlist-hydration-count">0 of 0</span>
                    </p>
                    <button id="playlist-close" class="playlist-close" type="button" aria-label="Close playlist">✕</button>
                </div>
            </header>
            <ul id="playlist-list" class="playlist-list"></ul>
            <footer class="playlist-actions">
                <button id="playlist-add-current" class="playlist-action-btn" type="button" title="Add to current" aria-label="Add to current">+</button>
                <button id="playlist-save-as" class="playlist-action-btn" type="button" title="Save" aria-label="Save">💾</button>
            </footer>
        </section>
    </div>
`;

export const getPlaylistModalElements = (root: ParentNode): PlaylistModalElements => ({
    playlistModal: root.querySelector('#playlist-modal') as HTMLDivElement,
    playlistBackdrop: root.querySelector('#playlist-backdrop') as HTMLDivElement,
    playlistClose: root.querySelector('#playlist-close') as HTMLButtonElement,
    playlistTitle: root.querySelector('#playlist-title') as HTMLParagraphElement,
    playlistSource: root.querySelector('#playlist-source') as HTMLSelectElement,
    playlistHydrationProgress: root.querySelector('#playlist-hydration-progress') as HTMLParagraphElement,
    playlistHydrationCount: root.querySelector('#playlist-hydration-count') as HTMLSpanElement,
    playlistList: root.querySelector('#playlist-list') as HTMLUListElement,
    playlistAddCurrent: root.querySelector('#playlist-add-current') as HTMLButtonElement,
    playlistSaveAs: root.querySelector('#playlist-save-as') as HTMLButtonElement,
});