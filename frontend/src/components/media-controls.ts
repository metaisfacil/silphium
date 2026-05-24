export type MediaControlsElements = {
    playerShell: HTMLElement;
    playerLane: HTMLDivElement;
    playerCard: HTMLElement;
    playerTaskbar: HTMLElement;
    overviewPage: HTMLElement;
    overviewShowAlbums: HTMLButtonElement;
    overviewShowRecents: HTMLButtonElement;
    overviewTracksCount: HTMLSpanElement;
    overviewAlbumsCount: HTMLSpanElement;
    overviewArtistsCount: HTMLSpanElement;
    overviewLibrariesCount: HTMLSpanElement;
    overviewRecentsView: HTMLDivElement;
    overviewAlbumGridView: HTMLDivElement;
    overviewAlbumGrid: HTMLDivElement;
    overviewAlbumGridScrollRail: HTMLDivElement;
    overviewAlbumGridScrollPill: HTMLButtonElement;
    overviewAlbumGridScrollHint: HTMLDivElement;
    overviewLastPlayedList: HTMLDivElement;
    overviewLastAddedList: HTMLDivElement;
    taskbarCoverArt: HTMLImageElement;
    taskbarShowPlayer: HTMLButtonElement;
    taskbarShowOverview: HTMLButtonElement;
    playerVisualizerCanvas: HTMLCanvasElement;
    trackTitle: HTMLParagraphElement;
    trackAlbum: HTMLParagraphElement;
    trackPosition: HTMLSpanElement;
    trackArtist: HTMLParagraphElement;
    trackTechnical: HTMLButtonElement;
    trackTechnicalAlt: HTMLButtonElement;
    trackArtistHeader: HTMLParagraphElement;
    trackReleaseAlbum: HTMLSpanElement;
    trackReleaseLabel: HTMLSpanElement;
    trackReleaseYear: HTMLSpanElement;
    trackReleaseCat: HTMLSpanElement;
    trackTitleInline: HTMLSpanElement;
    trackPositionInline: HTMLSpanElement;
    trackGenreInline: HTMLSpanElement;
    lyricsPanel: HTMLElement;
    lyricsContent: HTMLPreElement;
    coverFrame: HTMLDivElement;
    coverFlipper: HTMLDivElement;
    artistInfoName: HTMLParagraphElement;
    artistInfoType: HTMLParagraphElement;
    artistInfoCountry: HTMLParagraphElement;
    artistInfoLifeSpan: HTMLParagraphElement;
    artistInfoGenres: HTMLParagraphElement;
    artistInfoSummary: HTMLParagraphElement;
    artistInfoLinks: HTMLDivElement;
    coverArtBackground: HTMLImageElement;
    coverArt: HTMLImageElement;
    currentTimeLabel: HTMLSpanElement;
    trackDurationLabel: HTMLSpanElement;
    seek: HTMLInputElement;
    listenBrainzLoveBtn: HTMLButtonElement;
    listenBrainzFeedbackMenu: HTMLDivElement;
    listenBrainzFeedbackLoveBtn: HTMLButtonElement;
    listenBrainzFeedbackHateBtn: HTMLButtonElement;
    playlistBtn: HTMLButtonElement;
    back: HTMLButtonElement;
    playPause: HTMLButtonElement;
    forward: HTMLButtonElement;
    shareBtn: HTMLButtonElement;
    volume: HTMLInputElement;
};

const renderPlayIcon = (): string => `
    <svg class="control-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M8 5.5C8 4.74 8.82 4.26 9.48 4.65L19.44 10.45C20.11 10.84 20.11 11.8 19.44 12.19L9.48 17.99C8.82 18.38 8 17.9 8 17.14V5.5Z"/>
    </svg>
`;

const renderPauseIcon = (): string => `
    <svg class="control-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M8 5.5C8 4.67 8.67 4 9.5 4C10.33 4 11 4.67 11 5.5V18.5C11 19.33 10.33 20 9.5 20C8.67 20 8 19.33 8 18.5V5.5Z"/>
      <path fill="currentColor" d="M13 5.5C13 4.67 13.67 4 14.5 4C15.33 4 16 4.67 16 5.5V18.5C16 19.33 15.33 20 14.5 20C13.67 20 13 19.33 13 18.5V5.5Z"/>
    </svg>
`;

