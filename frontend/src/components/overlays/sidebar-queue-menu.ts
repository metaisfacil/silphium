export type SidebarQueueMenuElements = {
    sidebarQueueMenu: HTMLDivElement;
    sidebarQueueAddNext: HTMLButtonElement;
    sidebarQueueEnd: HTMLButtonElement;
};

export const renderSidebarQueueMenu = (): string => `
    <div id="sidebar-queue-menu" class="playlist-menu" role="menu" aria-label="Queue options" hidden>
        <button id="sidebar-queue-add-next" class="playlist-menu-item" type="button" role="menuitem">Add next</button>
        <button id="sidebar-queue-end" class="playlist-menu-item" type="button" role="menuitem">Queue</button>
    </div>
`;

export const getSidebarQueueMenuElements = (root: ParentNode): SidebarQueueMenuElements => ({
    sidebarQueueMenu: root.querySelector('#sidebar-queue-menu') as HTMLDivElement,
    sidebarQueueAddNext: root.querySelector('#sidebar-queue-add-next') as HTMLButtonElement,
    sidebarQueueEnd: root.querySelector('#sidebar-queue-end') as HTMLButtonElement,
});
