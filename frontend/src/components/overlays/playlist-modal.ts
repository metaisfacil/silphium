export type PlaylistModalElements = {
    playlistModal: HTMLDivElement;
    playlistBackdrop: HTMLDivElement;
    playlistClose: HTMLButtonElement;
    playlistTitle: HTMLParagraphElement;
    playlistList: HTMLUListElement;
};

export const renderPlaylistModal = (): string => `
    <div id="playlist-modal" class="playlist-modal" hidden>
        <div id="playlist-backdrop" class="playlist-backdrop"></div>
        <section class="playlist-dialog" role="dialog" aria-modal="true" aria-labelledby="playlist-title">
            <header class="playlist-header">
                <p id="playlist-title" class="playlist-title">Playlist</p>
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
    playlistList: root.querySelector('#playlist-list') as HTMLUListElement,
});