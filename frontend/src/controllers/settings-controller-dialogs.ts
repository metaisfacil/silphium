import type { ScrobbleRuleOperator } from '../types/app-types';
import type { LibraryFolderDialogValues, ScrobbleRuleDialogValues, SendToActionDialogValues } from './settings-controller-types';
import { asScrobbleRuleField, defaultScrobbleRuleOperator, operatorOptionsForScrobbleRuleField } from './settings-controller-utils';

export type DialogTimers = {
    libraryDepthHideTimer: number | undefined;
    scrobbleRuleHideTimer: number | undefined;
    sendToActionHideTimer: number | undefined;
    settingsLibraryDepthStatusFadeTimer: number | undefined;
};

export type LibraryDepthDialogElements = {
    modal: HTMLDivElement;
    backdrop: HTMLDivElement;
    form: HTMLFormElement;
    title: HTMLParagraphElement;
    labelInput: HTMLInputElement;
    depthInput: HTMLInputElement;
    status: HTMLParagraphElement;
    cancel: HTMLButtonElement;
    confirm: HTMLButtonElement;
};

export type ScrobbleRuleDialogElements = {
    modal: HTMLDivElement;
    backdrop: HTMLDivElement;
    form: HTMLFormElement;
    title: HTMLParagraphElement;
    field: HTMLSelectElement;
    operator: HTMLSelectElement;
    valueLabel: HTMLLabelElement;
    value: HTMLInputElement;
    hint: HTMLElement;
    status: HTMLParagraphElement;
    cancel: HTMLButtonElement;
    confirm: HTMLButtonElement;
};

export type SendToActionDialogElements = {
    modal: HTMLDivElement;
    backdrop: HTMLDivElement;
    form: HTMLFormElement;
    titleInput: HTMLInputElement;
    scopeInput: HTMLSelectElement;
    commandHint: HTMLElement;
    commandInput: HTMLInputElement;
    status: HTMLParagraphElement;
    cancel: HTMLButtonElement;
    confirm: HTMLButtonElement;
};

export type LibraryDepthDialogState = {
    pendingResolver: ((value: LibraryFolderDialogValues | null) => void) | null;
    returnFocusTarget: HTMLElement | null;
};

export type ScrobbleRuleDialogState = {
    pendingResolver: ((value: ScrobbleRuleDialogValues | null) => void) | null;
    returnFocusTarget: HTMLElement | null;
};

export type SendToActionDialogState = {
    pendingResolver: ((value: SendToActionDialogValues | null) => void) | null;
    returnFocusTarget: HTMLElement | null;
};

export const refreshScrobbleRuleDialogControls = (
    elements: ScrobbleRuleDialogElements,
    preferredOperator?: ScrobbleRuleOperator,
): void => {
    const field = asScrobbleRuleField(elements.field.value);
    const options = operatorOptionsForScrobbleRuleField(field);
    const currentOperator = preferredOperator ?? (elements.operator.value as ScrobbleRuleOperator);
    elements.operator.innerHTML = '';
    options.forEach((option) => {
        const element = document.createElement('option');
        element.value = option.value;
        element.textContent = option.label;
        elements.operator.append(element);
    });

    const selectedOperator = options.some((option) => option.value === currentOperator)
        ? currentOperator
        : defaultScrobbleRuleOperator(field);
    elements.operator.value = selectedOperator;

    if (field === 'trackLength') {
        elements.valueLabel.textContent = 'Threshold (seconds)';
        elements.hint.textContent = 'Compare the full track duration in whole seconds.';
        elements.value.type = 'number';
        elements.value.min = '0';
        elements.value.step = '1';
        elements.value.inputMode = 'numeric';
        elements.value.placeholder = '240';
        return;
    }

    elements.valueLabel.textContent = field === 'path' ? 'Path or pattern' : 'Text or pattern';
    if (elements.operator.value === 'regex') {
        elements.hint.textContent = 'Use /pattern/flags or a raw pattern. Raw patterns are compiled case-insensitively.';
    } else if (field === 'path' && elements.operator.value === 'starts_with') {
        elements.hint.textContent = 'Use a folder or full path. Subpaths match automatically.';
    } else if (field === 'anyTag') {
        elements.hint.textContent = 'Checks all tag values on the track and matches if any tag contains this value.';
    } else {
        elements.hint.textContent = 'Text matching is case-insensitive.';
    }

    elements.value.type = 'text';
    elements.value.inputMode = 'text';
    elements.value.removeAttribute('min');
    elements.value.removeAttribute('step');
    elements.value.placeholder = field === 'path'
        ? 'C:\\Music\\Private'
        : field === 'anyTag'
            ? 'live bootleg'
            : 'Value';
};

