export type PlaylistTargetModalElements = {
    playlistTargetModal: HTMLDivElement;
    playlistTargetBackdrop: HTMLDivElement;
    playlistTargetClose: HTMLButtonElement;
    playlistTargetTitle: HTMLParagraphElement;
    playlistTargetMessage: HTMLParagraphElement;
    playlistTargetSelect: HTMLSelectElement;
    playlistTargetHint: HTMLParagraphElement;
    playlistTargetOpen: HTMLButtonElement;
    playlistTargetCreate: HTMLButtonElement;
    playlistTargetCancel: HTMLButtonElement;
    playlistTargetConfirm: HTMLButtonElement;
};

export const renderPlaylistTargetModal = (): string => `
    <div id="playlist-target-modal" class="playlist-target-modal" hidden>
        <div id="playlist-target-backdrop" class="playlist-target-backdrop"></div>
        <section class="playlist-target-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-target-title" aria-describedby="playlist-target-message">
            <header class="playlist-target-header">
                <p id="playlist-target-title" class="playlist-target-title">Add to playlist</p>
                <button id="playlist-target-close" class="playlist-target-close" type="button" aria-label="Close add to playlist dialog"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg></button>
            </header>
            <div class="playlist-target-content">
                <p id="playlist-target-message" class="playlist-target-message"></p>
                <label class="playlist-target-field" for="playlist-target-select">
                    <span class="playlist-target-field-label">Playlist</span>
                    <select id="playlist-target-select" class="playlist-target-select" aria-label="Choose playlist"></select>
                </label>
                <p id="playlist-target-hint" class="playlist-target-hint" hidden></p>
                <div class="playlist-target-tools">
                    <button id="playlist-target-open" class="playlist-target-action secondary" type="button">Open playlist…</button>
                    <button id="playlist-target-create" class="playlist-target-action secondary" type="button">Create playlist…</button>
                </div>
                <div class="playlist-target-actions">
                    <button id="playlist-target-cancel" class="playlist-target-action secondary" type="button">Cancel</button>
                    <button id="playlist-target-confirm" class="playlist-target-action" type="button">Add</button>
                </div>
            </div>
        </section>
    </div>
`;

export const getPlaylistTargetModalElements = (root: ParentNode): PlaylistTargetModalElements => ({
    playlistTargetModal: root.querySelector('#playlist-target-modal') as HTMLDivElement,
    playlistTargetBackdrop: root.querySelector('#playlist-target-backdrop') as HTMLDivElement,
    playlistTargetClose: root.querySelector('#playlist-target-close') as HTMLButtonElement,
    playlistTargetTitle: root.querySelector('#playlist-target-title') as HTMLParagraphElement,
    playlistTargetMessage: root.querySelector('#playlist-target-message') as HTMLParagraphElement,
    playlistTargetSelect: root.querySelector('#playlist-target-select') as HTMLSelectElement,
    playlistTargetHint: root.querySelector('#playlist-target-hint') as HTMLParagraphElement,
    playlistTargetOpen: root.querySelector('#playlist-target-open') as HTMLButtonElement,
    playlistTargetCreate: root.querySelector('#playlist-target-create') as HTMLButtonElement,
    playlistTargetCancel: root.querySelector('#playlist-target-cancel') as HTMLButtonElement,
    playlistTargetConfirm: root.querySelector('#playlist-target-confirm') as HTMLButtonElement,
});