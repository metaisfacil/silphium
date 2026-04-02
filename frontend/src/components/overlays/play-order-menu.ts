export type PlayOrderMenuElements = {
    playOrderMenu: HTMLDivElement;
};

export const renderPlayOrderMenu = (): string => `
    <div id="play-order-menu" class="play-order-menu" role="menu" aria-label="Playback order" hidden>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="ordered-album">Ordered: Album</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="ordered-library">Ordered: Library</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="shuffle-album">Shuffle: Album</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="shuffle-library">Shuffle: Library</button>
    </div>
`;

export const getPlayOrderMenuElements = (root: ParentNode): PlayOrderMenuElements => ({
    playOrderMenu: root.querySelector('#play-order-menu') as HTMLDivElement,
});