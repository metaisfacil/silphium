export type SidebarElements = {
    sidebarToggle: HTMLButtonElement;
    librarySidebar: HTMLElement;
    libraryScanYieldIndicator: HTMLSpanElement;
  libraryExpandToggle: HTMLButtonElement;
    librarySettings: HTMLButtonElement;
    libraryAbout: HTMLButtonElement;
  sidebarSectionTrigger: HTMLButtonElement;
  sidebarSectionTriggerLabel: HTMLSpanElement;
  sidebarSectionMenu: HTMLDivElement;
  sidebarSectionOptionLibrary: HTMLButtonElement;
  sidebarSectionOptionSocial: HTMLButtonElement;
    sidebarPaneLibrary: HTMLElement;
    sidebarPaneSocial: HTMLElement;
    libraryBack: HTMLButtonElement;
    libraryPath: HTMLParagraphElement;
    librarySearch: HTMLInputElement;
    librarySort: HTMLSelectElement;
    libraryBrowser: HTMLDivElement;
    socialFeedStatus: HTMLParagraphElement;
    socialFeedList: HTMLDivElement;
};

export const renderSidebar = (): string => `
    <button id="sidebar-toggle" class="sidebar-toggle" type="button" aria-label="Open sidebar"><svg class="sidebar-toggle-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M4 6.5C4 5.67 4.67 5 5.5 5H18.5C19.33 5 20 5.67 20 6.5C20 7.33 19.33 8 18.5 8H5.5C4.67 8 4 7.33 4 6.5ZM4 12C4 11.17 4.67 10.5 5.5 10.5H18.5C19.33 10.5 20 11.17 20 12C20 12.83 19.33 13.5 18.5 13.5H5.5C4.67 13.5 4 12.83 4 12ZM4 17.5C4 16.67 4.67 16 5.5 16H18.5C19.33 16 20 16.67 20 17.5C20 18.33 19.33 19 18.5 19H5.5C4.67 19 4 18.33 4 17.5Z"/></svg></button>
    <button id="library-about" class="about-toggle" type="button" aria-label="About" title="About">i</button>
    <aside id="library-sidebar" class="library-sidebar" aria-hidden="true">
      <div class="library-header">
        <div class="library-header-title-wrap">
          <h2 class="library-header-title"><button id="sidebar-section-trigger" class="sidebar-section-trigger" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="sidebar-section-menu"><span id="sidebar-section-trigger-label">LIBRARY</span><svg class="sidebar-section-trigger-arrow" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M7.41 9.59C7.79 9.21 8.4 9.21 8.78 9.59L12 12.81L15.22 9.59C15.6 9.21 16.21 9.21 16.59 9.59C16.97 9.97 16.97 10.58 16.59 10.96L12.69 14.86C12.31 15.24 11.69 15.24 11.31 14.86L7.41 10.96C7.03 10.58 7.03 9.97 7.41 9.59Z"/></svg></button><span id="library-scan-yield-indicator" class="library-scan-yield-indicator" role="img" aria-label="Performance will be degraded until the library scan completes." title="Performance will be degraded until the library scan completes."><svg class="library-scan-yield-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M11.12 3.86C11.51 3.18 12.49 3.18 12.88 3.86L21.02 18.14C21.4 18.81 20.92 19.65 20.15 19.65H3.85C3.08 19.65 2.6 18.81 2.98 18.14L11.12 3.86Z"/><rect x="11" y="8" width="2" height="7" rx="1" fill="#101010"/><circle cx="12" cy="17.5" r="1.35" fill="#101010"/></svg></span></h2>
          <div id="sidebar-section-menu" class="sidebar-section-menu" role="menu" aria-label="Sidebar sections" hidden>
            <button id="sidebar-section-option-library" class="sidebar-section-menu-item is-active" type="button" role="menuitemradio" aria-checked="true">LIBRARY</button>
            <button id="sidebar-section-option-social" class="sidebar-section-menu-item" type="button" role="menuitemradio" aria-checked="false">SOCIAL</button>
          </div>
        </div>
        <div class="library-header-actions">
          <button id="library-expand-toggle" class="library-expand-toggle" type="button" aria-label="Expand album view" aria-pressed="false" title="Expand album view"><svg class="library-expand-toggle-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M4 9V4H9V6H6V9H4ZM18 9V6H15V4H20V9H18ZM4 15H6V18H9V20H4V15ZM18 15H20V20H15V18H18V15Z"/></svg></button>
          <button id="library-settings" class="upload-btn" type="button" aria-label="Settings" title="Settings"><svg class="library-settings-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M10.76 2.74C11.44 1.75 12.56 1.75 13.24 2.74L14.11 4.02C14.39 4.43 14.9 4.59 15.37 4.42L16.85 3.89C17.99 3.48 18.87 4.13 18.94 5.32L19.03 6.85C19.06 7.34 19.4 7.76 19.88 7.89L21.35 8.29C22.49 8.6 22.84 9.66 22.12 10.61L21.2 11.8C20.9 12.18 20.9 12.72 21.2 13.1L22.12 14.39C22.84 15.34 22.49 16.4 21.35 16.71L19.88 17.11C19.4 17.24 19.06 17.66 19.03 18.15L18.94 19.68C18.87 20.87 17.99 21.52 16.85 21.11L15.37 20.58C14.9 20.41 14.39 20.57 14.11 20.98L13.24 22.26C12.56 23.25 11.44 23.25 10.76 22.26L9.89 20.98C9.61 20.57 9.1 20.41 8.63 20.58L7.15 21.11C6.01 21.52 5.13 20.87 5.06 19.68L4.97 18.15C4.94 17.66 4.6 17.24 4.12 17.11L2.65 16.71C1.51 16.4 1.16 15.34 1.88 14.39L2.8 13.1C3.1 12.72 3.1 12.18 2.8 11.8L1.88 10.61C1.16 9.66 1.51 8.6 2.65 8.29L4.12 7.89C4.6 7.76 4.94 7.34 4.97 6.85L5.06 5.32C5.13 4.13 6.01 3.48 7.15 3.89L8.63 4.42C9.1 4.59 9.61 4.43 9.89 4.02L10.76 2.74ZM12 8.25C9.93 8.25 8.25 9.93 8.25 12C8.25 14.07 9.93 15.75 12 15.75C14.07 15.75 15.75 14.07 15.75 12C15.75 9.93 14.07 8.25 12 8.25Z"/></svg></button>
        </div>
      </div>
      <section id="sidebar-pane-library" class="sidebar-pane sidebar-pane-library">
        <div class="library-toolbar">
          <button id="library-back" class="library-back" type="button" aria-label="Go to parent folder"><svg class="library-back-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M14.53 5.47C15.12 6.06 15.12 7.01 14.53 7.6L10.12 12L14.53 16.4C15.12 16.99 15.12 17.94 14.53 18.53C13.94 19.12 12.99 19.12 12.4 18.53L6.94 13.06C6.35 12.47 6.35 11.53 6.94 10.94L12.4 5.47C12.99 4.88 13.94 4.88 14.53 5.47Z"/></svg></button>
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
          <select id="library-sort" class="library-sort" aria-label="Sort library browser">
            <option value="name" selected>Name</option>
            <option value="date-desc">Newest</option>
            <option value="date-asc">Oldest</option>
          </select>
        </div>
        <div id="library-browser" class="library-browser"></div>
      </section>
      <section id="sidebar-pane-social" class="sidebar-pane sidebar-pane-social" hidden>
        <p id="social-feed-status" class="social-feed-status" aria-live="polite"></p>
        <div id="social-feed-list" class="social-feed-list"></div>
      </section>
    </aside>
`;

