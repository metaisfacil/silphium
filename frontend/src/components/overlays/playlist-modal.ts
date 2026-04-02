export type PlaylistModalElements = {
    playlistModal: HTMLDivElement;
    playlistBackdrop: HTMLDivElement;
    playlistClose: HTMLButtonElement;
    playlistTitle: HTMLParagraphElement;
    playlistSource: HTMLSelectElement;
    playlistList: HTMLUListElement;
};

export const renderPlaylistModal = (): string => `
    <div id="playlist-modal" class="playlist-modal" hidden>
        <div id="playlist-backdrop" class="playlist-backdrop"></div>
        <section class="playlist-dialog" role="dialog" aria-modal="true" aria-label="Playlist viewer">
            <header class="playlist-header">
                <p id="playlist-title" class="playlist-title">Playlist</p>
                <select id="playlist-source" class="playlist-source" aria-label="Select playlist view" hidden></select>
                <button id="playlist-close" class="playlist-close" type="button" aria-label="Close playlist">✕</button>
            </header>
            <ul id="playlist-list" class="playlist-list"></ul>
        </section>
    </div>
`;

export const getPlaylistModalElements = (root: ParentNode): PlaylistModalElements => ({
    playlistModal: root.querySelector('#playlist-modal') as HTMLDivElement,
    playlistBackdrop: root.querySelector('#playlist-backdrop') as HTMLDivElement,
    playlistClose: root.querySelector('#playlist-close') as HTMLButtonElement,
    playlistTitle: root.querySelector('#playlist-title') as HTMLParagraphElement,
    playlistSource: root.querySelector('#playlist-source') as HTMLSelectElement,
    playlistList: root.querySelector('#playlist-list') as HTMLUListElement,
});