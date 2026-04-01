export type SidebarElements = {
    sidebarToggle: HTMLButtonElement;
    librarySidebar: HTMLElement;
    libraryPickFolder: HTMLButtonElement;
    libraryBack: HTMLButtonElement;
    libraryPath: HTMLParagraphElement;
    libraryBrowser: HTMLDivElement;
};

export const renderSidebar = (): string => `
    <button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="Open library">→</button>
    <aside id="library-sidebar" class="library-sidebar" aria-hidden="true">
      <div class="library-header">
        <h2>Library</h2>
        <button id="library-pick-folder" class="upload-btn" type="button">Choose Folder</button>
      </div>
      <div class="library-toolbar">
        <button id="library-back" class="library-back" type="button" aria-label="Go to parent folder">←</button>
        <p id="library-path" class="library-path">No folder selected</p>
      </div>
      <div id="library-browser" class="library-browser"></div>
    </aside>
`;

export const getSidebarElements = (root: ParentNode): SidebarElements => ({
    sidebarToggle: root.querySelector('#sidebar-toggle') as HTMLButtonElement,
    librarySidebar: root.querySelector('#library-sidebar') as HTMLElement,
    libraryPickFolder: root.querySelector('#library-pick-folder') as HTMLButtonElement,
    libraryBack: root.querySelector('#library-back') as HTMLButtonElement,
    libraryPath: root.querySelector('#library-path') as HTMLParagraphElement,
    libraryBrowser: root.querySelector('#library-browser') as HTMLDivElement,
});
