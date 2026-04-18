export type ImageFileModalElements = {
    imageFileModal: HTMLDivElement;
    imageFileBackdrop: HTMLDivElement;
    imageFileDialog: HTMLElement;
    imageFileTools: HTMLDivElement;
    imageFileClose: HTMLButtonElement;
    imageFileRotateLeft: HTMLButtonElement;
    imageFileRotateRight: HTMLButtonElement;
    imageFileContent: HTMLDivElement;
    imageFileLoading: HTMLDivElement;
    imageFilePreview: HTMLImageElement;
    imageFileThumbs: HTMLDivElement;
    imageFileThumbsPrev: HTMLButtonElement;
    imageFileThumbsNext: HTMLButtonElement;
    imageFileThumbsViewport: HTMLDivElement;
    imageFileThumbsRow: HTMLDivElement;
};

export const renderImageFileModal = (): string => `
    <div id="image-file-modal" class="image-file-modal" hidden>
        <div id="image-file-backdrop" class="image-file-backdrop"></div>
        <section class="image-file-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
            <div id="image-file-tools" class="image-file-tools" aria-label="Image tools">
                <button id="image-file-rotate-left" class="image-file-tool-btn" type="button" aria-label="Rotate left" title="Rotate left"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M11.5 4C8.06 4 5.2 6.25 4.27 9.36L2.93 8.02C2.54 7.63 1.91 7.63 1.52 8.02C1.13 8.41 1.13 9.04 1.52 9.43L4.65 12.56C5.04 12.95 5.67 12.95 6.06 12.56L9.19 9.43C9.58 9.04 9.58 8.41 9.19 8.02C8.8 7.63 8.17 7.63 7.78 8.02L6.43 9.37C7.17 7.3 9.15 5.83 11.5 5.83C14.48 5.83 16.9 8.25 16.9 11.23C16.9 14.21 14.48 16.63 11.5 16.63C10.51 16.63 9.58 16.37 8.79 15.9C8.35 15.64 7.78 15.76 7.49 16.18C7.18 16.64 7.31 17.26 7.79 17.53C8.87 18.15 10.14 18.5 11.5 18.5C15.52 18.5 18.77 15.25 18.77 11.23C18.77 7.21 15.52 4 11.5 4Z"/></svg></button>
                <button id="image-file-rotate-right" class="image-file-tool-btn" type="button" aria-label="Rotate right" title="Rotate right"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M12.5 4C15.94 4 18.8 6.25 19.73 9.36L21.07 8.02C21.46 7.63 22.09 7.63 22.48 8.02C22.87 8.41 22.87 9.04 22.48 9.43L19.35 12.56C18.96 12.95 18.33 12.95 17.94 12.56L14.81 9.43C14.42 9.04 14.42 8.41 14.81 8.02C15.2 7.63 15.83 7.63 16.22 8.02L17.57 9.37C16.83 7.3 14.85 5.83 12.5 5.83C9.52 5.83 7.1 8.25 7.1 11.23C7.1 14.21 9.52 16.63 12.5 16.63C13.49 16.63 14.42 16.37 15.21 15.9C15.65 15.64 16.22 15.76 16.51 16.18C16.82 16.64 16.69 17.26 16.21 17.53C15.13 18.15 13.86 18.5 12.5 18.5C8.48 18.5 5.23 15.25 5.23 11.23C5.23 7.21 8.48 4 12.5 4Z"/></svg></button>
                <button id="image-file-close" class="image-file-close" type="button" aria-label="Close image preview" title="Close image preview"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M18.3 5.71C17.91 5.32 17.28 5.32 16.89 5.71L12 10.59L7.11 5.71C6.72 5.32 6.09 5.32 5.7 5.71C5.31 6.1 5.31 6.73 5.7 7.12L10.59 12L5.7 16.88C5.31 17.27 5.31 17.9 5.7 18.29C6.09 18.68 6.72 18.68 7.11 18.29L12 13.41L16.89 18.29C17.28 18.68 17.91 18.68 18.3 18.29C18.69 17.9 18.69 17.27 18.3 16.88L13.41 12L18.3 7.12C18.69 6.73 18.69 6.1 18.3 5.71Z"/></svg></button>
            </div>
            <div id="image-file-content" class="image-file-content">
                <div id="image-file-loading" class="image-file-loading" hidden aria-hidden="true">
                    <span class="image-file-loading-spinner"></span>
                </div>
                <img id="image-file-preview" class="image-file-preview" alt="Image preview">
            </div>
            <div id="image-file-thumbs" class="image-file-thumbs" aria-label="Related images">
                <button id="image-file-thumbs-prev" class="image-file-thumbs-nav" type="button" aria-label="Previous images"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M14.53 5.47C15.12 6.06 15.12 7.01 14.53 7.6L10.12 12L14.53 16.4C15.12 16.99 15.12 17.94 14.53 18.53C13.94 19.12 12.99 19.12 12.4 18.53L6.94 13.06C6.35 12.47 6.35 11.53 6.94 10.94L12.4 5.47C12.99 4.88 13.94 4.88 14.53 5.47Z"/></svg></button>
                <div id="image-file-thumbs-viewport" class="image-file-thumbs-viewport">
                    <div id="image-file-thumbs-row" class="image-file-thumbs-row"></div>
                </div>
                <button id="image-file-thumbs-next" class="image-file-thumbs-nav" type="button" aria-label="Next images"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M9.47 5.47C10.06 4.88 11.01 4.88 11.6 5.47L17.06 10.94C17.65 11.53 17.65 12.47 17.06 13.06L11.6 18.53C11.01 19.12 10.06 19.12 9.47 18.53C8.88 17.94 8.88 16.99 9.47 16.4L13.88 12L9.47 7.6C8.88 7.01 8.88 6.06 9.47 5.47Z"/></svg></button>
            </div>
        </section>
    </div>
`;

export const getImageFileModalElements = (root: ParentNode): ImageFileModalElements => ({
    imageFileModal: root.querySelector('#image-file-modal') as HTMLDivElement,
    imageFileBackdrop: root.querySelector('#image-file-backdrop') as HTMLDivElement,
    imageFileDialog: root.querySelector('.image-file-dialog') as HTMLElement,
    imageFileTools: root.querySelector('#image-file-tools') as HTMLDivElement,
    imageFileClose: root.querySelector('#image-file-close') as HTMLButtonElement,
    imageFileRotateLeft: root.querySelector('#image-file-rotate-left') as HTMLButtonElement,
    imageFileRotateRight: root.querySelector('#image-file-rotate-right') as HTMLButtonElement,
    imageFileContent: root.querySelector('#image-file-content') as HTMLDivElement,
    imageFileLoading: root.querySelector('#image-file-loading') as HTMLDivElement,
    imageFilePreview: root.querySelector('#image-file-preview') as HTMLImageElement,
    imageFileThumbs: root.querySelector('#image-file-thumbs') as HTMLDivElement,
    imageFileThumbsPrev: root.querySelector('#image-file-thumbs-prev') as HTMLButtonElement,
    imageFileThumbsNext: root.querySelector('#image-file-thumbs-next') as HTMLButtonElement,
    imageFileThumbsViewport: root.querySelector('#image-file-thumbs-viewport') as HTMLDivElement,
    imageFileThumbsRow: root.querySelector('#image-file-thumbs-row') as HTMLDivElement,
});