// Exploration modal for MusicBrainz network graph
export type ExplorationModalElements = {
    explorationModal: HTMLDivElement;
    explorationTitle: HTMLParagraphElement;
    explorationContent: HTMLDivElement;
    explorationClose: HTMLButtonElement;
};

export const renderExplorationModal = (): string => `
    <div id="exploration-modal" class="exploration-modal" hidden>
        <section class="exploration-dialog" role="dialog" aria-modal="true" aria-labelledby="exploration-title">
            <button id="exploration-close" class="exploration-close" type="button" aria-label="Close exploration">✕</button>
            <p id="exploration-title" class="exploration-title">Connection Explorer</p>
            <div id="exploration-content" class="exploration-content"></div>
        </section>
    </div>
`;

export const getExplorationModalElements = (root: ParentNode): ExplorationModalElements => ({
    explorationModal: root.querySelector('#exploration-modal') as HTMLDivElement,
    explorationTitle: root.querySelector('#exploration-title') as HTMLParagraphElement,
    explorationContent: root.querySelector('#exploration-content') as HTMLDivElement,
    explorationClose: root.querySelector('#exploration-close') as HTMLButtonElement,
});
