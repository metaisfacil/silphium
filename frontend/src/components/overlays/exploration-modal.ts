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
            <button id="exploration-close" class="exploration-close" type="button" aria-label="Close exploration"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg></button>
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
