export const getFirstTag = (tags: Record<string, string[]>, ...keys: string[]): string => {
    for (const key of keys) {
        for (const [k, v] of Object.entries(tags)) {
            if (k.toLowerCase() === key && v.length > 0 && v[0]) {
                return v[0];
            }
        }
    }
    return '';
};

export const getReleaseLabel = (tags: Record<string, string[]>): string =>
    getFirstTag(tags, 'organization', 'label', 'publisher');

export const getReleaseCat = (tags: Record<string, string[]>): string =>
    getFirstTag(tags, 'catalognumber', 'catalogid', 'catalog');

export const containsNonLatinChars = (text: string): boolean =>
    /[^\u0000-\u024F\u1E00-\u1EFF]/u.test(text);

export const formatSortArtist = (artist: string, sortName: string): string => {
    if (!sortName || sortName === artist || !containsNonLatinChars(artist)) {
        return artist;
    }
    return `${sortName} (${artist})`;
};

export const firstTagValue = (track: { allFileTags?: Record<string, string[]> }, ...keys: string[]): string => {
    for (const key of keys) {
        const normalizedKey = key.toLowerCase();
        for (const [tagName, values] of Object.entries(track.allFileTags || {})) {
            if (tagName.toLowerCase() !== normalizedKey) {
                continue;
            }

            const firstValue = values.find((value) => value.trim() !== '');
            if (firstValue) {
                return firstValue.trim();
            }
        }
    }

    return '';
};

export const normalizedTrackNumber = (track: { displayTrackNumber?: string; allFileTags?: Record<string, string[]> }): string | undefined => {
    const candidate = ((track.displayTrackNumber || '') || firstTagValue(track, 'tracknumber', 'track number', 'track')).trim();
    if (candidate === '') {
        return undefined;
    }

    const normalized = candidate.split('/')[0]?.trim() || '';
    return /^\d+$/.test(normalized) ? normalized : undefined;
};

export const technicalLabelSeparator = ' • ';

export const splitTechnicalLabel = (label: string): string[] => label
    .split(technicalLabelSeparator)
    .map((part) => part.trim())
    .filter((part) => part !== '');

export const composeTechnicalLabel = (baseLabel: string, suffixLabel = ''): string => {
    const parts = splitTechnicalLabel(baseLabel);
    const cleanedSuffix = suffixLabel.trim();
    if (cleanedSuffix) {
        parts.push(cleanedSuffix);
    }

    return parts.join(technicalLabelSeparator);
};

export const setTechnicalLabel = (button: HTMLButtonElement, label: string): void => {
    const cleaned = label.trim();
    if ((button.dataset.technicalLabel || '') === cleaned) {
        return;
    }

    button.dataset.technicalLabel = cleaned;

    if (!cleaned) {
        button.replaceChildren();
        button.classList.remove('has-technical-separator');
        return;
    }

    const parts = splitTechnicalLabel(cleaned);
    if (parts.length <= 1) {
        button.classList.remove('has-technical-separator');
        button.textContent = cleaned;
        return;
    }

    const fragment = document.createDocumentFragment();

    parts.forEach((part, index) => {
        if (index > 0) {
            const separatorSpan = document.createElement('span');
            separatorSpan.className = 'track-technical-separator';
            separatorSpan.setAttribute('aria-hidden', 'true');
            separatorSpan.textContent = '•';
            fragment.append(separatorSpan);
        }

        const valueSpan = document.createElement('span');
        valueSpan.className = 'track-technical-value';
        valueSpan.textContent = part;
        fragment.append(valueSpan);
    });

    button.replaceChildren(fragment);
    button.classList.add('has-technical-separator');
};

export const buildShareImageDefaultFilename = (artist: string, album: string, title: string): string => {
    const sanitizeSegment = (value: string): string => value
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const parts = [sanitizeSegment(artist), sanitizeSegment(album), sanitizeSegment(title)].filter((part) => part !== '');
    const joined = parts.join(' - ');
    const fallback = joined || 'silphium-share';
    return `${fallback.slice(0, 120)}.png`;
};

