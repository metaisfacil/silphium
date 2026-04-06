import { describe, expect, it } from 'vitest';

import {
    formatShortcutBindingFromKeyboardEvent,
    normalizeFocusedKeyboardShortcuts,
    shortcutBindingUsesCode,
} from './shortcut-bindings';

describe('shortcut bindings', () => {
    it('normalizes aliases into canonical shortcut strings and falls back for invalid bindings', () => {
        expect(normalizeFocusedKeyboardShortcuts({
            playPauseToggle: ' keyk ',
            nextTrack: 'control + shift + digit2',
            previousTrack: 'spacebar',
            stopPlayback: 'ControlLeft',
            focusLibraryFilter: '',
            openSettings: 'cmd+p',
        })).toEqual({
            playPauseToggle: 'K',
            nextTrack: 'Ctrl+Shift+2',
            previousTrack: 'Space',
            stopPlayback: 'Z',
            focusLibraryFilter: 'Ctrl+F',
            openSettings: 'Meta+P',
        });
    });

    it('formats keyboard events into bindings and ignores modifier-only keys', () => {
        expect(formatShortcutBindingFromKeyboardEvent(new KeyboardEvent('keydown', {
            key: 'p',
            code: 'KeyP',
            ctrlKey: true,
            shiftKey: true,
        }))).toBe('Ctrl+Shift+P');

        expect(formatShortcutBindingFromKeyboardEvent(new KeyboardEvent('keydown', {
            key: 'Shift',
            code: 'ShiftLeft',
            shiftKey: true,
        }))).toBeNull();
    });

    it('matches bindings by normalized key code', () => {
        expect(shortcutBindingUsesCode('Ctrl+Shift+P', 'KeyP')).toBe(true);
        expect(shortcutBindingUsesCode('Space', 'KeyP')).toBe(false);
    });
});