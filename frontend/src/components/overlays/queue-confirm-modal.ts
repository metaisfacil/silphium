export type QueueConfirmModalElements = {
    queueConfirmModal: HTMLDivElement;
    queueConfirmBackdrop: HTMLDivElement;
    queueConfirmTitle: HTMLParagraphElement;
    queueConfirmMessage: HTMLParagraphElement;
    queueConfirmCancel: HTMLButtonElement;
    queueConfirmProceed: HTMLButtonElement;
};

export const renderQueueConfirmModal = (): string => `
    <div id="queue-confirm-modal" class="error-modal" hidden>
        <div id="queue-confirm-backdrop" class="error-backdrop"></div>
        <section class="error-dialog" role="dialog" aria-modal="true" aria-labelledby="queue-confirm-title" aria-describedby="queue-confirm-message">
            <header class="error-header">
                <p id="queue-confirm-title" class="error-title">Confirm queue action</p>
            </header>
            <div class="error-content">
                <p id="queue-confirm-message" class="error-message"></p>
                <div class="error-actions">
                    <button id="queue-confirm-cancel" class="error-ok" type="button">Cancel</button>
                    <button id="queue-confirm-proceed" class="error-ok" type="button">Continue</button>
                </div>
            </div>
        </section>
    </div>
`;

export const getQueueConfirmModalElements = (root: ParentNode): QueueConfirmModalElements => ({
    queueConfirmModal: root.querySelector('#queue-confirm-modal') as HTMLDivElement,
    queueConfirmBackdrop: root.querySelector('#queue-confirm-backdrop') as HTMLDivElement,
    queueConfirmTitle: root.querySelector('#queue-confirm-title') as HTMLParagraphElement,
    queueConfirmMessage: root.querySelector('#queue-confirm-message') as HTMLParagraphElement,
    queueConfirmCancel: root.querySelector('#queue-confirm-cancel') as HTMLButtonElement,
    queueConfirmProceed: root.querySelector('#queue-confirm-proceed') as HTMLButtonElement,
});