export const closeLibraryDepthDialog = (
    value: LibraryFolderDialogValues | null,
    restoreFocus: boolean,
    immediate: boolean,
    elements: LibraryDepthDialogElements,
    state: LibraryDepthDialogState,
    timers: DialogTimers,
    transitionMs: number,
    setLibraryDepthStatusMessage: (message: string) => void,
): void => {
    if (elements.modal.hidden && !elements.modal.classList.contains('is-visible')) {
        return;
    }

    if (timers.libraryDepthHideTimer !== undefined) {
        window.clearTimeout(timers.libraryDepthHideTimer);
        timers.libraryDepthHideTimer = undefined;
    }

    const resolve = state.pendingResolver;
    state.pendingResolver = null;

    const focusTarget = state.returnFocusTarget;
    state.returnFocusTarget = null;

    const finalizeDialogClose = (): void => {
        elements.modal.hidden = true;
        elements.modal.classList.remove('is-visible');
        elements.title.textContent = 'Library folder settings';
        elements.labelInput.value = '';
        elements.depthInput.value = '';
        setLibraryDepthStatusMessage('');
        elements.confirm.textContent = 'Apply';

        resolve?.(value);

        if (restoreFocus && focusTarget) {
            window.requestAnimationFrame(() => {
                focusTarget.focus();
            });
        }
    };

    if (immediate) {
        finalizeDialogClose();
        return;
    }

    elements.modal.classList.remove('is-visible');
    timers.libraryDepthHideTimer = window.setTimeout(() => {
        timers.libraryDepthHideTimer = undefined;
        finalizeDialogClose();
    }, transitionMs);
};

export const openLibraryDepthDialog = (
    initialValues: LibraryFolderDialogValues,
    confirmLabel: string,
    title: string,
    elements: LibraryDepthDialogElements,
    state: LibraryDepthDialogState,
    timers: DialogTimers,
    transitionMs: number,
    setLibraryDepthStatusMessage: (message: string) => void,
): Promise<LibraryFolderDialogValues | null> => {
    closeLibraryDepthDialog(null, false, true, elements, state, timers, transitionMs, setLibraryDepthStatusMessage);

    elements.title.textContent = title;
    elements.labelInput.value = initialValues.label;
    elements.depthInput.value = initialValues.releaseDepth > 0 ? String(initialValues.releaseDepth) : '';
    setLibraryDepthStatusMessage('');
    elements.confirm.textContent = confirmLabel;
    state.returnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elements.modal.hidden = false;
    elements.modal.classList.remove('is-visible');

    window.requestAnimationFrame(() => {
	        elements.modal.classList.add('is-visible');
	        elements.labelInput.focus();
	        elements.labelInput.select();
    });

    return new Promise<LibraryFolderDialogValues | null>((resolve) => {
        state.pendingResolver = resolve;
    });
};

export const closeScrobbleRuleDialog = (
    value: ScrobbleRuleDialogValues | null,
    restoreFocus: boolean,
    immediate: boolean,
    elements: ScrobbleRuleDialogElements,
    state: ScrobbleRuleDialogState,
    timers: DialogTimers,
    transitionMs: number,
): void => {
    if (elements.modal.hidden && !elements.modal.classList.contains('is-visible')) {
        return;
    }

    if (timers.scrobbleRuleHideTimer !== undefined) {
        window.clearTimeout(timers.scrobbleRuleHideTimer);
        timers.scrobbleRuleHideTimer = undefined;
    }

    const resolve = state.pendingResolver;
    state.pendingResolver = null;

    const focusTarget = state.returnFocusTarget;
    state.returnFocusTarget = null;

    const finalizeDialogClose = (): void => {
        elements.modal.hidden = true;
        elements.modal.classList.remove('is-visible');
        elements.title.textContent = 'Add scrobble rule';
        elements.field.value = 'path';
        refreshScrobbleRuleDialogControls(elements, 'starts_with');
        elements.value.value = '';
        elements.status.textContent = '';
        elements.confirm.textContent = 'Apply';

        resolve?.(value);

        if (restoreFocus && focusTarget) {
            window.requestAnimationFrame(() => {
                focusTarget.focus();
            });
        }
    };

    if (immediate) {
        finalizeDialogClose();
        return;
    }

    elements.modal.classList.remove('is-visible');
    timers.scrobbleRuleHideTimer = window.setTimeout(() => {
        timers.scrobbleRuleHideTimer = undefined;
        finalizeDialogClose();
    }, transitionMs);
};

