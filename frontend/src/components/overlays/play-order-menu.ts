export type PlayOrderMenuElements = {
    playOrderMenu: HTMLDivElement;
};

export const renderPlayOrderMenu = (): string => `
    <div id="play-order-menu" class="play-order-menu" role="menu" aria-label="Playback order" hidden>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="ordered-release">Ordered: Release</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="shuffle-release">Shuffle: Release</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="ordered-source">Ordered: Current Source</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="shuffle-source">Shuffle: Current Source</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="ordered-library">Ordered: Full Library</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="shuffle-library">Shuffle: Full Library</button>
    </div>
`;

export const getPlayOrderMenuElements = (root: ParentNode): PlayOrderMenuElements => ({
    playOrderMenu: root.querySelector('#play-order-menu') as HTMLDivElement,
});