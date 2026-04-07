export type SidebarQueueMenuElements = {
    sidebarQueueMenu: HTMLDivElement;
    sidebarQueuePlay: HTMLButtonElement;
    sidebarQueueAddNext: HTMLButtonElement;
    sidebarQueueEnd: HTMLButtonElement;
    sidebarQueueAddToPlaylist: HTMLButtonElement;
    sidebarQueueSendToDivider: HTMLHRElement;
    sidebarQueueSendToList: HTMLDivElement;
    sidebarQueueFeedbackDivider: HTMLHRElement;
    sidebarQueueLove: HTMLButtonElement;
    sidebarQueueHate: HTMLButtonElement;
};

export const renderSidebarQueueMenu = (): string => `
    <div id="sidebar-queue-menu" class="playlist-menu" role="menu" aria-label="Queue options" hidden>
        <button id="sidebar-queue-play" class="playlist-menu-item" type="button" role="menuitem">Play</button>
        <button id="sidebar-queue-add-next" class="playlist-menu-item" type="button" role="menuitem">Add next</button>
        <button id="sidebar-queue-end" class="playlist-menu-item" type="button" role="menuitem">Queue</button>
        <button id="sidebar-queue-add-to-playlist" class="playlist-menu-item" type="button" role="menuitem">Add to playlist</button>
        <hr id="sidebar-queue-send-to-divider" class="playlist-menu-divider" aria-hidden="true" hidden>
        <div id="sidebar-queue-send-to-list"></div>
        <hr id="sidebar-queue-feedback-divider" class="playlist-menu-divider" aria-hidden="true">
        <button id="sidebar-queue-love" class="playlist-menu-item" type="button" role="menuitem" hidden>Love</button>
        <button id="sidebar-queue-hate" class="playlist-menu-item" type="button" role="menuitem" hidden>Hate</button>
    </div>
`;

export const getSidebarQueueMenuElements = (root: ParentNode): SidebarQueueMenuElements => ({
    sidebarQueueMenu: root.querySelector('#sidebar-queue-menu') as HTMLDivElement,
    sidebarQueuePlay: root.querySelector('#sidebar-queue-play') as HTMLButtonElement,
    sidebarQueueAddNext: root.querySelector('#sidebar-queue-add-next') as HTMLButtonElement,
    sidebarQueueEnd: root.querySelector('#sidebar-queue-end') as HTMLButtonElement,
    sidebarQueueAddToPlaylist: root.querySelector('#sidebar-queue-add-to-playlist') as HTMLButtonElement,
    sidebarQueueSendToDivider: root.querySelector('#sidebar-queue-send-to-divider') as HTMLHRElement,
    sidebarQueueSendToList: root.querySelector('#sidebar-queue-send-to-list') as HTMLDivElement,
    sidebarQueueFeedbackDivider: root.querySelector('#sidebar-queue-feedback-divider') as HTMLHRElement,
    sidebarQueueLove: root.querySelector('#sidebar-queue-love') as HTMLButtonElement,
    sidebarQueueHate: root.querySelector('#sidebar-queue-hate') as HTMLButtonElement,
});
