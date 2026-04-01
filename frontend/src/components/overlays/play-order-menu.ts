export type PlayOrderMenuElements = {
    playOrderMenu: HTMLDivElement;
};

export const renderPlayOrderMenu = (): string => `
    <div id="play-order-menu" class="play-order-menu" role="menu" aria-label="Playback order" hidden>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="ordered-album">Ordered (album)</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="ordered-library">Ordered (library)</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="shuffle-album">Shuffle (album)</button>
        <button class="play-order-item" type="button" role="menuitemradio" data-play-order="shuffle-library">Shuffle (library)</button>
    </div>
`;

export const getPlayOrderMenuElements = (root: ParentNode): PlayOrderMenuElements => ({
    playOrderMenu: root.querySelector('#play-order-menu') as HTMLDivElement,
});