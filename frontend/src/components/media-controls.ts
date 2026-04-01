export type MediaControlsElements = {
    trackTitle: HTMLParagraphElement;
    trackAlbum: HTMLParagraphElement;
  trackPosition: HTMLSpanElement;
    trackArtist: HTMLParagraphElement;
    trackTechnical: HTMLParagraphElement;
    coverFrame: HTMLDivElement;
    coverFlipper: HTMLDivElement;
    artistInfoName: HTMLParagraphElement;
    artistInfoType: HTMLParagraphElement;
    artistInfoCountry: HTMLParagraphElement;
    artistInfoLifeSpan: HTMLParagraphElement;
    artistInfoGenres: HTMLParagraphElement;
    artistInfoSummary: HTMLParagraphElement;
    artistInfoLinks: HTMLDivElement;
    coverArt: HTMLImageElement;
    currentTimeLabel: HTMLSpanElement;
    trackDurationLabel: HTMLSpanElement;
    seek: HTMLInputElement;
    back: HTMLButtonElement;
    playPause: HTMLButtonElement;
    forward: HTMLButtonElement;
    volume: HTMLInputElement;
};

export const renderMediaControls = (): string => `
    <main class="player-shell">
      <section class="player-card">
        <div id="cover-frame" class="cover-frame" role="button" tabindex="0" aria-label="Flip cover art">
          <div id="cover-flipper" class="cover-flipper">
            <div class="cover-face cover-front">
              <img id="cover-art" class="cover-art" alt="Album cover art">
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
            </div>
          </div>
        </div>
        <div class="track-meta">
          <div class="track-title-row">
            <p id="track-title" class="track-line track-title">No track loaded</p>
            <span id="track-position" class="track-position"></span>
          </div>
          <p id="track-album" class="track-line track-album">Unknown Album</p>
          <p id="track-artist" class="track-line track-artist">Unknown Artist</p>
          <p id="track-technical" class="track-line track-technical"></p>
        </div>
        <div class="time-row">
          <span id="current-time">0:00</span>
          <span id="track-duration">0:00</span>
        </div>
        <input id="seek" class="slider" type="range" min="0" max="0" value="0" step="0.1">
        <div class="controls-row">
          <button id="playlist-btn" class="control-btn" type="button" aria-label="Playlist"><svg width="18" height="18" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M 4 5 C 3.446 5 3 5.446 3 6 C 3 6.554 3.446 7 4 7 L 19 7 C 19.554 7 20 6.554 20 6 C 20 5.446 19.554 5 19 5 L 4 5 z M 4 12 C 3.446 12 3 12.446 3 13 C 3 13.554 3.446 14 4 14 L 22 14 C 22.554 14 23 13.554 23 13 C 23 12.446 22.554 12 22 12 L 4 12 z M 21.949219 17.003906 C 21.606467 17.003906 21.272206 17.037416 20.949219 17.103516 L 20.949219 20.955078 L 17.099609 20.955078 C 17.033519 21.278118 17 21.612328 17 21.955078 C 17 22.297828 17.033519 22.632088 17.099609 22.955078 L 20.949219 22.955078 L 20.949219 26.804688 C 21.272206 26.870788 21.606467 26.904297 21.949219 26.904297 C 22.29197 26.904297 22.626178 26.870788 22.949219 26.804688 L 22.949219 22.955078 L 26.800781 22.955078 C 26.866921 22.632088 26.900391 22.297828 26.900391 21.955078 C 26.900391 21.612328 26.866921 21.278118 26.800781 20.955078 L 22.949219 20.955078 L 22.949219 17.103516 C 22.626178 17.037416 22.29197 17.003906 21.949219 17.003906 z M 4 19 C 3.446 19 3 19.446 3 20 C 3 20.554 3.446 21 4 21 L 14 21 C 14.554 21 15 20.554 15 20 C 15 19.446 14.554 19 14 19 L 4 19 z"/></svg></button>
          <button id="back" class="control-btn" type="button" aria-label="Previous track">◀◀</button>
          <button id="play-pause" class="control-btn primary" type="button" aria-label="Play">▶</button>
          <button id="forward" class="control-btn" type="button" aria-label="Next track">▶▶</button>
          <div class="volume-wrap">
            <button id="volume-btn" class="control-btn" type="button" aria-label="Volume"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2.00299 11.7155C2.04033 9.87326 2.059 8.95215 2.67093 8.16363C2.78262 8.0197 2.9465 7.8487 3.08385 7.73274C3.83639 7.09741 4.82995 7.09741 6.81706 7.09741C7.527 7.09741 7.88197 7.09741 8.22035 7.00452C8.29067 6.98522 8.36024 6.96296 8.4289 6.93781C8.75936 6.81674 9.05574 6.60837 9.64851 6.19161C11.9872 4.54738 13.1565 3.72527 14.138 4.08241C14.3261 4.15088 14.5083 4.24972 14.671 4.37162C15.5194 5.00744 15.5839 6.48675 15.7128 9.44537C15.7606 10.5409 15.7931 11.4785 15.7931 12C15.7931 12.5215 15.7606 13.4591 15.7128 14.5546C15.5839 17.5132 15.5194 18.9926 14.671 19.6284C14.5083 19.7503 14.3261 19.8491 14.138 19.9176C13.1565 20.2747 11.9872 19.4526 9.64851 17.8084C9.05574 17.3916 8.75936 17.1833 8.4289 17.0622C8.36024 17.037 8.29067 17.0148 8.22035 16.9955C7.88197 16.9026 7.527 16.9026 6.81706 16.9026C4.82995 16.9026 3.83639 16.9026 3.08385 16.2673C2.9465 16.1513 2.78262 15.9803 2.67093 15.8364C2.059 15.0478 2.04033 14.1267 2.00299 12.2845C2.00103 12.1878 2 12.0928 2 12C2 11.9072 2.00103 11.8122 2.00299 11.7155Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M19.4895 5.55219C19.7821 5.29218 20.217 5.33434 20.4608 5.64635L19.931 6.11713C20.4608 5.64635 20.4606 5.64602 20.4608 5.64635L20.4619 5.6477L20.4631 5.64921L20.4658 5.65275L20.4727 5.66184C20.4779 5.6688 20.4844 5.67756 20.4921 5.68814C20.5075 5.70929 20.5275 5.73772 20.5515 5.77358C20.5995 5.84529 20.6635 5.94667 20.7379 6.07889C20.8868 6.34345 21.077 6.73092 21.2644 7.25038C21.6397 8.29107 22 9.85136 22 12.0002C22 14.1491 21.6397 15.7094 21.2644 16.7501C21.077 17.2695 20.8868 17.657 20.7379 17.9216C20.6635 18.0538 20.5995 18.1552 20.5515 18.2269C20.5275 18.2627 20.5075 18.2912 20.4921 18.3123C20.4844 18.3229 20.4779 18.3317 20.4727 18.3386L20.4658 18.3477L20.4631 18.3513L20.4619 18.3528C20.4616 18.3531 20.4608 18.3541 19.931 17.8833L20.4608 18.3541C20.217 18.6661 19.7821 18.7083 19.4895 18.4483C19.1983 18.1895 19.1578 17.729 19.3977 17.417C19.3983 17.4163 19.3994 17.4148 19.4009 17.4127C19.4058 17.406 19.4154 17.3925 19.4291 17.372C19.4565 17.3311 19.5003 17.2625 19.5552 17.1649C19.6649 16.9698 19.8195 16.6587 19.977 16.2221C20.2913 15.3508 20.6207 13.9695 20.6207 12.0002C20.6207 10.0309 20.2913 8.64968 19.977 7.77836C19.8195 7.34181 19.6649 7.03066 19.5552 6.8356C19.5003 6.73802 19.4565 6.66934 19.4291 6.62845C19.4154 6.608 19.4058 6.59449 19.4009 6.58778C19.3994 6.58561 19.3983 6.58416 19.3977 6.5834C19.3977 6.5834 19.3977 6.58341 19.3977 6.5834" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M17.7571 8.41595C18.0901 8.21871 18.51 8.34663 18.6949 8.70166L18.0921 9.0588C18.6949 8.70166 18.6948 8.70134 18.6949 8.70166L18.6956 8.70295L18.6963 8.70432L18.6978 8.7073L18.7014 8.71428L18.7102 8.73227C18.7169 8.74607 18.7251 8.76348 18.7345 8.78457C18.7533 8.82676 18.7772 8.88363 18.8042 8.95574C18.8584 9.10004 18.9251 9.3049 18.99 9.57476C19.1199 10.115 19.2415 10.9119 19.2415 12.0003C19.2415 13.0888 19.1199 13.8857 18.99 14.4259C18.9251 14.6958 18.8584 14.9007 18.8042 15.045C18.7772 15.1171 18.7533 15.1739 18.7345 15.2161C18.7251 15.2372 18.7169 15.2546 18.7102 15.2684L18.7014 15.2864L18.6978 15.2934L18.6963 15.2964L18.6956 15.2978C18.6954 15.2981 18.6949 15.299 18.0921 14.9419L18.6949 15.299C18.51 15.6541 18.0901 15.782 17.7571 15.5847C17.427 15.3892 17.3063 14.9474 17.4846 14.5938L17.4892 14.5838C17.4955 14.5697 17.5075 14.5415 17.5236 14.4987C17.5557 14.4132 17.6039 14.2688 17.6539 14.0606C17.7539 13.6448 17.8622 12.9709 17.8622 12.0003C17.8622 11.0298 17.7539 10.3559 17.6539 9.94007C17.6039 9.73193 17.5557 9.58748 17.5236 9.50197C17.5075 9.45918 17.4955 9.43102 17.4892 9.41691L17.4846 9.40687C17.3063 9.05332 17.427 8.61152 17.7571 8.41595Z" fill="currentColor"/></svg></button>
            <div class="volume-popout" aria-hidden="true">
              <input id="volume" class="slider" type="range" min="0" max="1" value="0.8" step="0.01">
            </div>
          </div>
        </div>
      </section>
    </main>
`;