const renderShareIcon = (): string => `
    <svg class="control-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M15 5.75C15 4.23 16.23 3 17.75 3C19.27 3 20.5 4.23 20.5 5.75C20.5 7.27 19.27 8.5 17.75 8.5C17.05 8.5 16.42 8.24 15.94 7.81L8.91 11.83C8.97 12.1 9 12.42 9 12.75C9 13.08 8.97 13.4 8.91 13.67L15.94 17.69C16.42 17.26 17.05 17 17.75 17C19.27 17 20.5 18.23 20.5 19.75C20.5 21.27 19.27 22.5 17.75 22.5C16.23 22.5 15 21.27 15 19.75C15 19.42 15.03 19.1 15.09 18.83L8.06 14.81C7.58 15.24 6.95 15.5 6.25 15.5C4.73 15.5 3.5 14.27 3.5 12.75C3.5 11.23 4.73 10 6.25 10C6.95 10 7.58 10.26 8.06 10.69L15.09 6.67C15.03 6.4 15 6.08 15 5.75Z"/>
    </svg>
`;

const renderHomeIcon = (): string => `
    <svg class="control-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d="M12 2L1.5 10.5L3 12L5 10.4V21H10V15H14V21H19V10.4L21 12L22.5 10.5L12 2Z"/>
    </svg>
`;

export const renderPlayPauseIcon = (state: 'play' | 'pause'): string =>
    state === 'pause' ? renderPauseIcon() : renderPlayIcon();

