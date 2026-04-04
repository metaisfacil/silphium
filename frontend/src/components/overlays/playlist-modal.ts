export type PlaylistModalElements = {
    playlistModal: HTMLDivElement;
    playlistBackdrop: HTMLDivElement;
    playlistClose: HTMLButtonElement;
    playlistTitle: HTMLParagraphElement;
    playlistSource: HTMLSelectElement;
    playlistHydrationProgress: HTMLParagraphElement;
    playlistHydrationCount: HTMLSpanElement;
    playlistList: HTMLUListElement;
    playlistCreate: HTMLButtonElement;
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
                    <button id="playlist-close" class="playlist-close" type="button" aria-label="Close playlist"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg></button>
                </div>
            </header>
            <ul id="playlist-list" class="playlist-list"></ul>
            <footer class="playlist-actions">
                <button id="playlist-create" class="playlist-action-btn" type="button" title="Create new playlist" aria-label="Create new playlist"><svg class="playlist-action-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6 3.5C4.9 3.5 4 4.4 4 5.5V18.5C4 19.6 4.9 20.5 6 20.5H18C19.1 20.5 20 19.6 20 18.5V9L14.5 3.5H6ZM14 5.6L17.9 9.5H14V5.6ZM7.5 11H16.5V12.5H7.5V11ZM7.5 14H16.5V15.5H7.5V14Z"/></svg></button>
                <button id="playlist-add-current" class="playlist-action-btn" type="button" title="Add to current" aria-label="Add to current"><svg class="playlist-action-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10.75 4.75C10.75 4.06 11.31 3.5 12 3.5C12.69 3.5 13.25 4.06 13.25 4.75V10.75H19.25C19.94 10.75 20.5 11.31 20.5 12C20.5 12.69 19.94 13.25 19.25 13.25H13.25V19.25C13.25 19.94 12.69 20.5 12 20.5C11.31 20.5 10.75 19.94 10.75 19.25V13.25H4.75C4.06 13.25 3.5 12.69 3.5 12C3.5 11.31 4.06 10.75 4.75 10.75H10.75V4.75Z"/></svg></button>
                <button id="playlist-save-as" class="playlist-action-btn" type="button" title="Save" aria-label="Save"><svg class="playlist-action-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6 3.5C4.9 3.5 4 4.4 4 5.5V18.5C4 19.6 4.9 20.5 6 20.5H18C19.1 20.5 20 19.6 20 18.5V8.5L15 3.5H6ZM8 6H13V9H8V6ZM7.5 12H16.5V17.5H7.5V12Z"/></svg></button>
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
    playlistCreate: root.querySelector('#playlist-create') as HTMLButtonElement,
    playlistAddCurrent: root.querySelector('#playlist-add-current') as HTMLButtonElement,
    playlistSaveAs: root.querySelector('#playlist-save-as') as HTMLButtonElement,
});