export const getMediaControlsElements = (root: ParentNode): MediaControlsElements => ({
    trackTitle: root.querySelector('#track-title') as HTMLParagraphElement,
    trackAlbum: root.querySelector('#track-album') as HTMLParagraphElement,
  trackPosition: root.querySelector('#track-position') as HTMLSpanElement,
    trackArtist: root.querySelector('#track-artist') as HTMLParagraphElement,
    trackTechnical: root.querySelector('#track-technical') as HTMLParagraphElement,
    coverFrame: root.querySelector('#cover-frame') as HTMLDivElement,
    coverFlipper: root.querySelector('#cover-flipper') as HTMLDivElement,
    artistInfoName: root.querySelector('#artist-info-name') as HTMLParagraphElement,
    artistInfoType: root.querySelector('#artist-info-type') as HTMLParagraphElement,
    artistInfoCountry: root.querySelector('#artist-info-country') as HTMLParagraphElement,
    artistInfoLifeSpan: root.querySelector('#artist-info-life') as HTMLParagraphElement,
    artistInfoGenres: root.querySelector('#artist-info-genres') as HTMLParagraphElement,
    artistInfoSummary: root.querySelector('#artist-info-summary') as HTMLParagraphElement,
    artistInfoLinks: root.querySelector('#artist-info-links') as HTMLDivElement,
    coverArt: root.querySelector('#cover-art') as HTMLImageElement,
    currentTimeLabel: root.querySelector('#current-time') as HTMLSpanElement,
    trackDurationLabel: root.querySelector('#track-duration') as HTMLSpanElement,
    seek: root.querySelector('#seek') as HTMLInputElement,
    back: root.querySelector('#back') as HTMLButtonElement,
    playPause: root.querySelector('#play-pause') as HTMLButtonElement,
    forward: root.querySelector('#forward') as HTMLButtonElement,
    volume: root.querySelector('#volume') as HTMLInputElement,
});