export const renderMediaControls = (): string => `
    <main class="player-shell">
      <section id="overview-page" class="overview-page">
        <div class="overview-stats-grid">
          <article class="overview-stat-card">
            <span id="overview-tracks-count" class="overview-stat-value">0</span>
            <span class="overview-stat-label">Tracks</span>
          </article>
          <button id="overview-show-albums" class="overview-stat-card overview-stat-card-button" type="button" aria-pressed="false">
            <span id="overview-albums-count" class="overview-stat-value">0</span>
            <span class="overview-stat-label">Albums</span>
          </button>
          <article class="overview-stat-card">
            <span id="overview-artists-count" class="overview-stat-value">0</span>
            <span class="overview-stat-label">Artists</span>
          </article>
          <button id="overview-show-recents" class="overview-stat-card overview-stat-card-button" type="button" aria-pressed="true">
            <span id="overview-libraries-count" class="overview-stat-value">0</span>
            <span class="overview-stat-label">Libraries</span>
          </button>
        </div>
        <div id="overview-recents-view" class="overview-content-grid">
          <section class="overview-section-card" aria-labelledby="overview-last-played-heading">
            <div class="overview-section-header">
              <h2 id="overview-last-played-heading" class="overview-section-title">Last played tracks</h2>
            </div>
            <div id="overview-last-played-list" class="overview-album-list">
              <p class="overview-empty">No listen history yet.</p>
            </div>
          </section>
          <section class="overview-section-card" aria-labelledby="overview-last-added-heading">
            <div class="overview-section-header">
              <h2 id="overview-last-added-heading" class="overview-section-title">Last added albums</h2>
            </div>
            <div id="overview-last-added-list" class="overview-album-list">
              <p class="overview-empty">No recently added albums yet.</p>
            </div>
          </section>
        </div>
        <div class="overview-album-grid-shell" hidden>
          <div id="overview-album-grid-view" class="overview-album-grid-view" hidden>
            <div id="overview-album-grid" class="library-album-grid">
              <p class="library-album-grid-empty">No albums in library</p>
            </div>
          </div>
          <div id="overview-album-grid-scroll-rail" class="overview-album-grid-scroll-rail" hidden aria-hidden="true">
            <button id="overview-album-grid-scroll-pill" class="overview-album-grid-scroll-pill" type="button" tabindex="-1" aria-hidden="true"></button>
            <div id="overview-album-grid-scroll-hint" class="overview-album-grid-scroll-hint" hidden aria-hidden="true"></div>
          </div>
        </div>
      </section>
      <div id="player-lane" class="player-lane">
      <section id="player-card" class="player-card">
        <canvas id="player-visualizer" class="player-visualizer-canvas" aria-hidden="true"></canvas>
        <p id="track-artist-header" class="track-artist-header"></p>
        <div id="cover-frame" class="cover-frame" role="button" tabindex="0" aria-label="Flip cover art">
          <div id="cover-flipper" class="cover-flipper">
            <div class="cover-face cover-front">
              <img id="cover-art-bg" class="cover-art-bg" alt="" aria-hidden="true" draggable="false">
              <img id="cover-art" class="cover-art" alt="Album cover art" draggable="false">
            </div>
            <div class="cover-face cover-back">
              <div class="artist-info">
                <p id="artist-info-name" class="artist-info-name">No artist info</p>
                <p id="artist-info-type" class="artist-info-line">Type: —</p>
                <p id="artist-info-country" class="artist-info-line">Country: —</p>
                <p id="artist-info-life" class="artist-info-line">Life span: —</p>
                <p id="artist-info-genres" class="artist-info-line">Genres: —</p>
                <p id="artist-info-summary" class="artist-info-summary">Flip back after MBID lookup to see details.</p>
                <div id="artist-info-links" class="artist-info-links"></div>
              </div>
              <button id="exploration-btn" class="exploration-btn" type="button" aria-label="Explore connections between entities" hidden><svg class="control-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12 3.5C7.31 3.5 3.5 7.31 3.5 12C3.5 16.69 7.31 20.5 12 20.5C16.69 20.5 20.5 16.69 20.5 12C20.5 7.31 16.69 3.5 12 3.5ZM18.73 11H15.86C15.76 9.06 15.22 7.23 14.34 5.78C16.52 6.56 18.16 8.56 18.73 11ZM12 5.24C13.01 6.57 13.63 8.7 13.74 11H10.26C10.37 8.7 10.99 6.57 12 5.24ZM9.66 5.78C8.78 7.23 8.24 9.06 8.14 11H5.27C5.84 8.56 7.48 6.56 9.66 5.78ZM5.27 13H8.14C8.24 14.94 8.78 16.77 9.66 18.22C7.48 17.44 5.84 15.44 5.27 13ZM12 18.76C10.99 17.43 10.37 15.3 10.26 13H13.74C13.63 15.3 13.01 17.43 12 18.76ZM14.34 18.22C15.22 16.77 15.76 14.94 15.86 13H18.73C18.16 15.44 16.52 17.44 14.34 18.22Z"/></svg></button>
              <button id="track-technical-alt" class="track-technical" type="button" aria-label="Show track technical details" disabled></button>
            </div>
          </div>
        </div>
        <div class="track-release-meta">
          <span id="track-release-album" class="track-release-album"></span>
          <span id="track-release-label" class="track-release-label"></span>
          <span id="track-release-year" class="track-release-year"></span>
          <span id="track-release-cat" class="track-release-cat"></span>
        </div>
      </section>
      <aside id="lyrics-panel" class="lyrics-panel" aria-hidden="true">
        <p class="lyrics-title">Lyrics</p>
        <pre id="lyrics-content" class="lyrics-content"></pre>
      </aside>
      </div>
      <section id="player-taskbar" class="player-taskbar">
        <div class="player-taskbar-primary">
          <button id="taskbar-show-player" class="player-taskbar-cover-button" type="button" aria-label="Show now playing">
            <img id="taskbar-cover-art" class="player-taskbar-cover-art" alt="Current album cover" draggable="false">
          </button>
          <div class="track-meta">
            <div class="track-title-row">
              <p id="track-title" class="track-line track-title">Unknown Title</p>
              <span id="track-position" class="track-position"></span>
            </div>
            <p id="track-album" class="track-line track-album">Unknown Album</p>
            <p id="track-artist" class="track-line track-artist">Unknown Artist</p>
          </div>
        </div>
        <div class="player-taskbar-center">
          <div class="time-row">
            <span id="current-time">0:00</span>
            <span class="track-time-center">
              <button id="track-technical" class="track-technical" type="button" aria-label="Show track technical details" disabled></button>
              <span id="track-title-inline" class="track-title-inline"></span>
              <span id="track-position-inline" class="track-position-inline"></span>
              <span id="track-genre-inline" class="track-genre-inline"></span>
            </span>
            <span id="track-duration">0:00</span>
          </div>
          <input id="seek" class="slider" type="range" min="0" max="0" value="0" step="0.1">
          <div class="controls-row">
            <button id="listenbrainz-love-btn" class="control-btn listenbrainz-love-btn" type="button" aria-label="Love on ListenBrainz" title="Love on ListenBrainz"><svg class="control-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12 20.5C11.64 20.5 11.28 20.37 11 20.11C9.77 18.96 8.6 17.89 7.58 16.96C4.52 14.16 2.5 12.31 2.5 9.5C2.5 6.85 4.59 4.75 7.25 4.75C8.75 4.75 10.19 5.45 11.13 6.56L12 7.6L12.87 6.56C13.81 5.45 15.25 4.75 16.75 4.75C19.41 4.75 21.5 6.85 21.5 9.5C21.5 12.31 19.48 14.16 16.42 16.96C15.4 17.89 14.23 18.96 13 20.11C12.72 20.37 12.36 20.5 12 20.5Z"/></svg></button>
            <button id="playlist-btn" class="control-btn" type="button" aria-label="Playlist"><svg width="18" height="18" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M 4 5 C 3.446 5 3 5.446 3 6 C 3 6.554 3.446 7 4 7 L 19 7 C 19.554 7 20 6.554 20 6 C 20 5.446 19.554 5 19 5 L 4 5 z M 4 12 C 3.446 12 3 12.446 3 13 C 3 13.554 3.446 14 4 14 L 22 14 C 22.554 14 23 13.554 23 13 C 23 12.446 22.554 12 22 12 L 4 12 z M 21.949219 17.003906 C 21.606467 17.003906 21.272206 17.037416 20.949219 17.103516 L 20.949219 20.955078 L 17.099609 20.955078 C 17.033519 21.278118 17 21.612328 17 21.955078 C 17 22.297828 17.033519 22.632088 17.099609 22.955078 L 20.949219 22.955078 L 20.949219 26.804688 C 21.272206 26.870788 21.606467 26.904297 21.949219 26.904297 C 22.29197 26.904297 22.626178 26.870788 22.949219 26.804688 L 22.949219 22.955078 L 26.800781 22.955078 C 26.866921 22.632088 26.900391 22.297828 26.900391 21.955078 C 26.900391 21.612328 26.866921 21.278118 26.800781 20.955078 L 22.949219 20.955078 L 22.949219 17.103516 C 22.626178 17.037416 22.29197 17.003906 21.949219 17.003906 z M 4 19 C 3.446 19 3 19.446 3 20 C 3 20.554 3.446 21 4 21 L 14 21 C 14.554 21 15 20.554 15 20 C 15 19.446 14.554 19 14 19 L 4 19 z"/></svg></button>
            <button id="back" class="control-btn" type="button" aria-label="Previous track"><svg class="control-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M7 5.5C7 4.67 6.33 4 5.5 4C4.67 4 4 4.67 4 5.5V18.5C4 19.33 4.67 20 5.5 20C6.33 20 7 19.33 7 18.5V5.5Z"/><path fill="currentColor" d="M18.47 4.65C17.81 4.26 17 4.74 17 5.5V17.14C17 17.9 17.81 18.38 18.47 17.99L8.51 12.19C7.85 11.8 7.85 10.84 8.51 10.45L18.47 4.65Z"/></svg></button>
            <button id="play-pause" class="control-btn primary" type="button" aria-label="Play">${renderPlayPauseIcon('play')}</button>
            <button id="forward" class="control-btn" type="button" aria-label="Next track"><svg class="control-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M17 5.5C17 4.67 17.67 4 18.5 4C19.33 4 20 4.67 20 5.5V18.5C20 19.33 19.33 20 18.5 20C17.67 20 17 19.33 17 18.5V5.5Z"/><path fill="currentColor" d="M5.53 4.65C6.19 4.26 7 4.74 7 5.5V17.14C7 17.9 6.19 18.38 5.53 17.99L15.49 12.19C16.15 11.8 16.15 10.84 15.49 10.45L5.53 4.65Z"/></svg></button>
            <div class="volume-wrap">
              <button id="volume-btn" class="control-btn" type="button" aria-label="Volume"><svg class="control-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M4 10.25C4 9.56 4.56 9 5.25 9H8.72L12.23 5.49C13.02 4.7 14.38 5.26 14.38 6.37V17.63C14.38 18.74 13.02 19.3 12.23 18.51L8.72 15H5.25C4.56 15 4 14.44 4 13.75V10.25Z"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M17 9.2C17.93 9.95 18.5 11.1 18.5 12.35C18.5 13.6 17.93 14.75 17 15.5"/><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M18.95 7C20.45 8.24 21.35 10.2 21.35 12.35C21.35 14.5 20.45 16.46 18.95 17.7"/></svg></button>
              <div class="volume-popout" aria-hidden="true">
                <input id="volume" class="slider" type="range" min="0" max="1" value="0.8" step="0.01">
              </div>
            </div>
            <button id="share-btn" class="control-btn share-btn" type="button" aria-label="Share current track" title="Share current track">${renderShareIcon()}</button>
          </div>
          <div id="listenbrainz-feedback-menu" class="track-meta-menu listenbrainz-feedback-menu" role="menu" aria-label="ListenBrainz feedback" hidden>
            <button id="listenbrainz-feedback-love-btn" class="track-meta-menu-item" type="button" role="menuitem">Love</button>
            <button id="listenbrainz-feedback-hate-btn" class="track-meta-menu-item" type="button" role="menuitem">Hate</button>
          </div>
        </div>
        <div class="player-taskbar-secondary">
          <button id="taskbar-show-overview" class="control-btn player-taskbar-overview-btn" type="button" aria-label="Show overview" title="Show overview">${renderHomeIcon()}</button>
        </div>
      </section>
    </main>
`;