export const getSidebarElements = (root: ParentNode): SidebarElements => ({
    sidebarToggle: root.querySelector('#sidebar-toggle') as HTMLButtonElement,
    librarySidebar: root.querySelector('#library-sidebar') as HTMLElement,
    libraryScanYieldIndicator: root.querySelector('#library-scan-yield-indicator') as HTMLSpanElement,
    libraryExpandToggle: root.querySelector('#library-expand-toggle') as HTMLButtonElement,
    librarySettings: root.querySelector('#library-settings') as HTMLButtonElement,
    libraryAbout: root.querySelector('#library-about') as HTMLButtonElement,
    sidebarSectionTrigger: root.querySelector('#sidebar-section-trigger') as HTMLButtonElement,
    sidebarSectionTriggerLabel: root.querySelector('#sidebar-section-trigger-label') as HTMLSpanElement,
    sidebarSectionMenu: root.querySelector('#sidebar-section-menu') as HTMLDivElement,
    sidebarSectionOptionLibrary: root.querySelector('#sidebar-section-option-library') as HTMLButtonElement,
    sidebarSectionOptionSocial: root.querySelector('#sidebar-section-option-social') as HTMLButtonElement,
    sidebarPaneLibrary: root.querySelector('#sidebar-pane-library') as HTMLElement,
    sidebarPaneSocial: root.querySelector('#sidebar-pane-social') as HTMLElement,
    libraryBack: root.querySelector('#library-back') as HTMLButtonElement,
    libraryPath: root.querySelector('#library-path') as HTMLParagraphElement,
    librarySearch: root.querySelector('#library-search') as HTMLInputElement,
    librarySort: root.querySelector('#library-sort') as HTMLSelectElement,
    libraryBrowser: root.querySelector('#library-browser') as HTMLDivElement,
    socialFeedStatus: root.querySelector('#social-feed-status') as HTMLParagraphElement,
    socialFeedList: root.querySelector('#social-feed-list') as HTMLDivElement,
});
