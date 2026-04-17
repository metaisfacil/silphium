export type PlaylistModalElements = {
    playlistModal: HTMLDivElement;
    playlistBackdrop: HTMLDivElement;
    playlistDialog: HTMLElement;
    playlistClose: HTMLButtonElement;
    playlistTitle: HTMLParagraphElement;
    playlistSourceWrap: HTMLDivElement;
    playlistSourceButton: HTMLButtonElement;
    playlistSourceIcon: HTMLSpanElement;
    playlistSourceLabel: HTMLSpanElement;
    playlistSource: HTMLSelectElement;
    playlistSourceMenu: HTMLDivElement;
    playlistFilterToggle: HTMLButtonElement;
    playlistFilterInput: HTMLInputElement;
    playlistHydrationProgress: HTMLParagraphElement;
    playlistHydrationCount: HTMLSpanElement;
    playlistList: HTMLUListElement;
    playlistPreventDuplicateWrap: HTMLLabelElement;
    playlistPreventDuplicateCheckbox: HTMLInputElement;
    playlistOpen: HTMLButtonElement;
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
                <div class="playlist-header-control-region">
                    <div id="playlist-source-wrap" class="playlist-source-wrap" hidden>
                        <button id="playlist-source-button" class="playlist-source-button" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="playlist-source-menu">
                            <span id="playlist-source-icon" class="playlist-source-icon" aria-hidden="true"></span>
                            <span id="playlist-source-label" class="playlist-source-label">Playback Queue</span>
                            <span class="playlist-source-chevron" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M7.41 8.91C7.74 8.58 8.26 8.58 8.59 8.91L12 12.33L15.41 8.91C15.74 8.58 16.26 8.58 16.59 8.91C16.92 9.24 16.92 9.76 16.59 10.09L12.59 14.09C12.26 14.42 11.74 14.42 11.41 14.09L7.41 10.09C7.08 9.76 7.08 9.24 7.41 8.91Z"/></svg></span>
                        </button>
                        <div id="playlist-source-menu" class="playlist-source-menu" role="listbox" hidden></div>
                        <select id="playlist-source" class="playlist-source-native" aria-label="Select playlist view" tabindex="-1" hidden></select>
                    </div>
                    <div class="playlist-filter-panel">
                        <label class="playlist-filter-field" for="playlist-filter-input">
                            <span class="playlist-filter-icon" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10.5 4.25C7.05 4.25 4.25 7.05 4.25 10.5C4.25 13.95 7.05 16.75 10.5 16.75C11.99 16.75 13.36 16.23 14.44 15.36L18.54 19.46C18.83 19.75 19.3 19.75 19.59 19.46C19.89 19.17 19.89 18.7 19.59 18.41L15.49 14.31C16.36 13.23 16.88 11.86 16.88 10.38C16.88 6.94 14.07 4.25 10.5 4.25ZM5.75 10.5C5.75 7.88 7.88 5.75 10.5 5.75C13.12 5.75 15.25 7.88 15.25 10.5C15.25 13.12 13.12 15.25 10.5 15.25C7.88 15.25 5.75 13.12 5.75 10.5Z"/></svg></span>
                            <input id="playlist-filter-input" class="playlist-filter-input" type="search" placeholder="Filter tracks in this view" aria-label="Filter tracks in the current playlist view" spellcheck="false" autocomplete="off">
                        </label>
                    </div>
                </div>
                <div class="playlist-header-actions">
                    <div class="playlist-hydration-progress-slot">
                        <p id="playlist-hydration-progress" class="playlist-hydration-progress" hidden aria-live="polite">
                            <span class="playlist-hydration-spinner" aria-hidden="true"></span>
                            <span id="playlist-hydration-count" class="playlist-hydration-count">0 of 0</span>
                        </p>
                    </div>
                    <div class="playlist-header-buttons">
                        <button id="playlist-filter-toggle" class="playlist-header-icon-btn playlist-search-toggle" type="button" aria-label="Search playlist" aria-controls="playlist-filter-input" aria-expanded="false"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10.5 4.25C7.05 4.25 4.25 7.05 4.25 10.5C4.25 13.95 7.05 16.75 10.5 16.75C11.99 16.75 13.36 16.23 14.44 15.36L18.54 19.46C18.83 19.75 19.3 19.75 19.59 19.46C19.89 19.17 19.89 18.7 19.59 18.41L15.49 14.31C16.36 13.23 16.88 11.86 16.88 10.38C16.88 6.94 14.07 4.25 10.5 4.25ZM5.75 10.5C5.75 7.88 7.88 5.75 10.5 5.75C13.12 5.75 15.25 7.88 15.25 10.5C15.25 13.12 13.12 15.25 10.5 15.25C7.88 15.25 5.75 13.12 5.75 10.5Z"/></svg></button>
                        <button id="playlist-close" class="playlist-close" type="button" aria-label="Close playlist"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg></button>
                    </div>
                </div>
            </header>
            <ul id="playlist-list" class="playlist-list"></ul>
            <footer class="playlist-actions">
                <div class="playlist-actions-left">
                    <button id="playlist-add-current" class="playlist-action-btn" type="button" title="Add track to current playlist" aria-label="Add track to current playlist"><svg class="playlist-action-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10.75 4.75C10.75 4.06 11.31 3.5 12 3.5C12.69 3.5 13.25 4.06 13.25 4.75V10.75H19.25C19.94 10.75 20.5 11.31 20.5 12C20.5 12.69 19.94 13.25 19.25 13.25H13.25V19.25C13.25 19.94 12.69 20.5 12 20.5C11.31 20.5 10.75 19.94 10.75 19.25V13.25H4.75C4.06 13.25 3.5 12.69 3.5 12C3.5 11.31 4.06 10.75 4.75 10.75H10.75V4.75Z"/></svg></button>
                    <label id="playlist-prevent-duplicate-wrap" class="playlist-duplicate-toggle" title="Block adding the current track when it is already present in the active playlist">
                        <input id="playlist-prevent-duplicate" class="playlist-duplicate-toggle-input" type="checkbox" aria-label="Prevent duplicate current track">
                        <span class="playlist-duplicate-toggle-label">Prevent duplicates</span>
                    </label>
                </div>
                <div class="playlist-actions-right">
                    <button id="playlist-create" class="playlist-action-btn" type="button" title="Create new playlist" aria-label="Create new playlist"><svg class="playlist-action-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6 3.5C4.9 3.5 4 4.4 4 5.5V18.5C4 19.6 4.9 20.5 6 20.5H18C19.1 20.5 20 19.6 20 18.5V9L14.5 3.5H6ZM14 5.6L17.9 9.5H14V5.6ZM7.5 11H16.5V12.5H7.5V11ZM7.5 14H16.5V15.5H7.5V14Z"/></svg></button>
                    <button id="playlist-open" class="playlist-action-btn" type="button" title="Open playlist" aria-label="Open playlist"><svg class="playlist-action-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M4 6.5C4 5.12 5.12 4 6.5 4H10.09C10.75 4 11.37 4.26 11.83 4.72L13.11 6H17.5C18.88 6 20 7.12 20 8.5V17.5C20 18.88 18.88 20 17.5 20H6.5C5.12 20 4 18.88 4 17.5V6.5ZM12.75 10.75C12.75 10.06 13.31 9.5 14 9.5C14.69 9.5 15.25 10.06 15.25 10.75V12.75H17.25C17.94 12.75 18.5 13.31 18.5 14C18.5 14.69 17.94 15.25 17.25 15.25H15.25V17.25C15.25 17.94 14.69 18.5 14 18.5C13.31 18.5 12.75 17.94 12.75 17.25V15.25H10.75C10.06 15.25 9.5 14.69 9.5 14C9.5 13.31 10.06 12.75 10.75 12.75H12.75V10.75Z"/></svg></button>
                    <button id="playlist-save-as" class="playlist-action-btn" type="button" title="Save" aria-label="Save"><svg class="playlist-action-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6 3.5C4.9 3.5 4 4.4 4 5.5V18.5C4 19.6 4.9 20.5 6 20.5H18C19.1 20.5 20 19.6 20 18.5V8.5L15 3.5H6ZM8 6H13V9H8V6ZM7.5 12H16.5V17.5H7.5V12Z"/></svg></button>
                </div>
            </footer>
        </section>
    </div>
`;

export const getPlaylistModalElements = (root: ParentNode): PlaylistModalElements => ({
    playlistModal: root.querySelector('#playlist-modal') as HTMLDivElement,
    playlistBackdrop: root.querySelector('#playlist-backdrop') as HTMLDivElement,
    playlistDialog: root.querySelector('.playlist-dialog') as HTMLElement,
    playlistClose: root.querySelector('#playlist-close') as HTMLButtonElement,
    playlistTitle: root.querySelector('#playlist-title') as HTMLParagraphElement,
    playlistSourceWrap: root.querySelector('#playlist-source-wrap') as HTMLDivElement,
    playlistSourceButton: root.querySelector('#playlist-source-button') as HTMLButtonElement,
    playlistSourceIcon: root.querySelector('#playlist-source-icon') as HTMLSpanElement,
    playlistSourceLabel: root.querySelector('#playlist-source-label') as HTMLSpanElement,
    playlistSource: root.querySelector('#playlist-source') as HTMLSelectElement,
    playlistSourceMenu: root.querySelector('#playlist-source-menu') as HTMLDivElement,
    playlistFilterToggle: root.querySelector('#playlist-filter-toggle') as HTMLButtonElement,
    playlistFilterInput: root.querySelector('#playlist-filter-input') as HTMLInputElement,
    playlistHydrationProgress: root.querySelector('#playlist-hydration-progress') as HTMLParagraphElement,
    playlistHydrationCount: root.querySelector('#playlist-hydration-count') as HTMLSpanElement,
    playlistList: root.querySelector('#playlist-list') as HTMLUListElement,
    playlistPreventDuplicateWrap: root.querySelector('#playlist-prevent-duplicate-wrap') as HTMLLabelElement,
    playlistPreventDuplicateCheckbox: root.querySelector('#playlist-prevent-duplicate') as HTMLInputElement,
    playlistOpen: root.querySelector('#playlist-open') as HTMLButtonElement,
    playlistCreate: root.querySelector('#playlist-create') as HTMLButtonElement,
    playlistAddCurrent: root.querySelector('#playlist-add-current') as HTMLButtonElement,
    playlistSaveAs: root.querySelector('#playlist-save-as') as HTMLButtonElement,
});