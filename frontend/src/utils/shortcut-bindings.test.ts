import { describe, expect, it } from 'vitest';

import {
    defaultFocusedKeyboardShortcuts,
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
            key: '7',
            code: '',
            altKey: true,
        }))).toBe('Alt+7');

        expect(formatShortcutBindingFromKeyboardEvent(new KeyboardEvent('keydown', {
            key: 'F12',
            code: '',
            metaKey: true,
        }))).toBe('Meta+F12');

        expect(formatShortcutBindingFromKeyboardEvent(new KeyboardEvent('keydown', {
            key: 'Shift',
            code: 'ShiftLeft',
            shiftKey: true,
        }))).toBeNull();

        expect(formatShortcutBindingFromKeyboardEvent(new KeyboardEvent('keydown', {
            key: 'Control',
            code: '',
        }))).toBeNull();

        expect(formatShortcutBindingFromKeyboardEvent(new KeyboardEvent('keydown', {
            key: '',
            code: '',
        }))).toBeNull();
    });

    it('matches bindings by normalized key code', () => {
        expect(shortcutBindingUsesCode('Ctrl+Shift+P', 'KeyP')).toBe(true);
        expect(shortcutBindingUsesCode('Space', 'KeyP')).toBe(false);
        expect(shortcutBindingUsesCode('invalid+binding+value', 'KeyP')).toBe(false);
    });

    it('falls back for invalid or non-string shortcut values and normalizes function keys', () => {
        expect(normalizeFocusedKeyboardShortcuts({
            playPauseToggle: 42 as unknown as string,
            nextTrack: 'ctrl+alt+f12',
            previousTrack: 'win+9',
            stopPlayback: 'alt+option+z',
            focusLibraryFilter: 'ctrl+shift+p+q',
            openSettings: 'meta',
        })).toEqual({
            playPauseToggle: defaultFocusedKeyboardShortcuts.playPauseToggle,
            nextTrack: 'Ctrl+Alt+F12',
            previousTrack: 'Meta+9',
            stopPlayback: 'Alt+Z',
            focusLibraryFilter: defaultFocusedKeyboardShortcuts.focusLibraryFilter,
            openSettings: defaultFocusedKeyboardShortcuts.openSettings,
        });
    });
});