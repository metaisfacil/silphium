export type SidebarElements = {
    sidebarToggle: HTMLButtonElement;
    librarySidebar: HTMLElement;
    librarySettings: HTMLButtonElement;
  libraryAbout: HTMLButtonElement;
    libraryBack: HTMLButtonElement;
    libraryPath: HTMLParagraphElement;
    librarySearch: HTMLInputElement;
    libraryBrowser: HTMLDivElement;
};

export const renderSidebar = (): string => `
    <button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="Open library">‣‣‣</button>
    <aside id="library-sidebar" class="library-sidebar" aria-hidden="true">
      <div class="library-header">
        <h2>Library</h2>
        <div class="library-header-actions">
          <button id="library-about" class="upload-btn" type="button" aria-label="About" title="About">i</button>
          <button id="library-settings" class="upload-btn" type="button" aria-label="Settings" title="Settings">⚙</button>
        </div>
      </div>
      <div class="library-toolbar">
        <button id="library-back" class="library-back" type="button" aria-label="Go to parent folder">❮</button>
        <p id="library-path" class="library-path">No folder selected</p>
      </div>
      <div class="library-search-row">
        <input
          id="library-search"
          class="library-search"
          type="search"
          placeholder="Search files in library"
          aria-label="Search files in library"
          autocomplete="off"
          spellcheck="false"
        >
      </div>
      <div id="library-browser" class="library-browser"></div>
    </aside>
`;

export const getSidebarElements = (root: ParentNode): SidebarElements => ({
    sidebarToggle: root.querySelector('#sidebar-toggle') as HTMLButtonElement,
    librarySidebar: root.querySelector('#library-sidebar') as HTMLElement,
    librarySettings: root.querySelector('#library-settings') as HTMLButtonElement,
  libraryAbout: root.querySelector('#library-about') as HTMLButtonElement,
    libraryBack: root.querySelector('#library-back') as HTMLButtonElement,
    libraryPath: root.querySelector('#library-path') as HTMLParagraphElement,
    librarySearch: root.querySelector('#library-search') as HTMLInputElement,
    libraryBrowser: root.querySelector('#library-browser') as HTMLDivElement,
});
