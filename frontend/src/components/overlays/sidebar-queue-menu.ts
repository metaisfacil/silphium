export type SidebarQueueMenuElements = {
    sidebarQueueMenu: HTMLDivElement;
    sidebarQueuePlay: HTMLButtonElement;
    sidebarQueueAddNext: HTMLButtonElement;
    sidebarQueueEnd: HTMLButtonElement;
    sidebarQueueFeedbackDivider: HTMLDivElement;
    sidebarQueueLove: HTMLButtonElement;
    sidebarQueueHate: HTMLButtonElement;
};

export const renderSidebarQueueMenu = (): string => `
    <div id="sidebar-queue-menu" class="playlist-menu" role="menu" aria-label="Queue options" hidden>
        <button id="sidebar-queue-play" class="playlist-menu-item" type="button" role="menuitem">Play</button>
        <button id="sidebar-queue-add-next" class="playlist-menu-item" type="button" role="menuitem">Add next</button>
        <button id="sidebar-queue-end" class="playlist-menu-item" type="button" role="menuitem">Queue</button>
        <div id="sidebar-queue-feedback-divider" class="playlist-menu-divider" role="separator" aria-hidden="true" hidden></div>
        <button id="sidebar-queue-love" class="playlist-menu-item" type="button" role="menuitem" hidden>Love</button>
        <button id="sidebar-queue-hate" class="playlist-menu-item" type="button" role="menuitem" hidden>Hate</button>
    </div>
`;

export const getSidebarQueueMenuElements = (root: ParentNode): SidebarQueueMenuElements => ({
    sidebarQueueMenu: root.querySelector('#sidebar-queue-menu') as HTMLDivElement,
    sidebarQueuePlay: root.querySelector('#sidebar-queue-play') as HTMLButtonElement,
    sidebarQueueAddNext: root.querySelector('#sidebar-queue-add-next') as HTMLButtonElement,
    sidebarQueueEnd: root.querySelector('#sidebar-queue-end') as HTMLButtonElement,
    sidebarQueueFeedbackDivider: root.querySelector('#sidebar-queue-feedback-divider') as HTMLDivElement,
    sidebarQueueLove: root.querySelector('#sidebar-queue-love') as HTMLButtonElement,
    sidebarQueueHate: root.querySelector('#sidebar-queue-hate') as HTMLButtonElement,
});