export const blobToBase64 = async (blob: Blob): Promise<string> => {
    return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error ?? new Error('Unable to read share image data'));
        reader.onload = () => {
            if (typeof reader.result !== 'string') {
                reject(new Error('Unexpected share image encoding result'));
                return;
            }

            const commaIndex = reader.result.indexOf(',');
            resolve(commaIndex >= 0 ? reader.result.slice(commaIndex + 1) : reader.result);
        };
        reader.readAsDataURL(blob);
    });
};

export const errorMessage = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message || '';
    }

    if (typeof error === 'string') {
        return error;
    }

    return '';
};

export const isMissingTrackLoadError = (error: unknown): boolean => {
    const message = errorMessage(error).toLowerCase();
    if (!message) {
        return false;
    }

    return message.includes('no such file')
        || message.includes('not found')
        || message.includes('cannot find the file')
        || message.includes('does not exist')
        || message.includes('path not found');
};

export const describeErrorForLog = (error: unknown): string => {
    if (error instanceof Error) {
        return error.stack || error.message || 'Error';
    }

    if (typeof error === 'string') {
        return error;
    }

    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

export const matchesSilenceTitleHeuristic = (track: { displayTitle: string; title?: string; name: string }): boolean => {
    const titles = [
        track.displayTitle,
        track.title || '',
        track.name,
        track.name.replace(/\.[^/.]+$/, ''),
    ];

    return titles.some((value) => {
        const normalized = value.trim().toLowerCase();
        return normalized === '[silence]' || normalized === '(silence)';
    });
};

export const isPlaybackQueueEligibleTrack = (track: { displayTitle: string; title?: string; name: string }): boolean => {
    return !matchesSilenceTitleHeuristic(track);
};

export const nonTypingInputTypes = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
]);

export const isTypingFieldElement = (element: Element | null): boolean => {
    if (!element) {
        return false;
    }

    if (element instanceof HTMLTextAreaElement) {
        return true;
    }

    if (element instanceof HTMLInputElement) {
        const inputType = (element.type || 'text').toLowerCase();
        return !nonTypingInputTypes.has(inputType);
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
        return true;
    }

    const role = element.getAttribute('role');
    return role === 'textbox' || role === 'searchbox';
};

export const shouldSuppressFocusedShortcut = (event: KeyboardEvent): boolean => {
    const eventTarget = event.target instanceof Element ? event.target : null;
    if (isTypingFieldElement(eventTarget)) {
        return true;
    }

    const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
    return activeElement !== eventTarget && isTypingFieldElement(activeElement);
};

export const renderSendToButtons = (container: HTMLDivElement, actions: Array<{ title: string }>, cssClass: string): void => {
    container.innerHTML = '';
    actions.forEach((action, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = cssClass;
        button.role = 'menuitem';
        button.textContent = `Send to: ${action.title}`;
        button.dataset.sendToActionIndex = String(index);
        container.append(button);
    });
};

export const activeSelectionTargetWithin = (targets: readonly HTMLElement[]): HTMLElement | null => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return null;
    }

    const range = selection.getRangeAt(0);
    const commonAncestor = range.commonAncestorContainer;
    return targets.find((target) => target.contains(commonAncestor)) ?? null;
};

export const hasActiveSelectionWithin = (target: HTMLElement): boolean => {
    return activeSelectionTargetWithin([target]) === target;
};

export const cleanSidebarQueueSelectionLabel = (label: string): string => {
    return label.replace(/^[▸▾•]\s*/u, '').trim();
};

export const formatPlaybackStateForLog = (state: { loaded: boolean; playing: boolean; sourcePath: string; currentTime: number; duration: number; volume: number; endEventId: number }): string => {
    const currentTime = Number.isFinite(state.currentTime) ? state.currentTime.toFixed(2) : '0.00';
    const duration = Number.isFinite(state.duration) ? state.duration.toFixed(2) : '0.00';
    const volume = Number.isFinite(state.volume) ? state.volume.toFixed(2) : '0.00';
    return `loaded=${state.loaded} playing=${state.playing} source="${state.sourcePath || ''}" time=${currentTime}/${duration} volume=${volume} endEventId=${state.endEventId}`;
};
