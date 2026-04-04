export type AboutModalElements = {
    aboutModal: HTMLDivElement;
    aboutBackdrop: HTMLDivElement;
    aboutClose: HTMLButtonElement;
    aboutVersion: HTMLParagraphElement;
    aboutRepoLink: HTMLAnchorElement;
};

export const renderAboutModal = (): string => `
    <div id="about-modal" class="about-modal" hidden>
        <div id="about-backdrop" class="about-backdrop"></div>
        <section class="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
            <header class="about-header">
                <p id="about-title" class="about-title">About</p>
                <button id="about-close" class="about-close" type="button" aria-label="Close about dialog"><svg class="overlay-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M6.4 5.34C6.11 5.05 5.64 5.05 5.34 5.34C5.05 5.64 5.05 6.11 5.34 6.4L10.94 12L5.34 17.6C5.05 17.89 5.05 18.36 5.34 18.66C5.64 18.95 6.11 18.95 6.4 18.66L12 13.06L17.6 18.66C17.89 18.95 18.36 18.95 18.66 18.66C18.95 18.36 18.95 17.89 18.66 17.6L13.06 12L18.66 6.4C18.95 6.11 18.95 5.64 18.66 5.34C18.36 5.05 17.89 5.05 17.6 5.34L12 10.94L6.4 5.34Z"/></svg></button>
            </header>
            <div class="about-content">
                <div class="about-logo-wrap">
                    <img class="about-logo" src="/silphium-logo.svg" alt="Silphium logo">
                </div>
                <p class="about-name"><strong>Silphium</strong></p>
                <p id="about-version" class="about-version">dev</p>
                <p class="about-author">by metaisfacil</p>
                <p class="about-repo">
                    <a id="about-repo-link" class="about-repo-link" href="https://github.com/metaisfacil/silphium">github.com/metaisfacil/silphium</a>
                </p>
            </div>
        </section>
    </div>
`;

export const getAboutModalElements = (root: ParentNode): AboutModalElements => ({
    aboutModal: root.querySelector('#about-modal') as HTMLDivElement,
    aboutBackdrop: root.querySelector('#about-backdrop') as HTMLDivElement,
    aboutClose: root.querySelector('#about-close') as HTMLButtonElement,
    aboutVersion: root.querySelector('#about-version') as HTMLParagraphElement,
    aboutRepoLink: root.querySelector('#about-repo-link') as HTMLAnchorElement,
});
