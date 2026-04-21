export type ShareModalElements = {
    shareModal: HTMLDivElement;
    shareBackdrop: HTMLDivElement;
    shareDialog: HTMLElement;
    shareClose: HTMLButtonElement;
    sharePreview: HTMLCanvasElement;
    shareStreamingLinksRegion: HTMLDivElement;
    shareStreamingLinks: HTMLDivElement;
    shareCommentInput: HTMLTextAreaElement;
    shareStatus: HTMLParagraphElement;
    shareSave: HTMLButtonElement;
    shareCopy: HTMLButtonElement;
};

export const renderShareModal = (): string => `
    <div id="share-modal" class="share-modal" hidden>
        <div id="share-backdrop" class="share-backdrop"></div>
        <section id="share-dialog" class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
            <header class="share-header">
                <p id="share-title" class="share-title">Share current track</p>
                <button id="share-close" class="share-close" type="button" aria-label="Close share dialog"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg></button>
            </header>
            <div class="share-content">
                <div class="share-preview-shell">
                    <canvas id="share-preview" class="share-preview" width="600" height="350" role="img" aria-label="Share image preview"></canvas>
                </div>
                <div id="share-streaming-links-region" class="share-streaming-links-region" hidden>
                    <div id="share-streaming-links" class="share-streaming-links" role="list" aria-label="Recording streaming links"></div>
                </div>
                <div class="share-field">
                    <textarea id="share-comment-input" class="share-comment-input" rows="3" maxlength="220" placeholder="Add a short comment to include in the image."></textarea>
                </div>
                <p id="share-status" class="share-status" aria-live="polite"></p>
                <div class="share-actions">
                    <button id="share-save" class="settings-secondary-btn" type="button">Save</button>
                    <button id="share-copy" class="upload-btn" type="button">Copy</button>
                </div>
            </div>
        </section>
    </div>
`;

export const getShareModalElements = (root: ParentNode): ShareModalElements => ({
    shareModal: root.querySelector('#share-modal') as HTMLDivElement,
    shareBackdrop: root.querySelector('#share-backdrop') as HTMLDivElement,
    shareDialog: root.querySelector('#share-dialog') as HTMLElement,
    shareClose: root.querySelector('#share-close') as HTMLButtonElement,
    sharePreview: root.querySelector('#share-preview') as HTMLCanvasElement,
    shareStreamingLinksRegion: root.querySelector('#share-streaming-links-region') as HTMLDivElement,
    shareStreamingLinks: root.querySelector('#share-streaming-links') as HTMLDivElement,
    shareCommentInput: root.querySelector('#share-comment-input') as HTMLTextAreaElement,
    shareStatus: root.querySelector('#share-status') as HTMLParagraphElement,
    shareSave: root.querySelector('#share-save') as HTMLButtonElement,
    shareCopy: root.querySelector('#share-copy') as HTMLButtonElement,
});