export const openScrobbleRuleDialog = (
    initialValues: ScrobbleRuleDialogValues,
    confirmLabel: string,
    title: string,
    elements: ScrobbleRuleDialogElements,
    state: ScrobbleRuleDialogState,
    timers: DialogTimers,
    transitionMs: number,
): Promise<ScrobbleRuleDialogValues | null> => {
    closeScrobbleRuleDialog(null, false, true, elements, state, timers, transitionMs);

    elements.title.textContent = title;
    elements.field.value = initialValues.field;
    refreshScrobbleRuleDialogControls(elements, initialValues.operator);
    elements.value.value = initialValues.value;
    elements.status.textContent = '';
    elements.confirm.textContent = confirmLabel;
    state.returnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elements.modal.hidden = false;
    elements.modal.classList.remove('is-visible');

    window.requestAnimationFrame(() => {
        elements.modal.classList.add('is-visible');
        elements.value.focus();
        elements.value.select();
    });

    return new Promise<ScrobbleRuleDialogValues | null>((resolve) => {
        state.pendingResolver = resolve;
    });
};

export const closeSendToActionDialog = (
    value: SendToActionDialogValues | null,
    restoreFocus: boolean,
    immediate: boolean,
    elements: SendToActionDialogElements,
    state: SendToActionDialogState,
    timers: DialogTimers,
    transitionMs: number,
): void => {
    if (elements.modal.hidden && !elements.modal.classList.contains('is-visible')) {
        return;
    }

    if (timers.sendToActionHideTimer !== undefined) {
        window.clearTimeout(timers.sendToActionHideTimer);
        timers.sendToActionHideTimer = undefined;
    }

    const resolve = state.pendingResolver;
    state.pendingResolver = null;

    const focusTarget = state.returnFocusTarget;
    state.returnFocusTarget = null;

    const finalizeDialogClose = (): void => {
        elements.modal.hidden = true;
        elements.modal.classList.remove('is-visible');
        elements.titleInput.value = '';
        elements.scopeInput.value = 'track';
        elements.commandInput.value = '';
        elements.confirm.textContent = 'Add action';
        const sendToActionDialogTitle = elements.form.querySelector('#settings-send-to-action-title');
        if (sendToActionDialogTitle instanceof HTMLParagraphElement) {
            sendToActionDialogTitle.textContent = 'Add send to action';
        }
        elements.status.textContent = '';
        resolve?.(value);

        if (restoreFocus && focusTarget) {
            window.requestAnimationFrame(() => {
                focusTarget.focus();
            });
        }
    };

    if (immediate) {
        finalizeDialogClose();
        return;
    }

    elements.modal.classList.remove('is-visible');
    timers.sendToActionHideTimer = window.setTimeout(() => {
        timers.sendToActionHideTimer = undefined;
        finalizeDialogClose();
    }, transitionMs);
};

export const openSendToActionDialog = (
    initialValues: SendToActionDialogValues,
    confirmLabel: string,
    title: string,
    elements: SendToActionDialogElements,
    state: SendToActionDialogState,
    timers: DialogTimers,
    transitionMs: number,
): Promise<SendToActionDialogValues | null> => {
    closeSendToActionDialog(null, false, true, elements, state, timers, transitionMs);

    elements.titleInput.value = initialValues.title;
    elements.scopeInput.value = initialValues.scope;
    elements.commandInput.value = initialValues.commandTemplate;
    elements.confirm.textContent = confirmLabel;
    const sendToActionDialogTitle = elements.form.querySelector('#settings-send-to-action-title');
    if (sendToActionDialogTitle instanceof HTMLParagraphElement) {
        sendToActionDialogTitle.textContent = title;
    }
    elements.status.textContent = '';
    state.returnFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    elements.modal.hidden = false;
    elements.modal.classList.remove('is-visible');

    window.requestAnimationFrame(() => {
        elements.modal.classList.add('is-visible');
        elements.titleInput.focus();
        elements.titleInput.select();
    });

    return new Promise<SendToActionDialogValues | null>((resolve) => {
        state.pendingResolver = resolve;
    });
};

export const applySendToCommandExamplesForPlatform = (
    commandHint: HTMLElement,
    commandInput: HTMLInputElement,
    isWindows: boolean,
    isMac: boolean,
    isLinux: boolean,
): void => {
    if (isWindows) {
        commandHint.innerHTML = 'Examples:<br><code>%programfiles%\\\\Mp3tag\\\\Mp3tag.exe {path}</code><br><code>covit --input {path} --primary-output {directory}\\\\cover</code>';
        commandInput.placeholder = '%programfiles%\\Mp3tag\\Mp3tag.exe {path}';
        return;
    }

    if (isMac) {
        commandHint.innerHTML = 'Examples:<br><code>open {path}</code><br><code>covit --input {path} --primary-output {directory}/cover</code>';
        commandInput.placeholder = 'open {path}';
        return;
    }

    if (isLinux) {
        commandHint.innerHTML = 'Examples:<br><code>xdg-open {path}</code><br><code>covit --input {path} --primary-output {directory}/cover</code>';
        commandInput.placeholder = 'xdg-open {path}';
        return;
    }

    commandHint.innerHTML = 'Examples:<br><code>covit --input {path} --primary-output {directory}/cover</code>';
    commandInput.placeholder = 'covit --input {path}';
};
