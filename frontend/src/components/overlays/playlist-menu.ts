export type PlaylistMenuElements = {
    playlistMenu: HTMLDivElement;
    playlistLoadBtn: HTMLButtonElement;
};

export const renderPlaylistMenu = (): string => `
    <div id="playlist-menu" class="playlist-menu" role="menu" aria-label="Playlist options" hidden>
        <button id="playlist-load-btn" class="playlist-menu-item" type="button" role="menuitem">Load M3U/M3U8…</button>
    </div>
`;

export const getPlaylistMenuElements = (root: ParentNode): PlaylistMenuElements => ({
    playlistMenu: root.querySelector('#playlist-menu') as HTMLDivElement,
    playlistLoadBtn: root.querySelector('#playlist-load-btn') as HTMLButtonElement,
});