export const getMediaControlsElements = (root: ParentNode): MediaControlsElements => ({
    playerShell: root.querySelector('.player-shell') as HTMLElement,
    playerLane: root.querySelector('#player-lane') as HTMLDivElement,
    playerCard: root.querySelector('#player-card') as HTMLElement,
    playerTaskbar: root.querySelector('#player-taskbar') as HTMLElement,
    overviewPage: root.querySelector('#overview-page') as HTMLElement,
    overviewShowAlbums: root.querySelector('#overview-show-albums') as HTMLButtonElement,
    overviewShowRecents: root.querySelector('#overview-show-recents') as HTMLButtonElement,
    overviewTracksCount: root.querySelector('#overview-tracks-count') as HTMLSpanElement,
    overviewAlbumsCount: root.querySelector('#overview-albums-count') as HTMLSpanElement,
    overviewArtistsCount: root.querySelector('#overview-artists-count') as HTMLSpanElement,
    overviewLibrariesCount: root.querySelector('#overview-libraries-count') as HTMLSpanElement,
    overviewRecentsView: root.querySelector('#overview-recents-view') as HTMLDivElement,
    overviewAlbumGridView: root.querySelector('#overview-album-grid-view') as HTMLDivElement,
    overviewAlbumGrid: root.querySelector('#overview-album-grid') as HTMLDivElement,
    overviewAlbumGridScrollRail: root.querySelector('#overview-album-grid-scroll-rail') as HTMLDivElement,
    overviewAlbumGridScrollPill: root.querySelector('#overview-album-grid-scroll-pill') as HTMLButtonElement,
    overviewAlbumGridScrollHint: root.querySelector('#overview-album-grid-scroll-hint') as HTMLDivElement,
    overviewLastPlayedList: root.querySelector('#overview-last-played-list') as HTMLDivElement,
    overviewLastAddedList: root.querySelector('#overview-last-added-list') as HTMLDivElement,
    taskbarCoverArt: root.querySelector('#taskbar-cover-art') as HTMLImageElement,
    taskbarShowPlayer: root.querySelector('#taskbar-show-player') as HTMLButtonElement,
    taskbarShowOverview: root.querySelector('#taskbar-show-overview') as HTMLButtonElement,
    playerVisualizerCanvas: root.querySelector('#player-visualizer') as HTMLCanvasElement,
    trackTitle: root.querySelector('#track-title') as HTMLParagraphElement,
    trackAlbum: root.querySelector('#track-album') as HTMLParagraphElement,
    trackPosition: root.querySelector('#track-position') as HTMLSpanElement,
    trackArtist: root.querySelector('#track-artist') as HTMLParagraphElement,
    trackTechnical: root.querySelector('#track-technical') as HTMLButtonElement,
    trackTechnicalAlt: root.querySelector('#track-technical-alt') as HTMLButtonElement,
    trackArtistHeader: root.querySelector('#track-artist-header') as HTMLParagraphElement,
    trackReleaseAlbum: root.querySelector('#track-release-album') as HTMLSpanElement,
    trackReleaseLabel: root.querySelector('#track-release-label') as HTMLSpanElement,
    trackReleaseYear: root.querySelector('#track-release-year') as HTMLSpanElement,
    trackReleaseCat: root.querySelector('#track-release-cat') as HTMLSpanElement,
    trackTitleInline: root.querySelector('#track-title-inline') as HTMLSpanElement,
    trackPositionInline: root.querySelector('#track-position-inline') as HTMLSpanElement,
    trackGenreInline: root.querySelector('#track-genre-inline') as HTMLSpanElement,
    lyricsPanel: root.querySelector('#lyrics-panel') as HTMLElement,
    lyricsContent: root.querySelector('#lyrics-content') as HTMLPreElement,
    coverFrame: root.querySelector('#cover-frame') as HTMLDivElement,
    coverFlipper: root.querySelector('#cover-flipper') as HTMLDivElement,
    artistInfoName: root.querySelector('#artist-info-name') as HTMLParagraphElement,
    artistInfoType: root.querySelector('#artist-info-type') as HTMLParagraphElement,
    artistInfoCountry: root.querySelector('#artist-info-country') as HTMLParagraphElement,
    artistInfoLifeSpan: root.querySelector('#artist-info-life') as HTMLParagraphElement,
    artistInfoGenres: root.querySelector('#artist-info-genres') as HTMLParagraphElement,
    artistInfoSummary: root.querySelector('#artist-info-summary') as HTMLParagraphElement,
    artistInfoLinks: root.querySelector('#artist-info-links') as HTMLDivElement,
    coverArtBackground: root.querySelector('#cover-art-bg') as HTMLImageElement,
    coverArt: root.querySelector('#cover-art') as HTMLImageElement,
    currentTimeLabel: root.querySelector('#current-time') as HTMLSpanElement,
    trackDurationLabel: root.querySelector('#track-duration') as HTMLSpanElement,
    seek: root.querySelector('#seek') as HTMLInputElement,
    listenBrainzLoveBtn: root.querySelector('#listenbrainz-love-btn') as HTMLButtonElement,
    listenBrainzFeedbackMenu: root.querySelector('#listenbrainz-feedback-menu') as HTMLDivElement,
    listenBrainzFeedbackLoveBtn: root.querySelector('#listenbrainz-feedback-love-btn') as HTMLButtonElement,
    listenBrainzFeedbackHateBtn: root.querySelector('#listenbrainz-feedback-hate-btn') as HTMLButtonElement,
    playlistBtn: root.querySelector('#playlist-btn') as HTMLButtonElement,
    back: root.querySelector('#back') as HTMLButtonElement,
    playPause: root.querySelector('#play-pause') as HTMLButtonElement,
    forward: root.querySelector('#forward') as HTMLButtonElement,
    shareBtn: root.querySelector('#share-btn') as HTMLButtonElement,
    volume: root.querySelector('#volume') as HTMLInputElement,
});
