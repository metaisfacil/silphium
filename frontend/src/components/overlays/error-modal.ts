export type ErrorModalElements = {
    errorModal: HTMLDivElement;
    errorBackdrop: HTMLDivElement;
    errorTitle: HTMLParagraphElement;
    errorMessage: HTMLParagraphElement;
    errorClose: HTMLButtonElement;
    errorOk: HTMLButtonElement;
};

export const renderErrorModal = (): string => `
    <div id="error-modal" class="error-modal" hidden>
        <div id="error-backdrop" class="error-backdrop"></div>
        <section class="error-dialog" role="dialog" aria-modal="true" aria-labelledby="error-title" aria-describedby="error-message">
            <header class="error-header">
                <p id="error-title" class="error-title">Error</p>
                <button id="error-close" class="error-close" type="button" aria-label="Close error dialog"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg></button>
            </header>
            <div class="error-content">
                <p id="error-message" class="error-message"></p>
                <div class="error-actions">
                    <button id="error-ok" class="error-ok" type="button">OK</button>
                </div>
            </div>
        </section>
    </div>
`;

export const getErrorModalElements = (root: ParentNode): ErrorModalElements => ({
    errorModal: root.querySelector('#error-modal') as HTMLDivElement,
    errorBackdrop: root.querySelector('#error-backdrop') as HTMLDivElement,
    errorTitle: root.querySelector('#error-title') as HTMLParagraphElement,
    errorMessage: root.querySelector('#error-message') as HTMLParagraphElement,
    errorClose: root.querySelector('#error-close') as HTMLButtonElement,
    errorOk: root.querySelector('#error-ok') as HTMLButtonElement,
});
