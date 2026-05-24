export interface LibraryControllerViewContext {
    app: HTMLElement;
    sidebarToggle: HTMLButtonElement;
    librarySidebar: HTMLElement;
    libraryScanYieldIndicator: HTMLSpanElement;
    libraryExpandToggle: HTMLButtonElement;
    libraryBack: HTMLButtonElement;
    libraryPath: HTMLParagraphElement;
    libraryBrowser: HTMLElement;
    sidebarOpen: boolean;
    sidebarExpanded: boolean;
    libraryRootName: string;
    currentFolderPath: string;
    libraryIndexTruncated: boolean;
    libraryLoading: boolean;
    libraryLoadingEtaSeconds: number | null;
    libraryLoadingStatusLabel: string;
    hoveredBrowserButton: HTMLButtonElement | null;
    currentPane: () => HTMLUListElement | null;
    isLibrarySearchActive: () => boolean;
    getLibrarySearchQuery: () => string;
}

export const createLibraryControllerViewRuntime = (context: LibraryControllerViewContext) => {
    const sidebarToggleLoadingLabel = context.sidebarToggle.querySelector('.sidebar-toggle-loading-label') as HTMLSpanElement | null;
    const viewportLoadingIndicator = document.createElement('div');
    viewportLoadingIndicator.className = 'library-viewport-loading-indicator';
    viewportLoadingIndicator.setAttribute('aria-hidden', 'true');
    context.libraryBrowser.append(viewportLoadingIndicator);

    const folderEnumerationTooltip = document.createElement('div');
    folderEnumerationTooltip.className = 'library-folder-enumeration-tooltip';
    folderEnumerationTooltip.setAttribute('aria-hidden', 'true');
    folderEnumerationTooltip.textContent = 'This folder is still being enumerated!';
    context.libraryBrowser.append(folderEnumerationTooltip);

    let folderEnumerationTooltipFadeHandle: number | undefined;
    let folderEnumerationTooltipHideHandle: number | undefined;

    const ensureViewportLoadingIndicatorMounted = (): void => {
        if (!context.libraryBrowser.contains(viewportLoadingIndicator)) {
            context.libraryBrowser.append(viewportLoadingIndicator);
        }
    };

    const ensureFolderEnumerationTooltipMounted = (): void => {
        if (!context.libraryBrowser.contains(folderEnumerationTooltip)) {
            context.libraryBrowser.append(folderEnumerationTooltip);
        }
    };

    const hideFolderEnumerationTooltip = (): void => {
        folderEnumerationTooltip.classList.remove('is-visible');
        folderEnumerationTooltip.classList.remove('is-below');
        folderEnumerationTooltip.setAttribute('aria-hidden', 'true');
    };

    const showFolderEnumerationTooltip = (anchor: HTMLElement): void => {
        ensureFolderEnumerationTooltipMounted();

        if (folderEnumerationTooltipFadeHandle !== undefined) {
            window.clearTimeout(folderEnumerationTooltipFadeHandle);
            folderEnumerationTooltipFadeHandle = undefined;
        }

        if (folderEnumerationTooltipHideHandle !== undefined) {
            window.clearTimeout(folderEnumerationTooltipHideHandle);
            folderEnumerationTooltipHideHandle = undefined;
        }

        const browserRect = context.libraryBrowser.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const tooltipWidth = Math.max(120, folderEnumerationTooltip.offsetWidth || 120);
        const horizontalInset = Math.max(12, (tooltipWidth / 2) + 8);
        const minInset = horizontalInset;
        const maxInset = Math.max(minInset, browserRect.width - horizontalInset);
        let left = anchorRect.left - browserRect.left + (anchorRect.width / 2);
        left = Math.max(minInset, Math.min(maxInset, left));

        const tooltipHeight = Math.max(28, folderEnumerationTooltip.offsetHeight || 28);
        const verticalInset = 8;
        const availableAbove = anchorRect.top - browserRect.top;
        const availableBelow = browserRect.bottom - anchorRect.bottom;
        const renderBelow = availableBelow >= (tooltipHeight + verticalInset)
            || availableBelow >= availableAbove;
        folderEnumerationTooltip.classList.toggle('is-below', renderBelow);

        let top = renderBelow
            ? anchorRect.bottom - browserRect.top
            : anchorRect.top - browserRect.top;

        const minTop = renderBelow
            ? verticalInset
            : tooltipHeight + verticalInset;
        const maxTop = Math.max(minTop, browserRect.height - verticalInset);
        top = Math.max(minTop, Math.min(maxTop, top));

        folderEnumerationTooltip.style.left = `${left}px`;
        folderEnumerationTooltip.style.top = `${top}px`;
        folderEnumerationTooltip.classList.add('is-visible');
        folderEnumerationTooltip.setAttribute('aria-hidden', 'false');

        folderEnumerationTooltipFadeHandle = window.setTimeout(() => {
            hideFolderEnumerationTooltip();
            folderEnumerationTooltipFadeHandle = undefined;
        }, 760);

        folderEnumerationTooltipHideHandle = window.setTimeout(() => {
            hideFolderEnumerationTooltip();
            folderEnumerationTooltipHideHandle = undefined;
        }, 980);
    };

    const formatLibraryLoadingEtaLabel = (): string => {
        if (context.libraryLoadingEtaSeconds === null || !Number.isFinite(context.libraryLoadingEtaSeconds) || context.libraryLoadingEtaSeconds <= 0) {
            return '';
        }

        const wholeSeconds = Math.max(1, Math.ceil(context.libraryLoadingEtaSeconds));
        if (wholeSeconds < 60) {
            return `~${wholeSeconds}s`;
        }

        const minutes = Math.floor(wholeSeconds / 60);
        const seconds = wholeSeconds % 60;
        if (seconds === 0) {
            return `~${minutes}m`;
        }

        return `~${minutes}m ${seconds}s`;
    };

    const loadingIndicatorLabel = (): string => {
        if (context.libraryLoadingStatusLabel) {
            return context.libraryLoadingStatusLabel;
        }

        return formatLibraryLoadingEtaLabel();
    };

    const refreshSidebarToggleState = (): void => {
        const backModeActive = context.sidebarOpen && context.app.classList.contains('sidebar-subview-active');

        context.app.classList.toggle('sidebar-expanded', context.sidebarOpen && context.sidebarExpanded);
        context.sidebarToggle.classList.toggle('is-loading', context.libraryLoading);
        context.sidebarToggle.classList.toggle('is-back-mode', backModeActive);
        context.libraryScanYieldIndicator.classList.toggle('is-visible', context.libraryLoading);
        context.libraryScanYieldIndicator.setAttribute('aria-hidden', context.libraryLoading ? 'false' : 'true');
        const loadingEtaLabel = context.libraryLoading && !context.sidebarOpen ? loadingIndicatorLabel() : '';
        context.sidebarToggle.classList.toggle('has-loading-eta', loadingEtaLabel !== '');
        if (sidebarToggleLoadingLabel) {
            sidebarToggleLoadingLabel.textContent = loadingEtaLabel;
        }

        if (context.libraryLoading) {
            const ariaLabel = loadingEtaLabel
                ? `Loading library, ${loadingEtaLabel.startsWith('~') ? `about ${loadingEtaLabel.slice(1)} remaining` : loadingEtaLabel}`
                : 'Loading library';
            context.sidebarToggle.setAttribute('aria-label', ariaLabel);
            context.sidebarToggle.setAttribute('aria-busy', 'true');
            return;
        }

        context.sidebarToggle.setAttribute('aria-busy', 'false');
        context.sidebarToggle.setAttribute('aria-label', backModeActive ? 'Back to sidebar navigation' : context.sidebarOpen ? 'Close sidebar' : 'Open sidebar');
    };

    const refreshSidebarExpandedState = (): void => {
        const canExpand = context.libraryRootName !== '' && !context.isLibrarySearchActive();
        context.libraryExpandToggle.classList.toggle('is-active', context.sidebarExpanded);
        context.libraryExpandToggle.disabled = !canExpand;
        context.libraryExpandToggle.setAttribute('aria-pressed', context.sidebarExpanded ? 'true' : 'false');
        context.libraryExpandToggle.setAttribute('aria-label', context.sidebarExpanded ? 'Shrink album view' : 'Expand album view');
        context.libraryExpandToggle.title = context.sidebarExpanded ? 'Shrink album view' : 'Expand album view';
        context.app.classList.toggle('sidebar-expanded', context.sidebarOpen && context.sidebarExpanded);
    };

    const setLibraryLoading = (loading: boolean): void => {
        if (context.libraryLoading === loading) {
            return;
        }

        context.libraryLoading = loading;
        if (!loading) {
            context.libraryLoadingEtaSeconds = null;
            context.libraryLoadingStatusLabel = '';
        }
        refreshSidebarToggleState();
    };

    const setLibraryLoadingEtaSeconds = (secondsRemaining: number | null): void => {
        const normalized = (secondsRemaining === null || !Number.isFinite(secondsRemaining) || secondsRemaining <= 0)
            ? null
            : Math.ceil(secondsRemaining);

        if (context.libraryLoadingEtaSeconds === normalized) {
            return;
        }

        context.libraryLoadingEtaSeconds = normalized;
        refreshSidebarToggleState();
    };

    const setLibraryLoadingStatusLabel = (label: string): void => {
        const normalized = label.trim();
        if (context.libraryLoadingStatusLabel === normalized) {
            return;
        }

        context.libraryLoadingStatusLabel = normalized;
        refreshSidebarToggleState();
    };

    const setLibraryPathLabel = (): void => {
        const partialSuffix = context.libraryIndexTruncated ? ' (partial)' : '';
        const folderSegments = context.currentFolderPath
            .split('/')
            .filter((segment) => segment !== '');

        const appendText = (value: string): void => {
            context.libraryPath.append(document.createTextNode(value));
        };

        const appendFolderButton = (label: string, folderPath: string): void => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'library-path-segment';
            button.dataset.folderPath = folderPath;
            button.textContent = label;
            context.libraryPath.append(button);
        };

        const appendSeparator = (): void => {
            const separator = document.createElement('span');
            separator.className = 'library-path-separator';
            separator.textContent = ' / ';
            context.libraryPath.append(separator);
        };

        if (!context.libraryRootName) {
            context.libraryPath.innerHTML = '';
            context.libraryPath.textContent = 'No folder selected';
            context.libraryBack.disabled = true;
            return;
        }

        context.libraryPath.innerHTML = '';

        if (context.isLibrarySearchActive()) {
            appendText(`${context.libraryRootName}${partialSuffix} · Search: "${context.getLibrarySearchQuery().trim()}"`);
            context.libraryBack.disabled = true;
            return;
        }

        if (context.sidebarExpanded) {
            appendText(`${context.libraryRootName}${partialSuffix} · Albums`);
            context.libraryBack.disabled = true;
            return;
        }

        if (!context.currentFolderPath) {
            appendText(`${context.libraryRootName}${partialSuffix}`);
            context.libraryBack.disabled = true;
            return;
        }

        appendFolderButton(`${context.libraryRootName}${partialSuffix}`, '');

        let cumulativePath = '';
        for (const segment of folderSegments) {
            appendSeparator();
            cumulativePath = cumulativePath ? `${cumulativePath}/${segment}` : segment;
            appendFolderButton(segment, cumulativePath);
        }

        context.libraryBack.disabled = false;
    };

    const setViewportLoadingIndicatorVisible = (visible: boolean): void => {
        ensureViewportLoadingIndicatorMounted();
        viewportLoadingIndicator.classList.toggle('is-visible', visible);
        viewportLoadingIndicator.setAttribute('aria-hidden', visible ? 'false' : 'true');
    };

    const setHoveredBrowserButton = (button: HTMLButtonElement | null): void => {
        if (context.hoveredBrowserButton === button) {
            return;
        }

        if (context.hoveredBrowserButton) {
            context.hoveredBrowserButton.classList.remove('is-hovered');
        }

        context.hoveredBrowserButton = button;
        if (context.hoveredBrowserButton) {
            context.hoveredBrowserButton.classList.add('is-hovered');
        }
    };

    const syncHoveredBrowserButton = (hoveredBrowserEntryKey: string | null): void => {
        const pane = context.currentPane();
        if (!pane || !hoveredBrowserEntryKey) {
            setHoveredBrowserButton(null);
            return;
        }

        const candidates = Array.from(pane.querySelectorAll('button[data-hover-key]')) as HTMLButtonElement[];
        const matching = candidates.find((candidate) => candidate.dataset.hoverKey === hoveredBrowserEntryKey) || null;
        setHoveredBrowserButton(matching);
    };

    return {
        hideFolderEnumerationTooltip,
        showFolderEnumerationTooltip,
        refreshSidebarExpandedState,
        refreshSidebarToggleState,
        setHoveredBrowserButton,
        syncHoveredBrowserButton,
        setLibraryLoading,
        setLibraryLoadingEtaSeconds,
        setLibraryLoadingStatusLabel,
        setLibraryPathLabel,
        setViewportLoadingIndicatorVisible,
    };
};