export type ExplorationModalElements = {
    explorationModal: HTMLDivElement;
    explorationTitle: HTMLParagraphElement;
    explorationContent: HTMLDivElement;
    explorationClose: HTMLButtonElement;
};

export declare const renderExplorationModal: () => string;
export declare const getExplorationModalElements: (root: ParentNode) => ExplorationModalElements;
