import type { FocusedKeyboardShortcuts } from '../types/app-types';

const modifierCodes = new Set([
    'AltLeft',
    'AltRight',
    'ControlLeft',
    'ControlRight',
    'MetaLeft',
    'MetaRight',
    'ShiftLeft',
    'ShiftRight',
]);

const modifierTokens = new Set([
    'alt',
    'control',
    'ctrl',
    'meta',
    'option',
    'shift',
    'win',
    'cmd',
    'command',
    'super',
]);

type ShortcutDescriptor = {
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
};

export const defaultFocusedKeyboardShortcuts: FocusedKeyboardShortcuts = {
    playPauseToggle: 'Space',
    nextTrack: 'N',
    previousTrack: 'P',
    stopPlayback: 'Z',
    focusLibraryFilter: 'Ctrl+F',
    openSettings: 'Ctrl+P',
};

const formatShortcutCode = (code: string): string => {
    if (/^Key[A-Z]$/.test(code)) {
        return code.slice(3);
    }

    if (/^Digit[0-9]$/.test(code)) {
        return code.slice(5);
    }

    if (code === 'Space') {
        return 'Space';
    }

    return code;
};

const normalizeShortcutCodeToken = (token: string): string | null => {
    const trimmed = token.trim();
    if (trimmed === '') {
        return null;
    }

    const lower = trimmed.toLowerCase();
    if (modifierTokens.has(lower)) {
        return null;
    }

    if (lower === 'space' || lower === 'spacebar') {
        return 'Space';
    }

    if (/^key[a-z]$/i.test(trimmed)) {
        return `Key${trimmed.slice(3).toUpperCase()}`;
    }

    if (/^digit[0-9]$/i.test(trimmed)) {
        return `Digit${trimmed.slice(5)}`;
    }

    if (trimmed.length === 1 && /[a-z]/i.test(trimmed)) {
        return `Key${trimmed.toUpperCase()}`;
    }

    if (trimmed.length === 1 && /[0-9]/.test(trimmed)) {
        return `Digit${trimmed}`;
    }

    if (/^f([1-9]|1[0-2])$/i.test(trimmed)) {
        return trimmed.toUpperCase();
    }

    return trimmed;
};

const parseShortcutBinding = (binding: string): ShortcutDescriptor | null => {
    const parts = binding
        .split('+')
        .map((token) => token.trim())
        .filter((token) => token !== '');

    if (parts.length === 0) {
        return null;
    }

    let ctrlKey = false;
    let altKey = false;
    let shiftKey = false;
    let metaKey = false;
    let code = '';

    for (const part of parts) {
        const normalized = part.toLowerCase();
        if (normalized === 'ctrl' || normalized === 'control') {
            ctrlKey = true;
            continue;
        }

        if (normalized === 'alt' || normalized === 'option') {
            altKey = true;
            continue;
        }

        if (normalized === 'shift') {
            shiftKey = true;
            continue;
        }

        if (normalized === 'meta' || normalized === 'cmd' || normalized === 'command' || normalized === 'win' || normalized === 'super') {
            metaKey = true;
            continue;
        }

        if (code !== '') {
            return null;
        }

        const normalizedCode = normalizeShortcutCodeToken(part);
        if (!normalizedCode || modifierCodes.has(normalizedCode)) {
            return null;
        }

        code = normalizedCode;
    }

    if (code === '') {
        return null;
    }

    return {
        code,
        ctrlKey,
        altKey,
        shiftKey,
        metaKey,
    };
};

const formatShortcutBinding = (descriptor: ShortcutDescriptor): string => {
    const tokens: string[] = [];
    if (descriptor.ctrlKey) {
        tokens.push('Ctrl');
    }
    if (descriptor.altKey) {
        tokens.push('Alt');
    }
    if (descriptor.shiftKey) {
        tokens.push('Shift');
    }
    if (descriptor.metaKey) {
        tokens.push('Meta');
    }

    tokens.push(formatShortcutCode(descriptor.code));
    return tokens.join('+');
};

const normalizeShortcutBinding = (value: unknown, fallback: string): string => {
    if (typeof value !== 'string') {
        return fallback;
    }

    const descriptor = parseShortcutBinding(value);
    if (!descriptor) {
        return fallback;
    }

    return formatShortcutBinding(descriptor);
};

export const normalizeFocusedKeyboardShortcuts = (shortcuts?: Partial<FocusedKeyboardShortcuts> | null): FocusedKeyboardShortcuts => {
    const source = shortcuts || {};

    return {
        playPauseToggle: normalizeShortcutBinding(source.playPauseToggle, defaultFocusedKeyboardShortcuts.playPauseToggle),
        nextTrack: normalizeShortcutBinding(source.nextTrack, defaultFocusedKeyboardShortcuts.nextTrack),
        previousTrack: normalizeShortcutBinding(source.previousTrack, defaultFocusedKeyboardShortcuts.previousTrack),
        stopPlayback: normalizeShortcutBinding(source.stopPlayback, defaultFocusedKeyboardShortcuts.stopPlayback),
        focusLibraryFilter: normalizeShortcutBinding(source.focusLibraryFilter, defaultFocusedKeyboardShortcuts.focusLibraryFilter),
        openSettings: normalizeShortcutBinding(source.openSettings, defaultFocusedKeyboardShortcuts.openSettings),
    };
};

export const formatShortcutBindingFromKeyboardEvent = (event: KeyboardEvent): string | null => {
    const rawCode = (event.code || '').trim();
    let code = rawCode;
    if (!code) {
        code = normalizeShortcutCodeToken(event.key || '') || '';
    }

    if (!code || modifierCodes.has(code)) {
        return null;
    }

    const descriptor: ShortcutDescriptor = {
        code,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
    };

    return formatShortcutBinding(descriptor);
};

export const shortcutBindingUsesCode = (binding: string, code: string): boolean => {
    const descriptor = parseShortcutBinding(binding);
    if (!descriptor) {
        return false;
    }

    return descriptor.code === code;
};
