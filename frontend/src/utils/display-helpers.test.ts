import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    activeSelectionTargetWithin,
    blobToBase64,
    buildShareImageDefaultFilename,
    cleanSidebarQueueSelectionLabel,
    composeTechnicalLabel,
    containsNonLatinChars,
    describeErrorForLog,
    errorMessage,
    firstTagValue,
    formatPlaybackStateForLog,
    formatSortArtist,
    getFirstTag,
    getReleaseCat,
    getReleaseLabel,
    hasActiveSelectionWithin,
    isMissingTrackLoadError,
    isTypingFieldElement,
    matchesSilenceTitleHeuristic,
    normalizedTrackNumber,
    renderSendToButtons,
    setTechnicalLabel,
    shouldSuppressFocusedShortcut,
    splitTechnicalLabel,
    technicalLabelSeparator,
} from './display-helpers';

describe('display helpers', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        window.getSelection()?.removeAllRanges();
    });

    it('reads tag values and release metadata helpers', () => {
        const tags = {
            LABEL: ['Warp'],
            catalog: ['CAT-001'],
            genre: ['Ambient'],
        };

        expect(getFirstTag(tags, 'label', 'publisher')).toBe('Warp');
        expect(getFirstTag(tags, 'missing')).toBe('');
        expect(getReleaseLabel(tags)).toBe('Warp');
        expect(getReleaseCat(tags)).toBe('CAT-001');
        expect(firstTagValue({ allFileTags: { TrackNumber: [' ', '03'], GENRE: [' Ambient '] } }, 'genre')).toBe('Ambient');
        expect(firstTagValue({ allFileTags: { TrackNumber: [' ', '03'] } }, 'tracknumber')).toBe('03');
    });

    it('formats sort artists and normalized track numbers', () => {
        expect(containsNonLatinChars('甲田雅人')).toBe(true);
        expect(containsNonLatinChars('Masato Kouda')).toBe(false);
        expect(formatSortArtist('甲田雅人', 'Kouda, Masato')).toBe('Kouda, Masato (甲田雅人)');
        expect(formatSortArtist('Masato Kouda', 'Kouda, Masato')).toBe('Masato Kouda');
        expect(normalizedTrackNumber({ displayTrackNumber: ' 07/12 ' })).toBe('07');
        expect(normalizedTrackNumber({ allFileTags: { TRACKNUMBER: ['  8/10  '] } })).toBe('8');
        expect(normalizedTrackNumber({ displayTrackNumber: '/12' })).toBeUndefined();
        expect(normalizedTrackNumber({ displayTrackNumber: 'Side A' })).toBeUndefined();
        expect(normalizedTrackNumber({})).toBeUndefined();
    });

    it('splits, composes, and renders technical labels', () => {
        const button = document.createElement('button');

        expect(splitTechnicalLabel(`Lossless${technicalLabelSeparator}24-bit${technicalLabelSeparator}96kHz`)).toEqual(['Lossless', '24-bit', '96kHz']);
        expect(composeTechnicalLabel('Lossless', '24-bit')).toBe(`Lossless${technicalLabelSeparator}24-bit`);
        expect(composeTechnicalLabel(`Lossless${technicalLabelSeparator}24-bit`, ' ')).toBe(`Lossless${technicalLabelSeparator}24-bit`);

        setTechnicalLabel(button, '');
        expect(button.textContent).toBe('');
        expect(button.classList.contains('has-technical-separator')).toBe(false);

        setTechnicalLabel(button, 'Lossless');
        expect(button.textContent).toBe('Lossless');

        setTechnicalLabel(button, `Lossless${technicalLabelSeparator}24-bit${technicalLabelSeparator}96kHz`);
        expect(button.classList.contains('has-technical-separator')).toBe(true);
        expect(button.querySelectorAll('.track-technical-separator')).toHaveLength(2);
        expect(Array.from(button.querySelectorAll('.track-technical-value')).map((node) => node.textContent)).toEqual(['Lossless', '24-bit', '96kHz']);
    });

    it('builds safe share-image filenames', () => {
        expect(buildShareImageDefaultFilename('Artist', 'Album', 'Title')).toBe('Artist - Album - Title.png');
        expect(buildShareImageDefaultFilename(' Artist<> ', ' Album/Name ', ' Title*? ')).toBe('Artist - Album Name - Title.png');
        expect(buildShareImageDefaultFilename('', '', '')).toBe('silphium-share.png');
        expect(buildShareImageDefaultFilename('a'.repeat(80), 'b'.repeat(80), 'c'.repeat(80)).length).toBeLessThanOrEqual(124);
    });

    it('encodes blobs and extracts error messages', async () => {
        const payload = new Blob(['hello'], { type: 'text/plain' });
        const base64 = await blobToBase64(payload);

        expect(base64).toBe('aGVsbG8=');
        expect(errorMessage(new Error('boom'))).toBe('boom');
        expect(errorMessage('plain error')).toBe('plain error');
        expect(errorMessage({ message: 'ignored' })).toBe('');
    });

    it('rejects blob encoding when the FileReader result is not a string', async () => {
        class BrokenFileReader {
            public error: Error | null = null;
            public onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
            public onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
            public result: ArrayBuffer = new ArrayBuffer(0);

            readAsDataURL(): void {
                this.onload?.call(this as unknown as FileReader, new ProgressEvent('load') as ProgressEvent<FileReader>);
            }
        }

        const originalFileReader = globalThis.FileReader;
        vi.stubGlobal('FileReader', BrokenFileReader);

        await expect(blobToBase64(new Blob(['hello']))).rejects.toThrow('Unexpected share image encoding result');

        vi.stubGlobal('FileReader', originalFileReader);
    });

    it('rejects blob encoding when the FileReader errors', async () => {
        class ErrorFileReader {
            public error: Error | null = null;
            public onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
            public onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
            public result: string | null = null;

            readAsDataURL(): void {
                this.onerror?.call(this as unknown as FileReader, new ProgressEvent('error') as ProgressEvent<FileReader>);
            }
        }

        const originalFileReader = globalThis.FileReader;
        vi.stubGlobal('FileReader', ErrorFileReader);

        await expect(blobToBase64(new Blob(['hello']))).rejects.toThrow('Unable to read share image data');

        vi.stubGlobal('FileReader', originalFileReader);
    });

    it('returns raw reader data when no data-url prefix is present', async () => {
        class RawStringFileReader {
            public error: Error | null = null;
            public onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
            public onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
            public result = 'raw-base64';

            readAsDataURL(): void {
                this.onload?.call(this as unknown as FileReader, new ProgressEvent('load') as ProgressEvent<FileReader>);
            }
        }

        const originalFileReader = globalThis.FileReader;
        vi.stubGlobal('FileReader', RawStringFileReader);

        await expect(blobToBase64(new Blob(['hello']))).resolves.toBe('raw-base64');

        vi.stubGlobal('FileReader', originalFileReader);
    });

    it('classifies missing-track errors and renders error descriptions', () => {
        expect(isMissingTrackLoadError(new Error('No such file or directory'))).toBe(true);
        expect(isMissingTrackLoadError('Path not found')).toBe(true);
        expect(isMissingTrackLoadError(new Error('permission denied'))).toBe(false);
        expect(isMissingTrackLoadError(undefined)).toBe(false);

        const error = new Error('boom');
        error.stack = 'stack trace';
        expect(describeErrorForLog(error)).toBe('stack trace');
        const messageOnlyError = new Error('message only');
        messageOnlyError.stack = '';
        expect(describeErrorForLog(messageOnlyError)).toBe('message only');
        const fallbackError = new Error('');
        fallbackError.stack = '';
        expect(describeErrorForLog(fallbackError)).toBe('Error');
        expect(errorMessage(fallbackError)).toBe('');
        expect(describeErrorForLog('plain')).toBe('plain');
        expect(describeErrorForLog({ code: 500 })).toBe('{"code":500}');

        const circular: { self?: unknown } = {};
        circular.self = circular;
        expect(describeErrorForLog(circular)).toContain('[object Object]');
    });

    it('detects silence heuristics and typing fields', () => {
        expect(matchesSilenceTitleHeuristic({ displayTitle: '[silence]', title: 'Track', name: 'track.flac' })).toBe(true);
        expect(matchesSilenceTitleHeuristic({ displayTitle: 'Track', title: 'Track', name: '(silence).flac' })).toBe(true);
        expect(matchesSilenceTitleHeuristic({ displayTitle: 'Track', title: 'Track', name: 'track.flac' })).toBe(false);

        const textarea = document.createElement('textarea');
        const textInput = document.createElement('input');
        textInput.type = 'text';
        const rangeInput = document.createElement('input');
        rangeInput.type = 'range';
        const editable = document.createElement('div');
        Object.defineProperty(editable, 'isContentEditable', { value: true });
        const roleTextbox = document.createElement('div');
        roleTextbox.setAttribute('role', 'textbox');
        const roleSearchbox = document.createElement('div');
        roleSearchbox.setAttribute('role', 'searchbox');

        expect(isTypingFieldElement(null)).toBe(false);
        expect(isTypingFieldElement(textarea)).toBe(true);
        expect(isTypingFieldElement(textInput)).toBe(true);
        expect(isTypingFieldElement(rangeInput)).toBe(false);
        expect(isTypingFieldElement(editable)).toBe(true);
        const defaultInput = document.createElement('input');
        Object.defineProperty(defaultInput, 'type', { value: '' });
        expect(isTypingFieldElement(defaultInput)).toBe(true);
        expect(isTypingFieldElement(roleTextbox)).toBe(true);
        expect(isTypingFieldElement(roleSearchbox)).toBe(true);
    });

    it('suppresses focused shortcuts for typing targets or active typing fields', () => {
        const input = document.createElement('input');
        input.type = 'text';
        document.body.append(input);
        input.focus();

        const button = document.createElement('button');
        document.body.append(button);

        expect(shouldSuppressFocusedShortcut(new KeyboardEvent('keydown', { key: 'a' }))).toBe(true);

        const withInputTarget = new KeyboardEvent('keydown', { key: 'a' });
        Object.defineProperty(withInputTarget, 'target', { value: input });
        expect(shouldSuppressFocusedShortcut(withInputTarget)).toBe(true);

        input.blur();
        const withButtonTarget = new KeyboardEvent('keydown', { key: 'a' });
        Object.defineProperty(withButtonTarget, 'target', { value: button });
        expect(shouldSuppressFocusedShortcut(withButtonTarget)).toBe(false);

        Object.defineProperty(document, 'activeElement', { value: button, configurable: true });
        const withFocusedButtonTarget = new KeyboardEvent('keydown', { key: 'a' });
        Object.defineProperty(withFocusedButtonTarget, 'target', { value: button });
        expect(shouldSuppressFocusedShortcut(withFocusedButtonTarget)).toBe(false);

        Object.defineProperty(document, 'activeElement', { value: null, configurable: true });
        const withNoActiveElement = new KeyboardEvent('keydown', { key: 'a' });
        Object.defineProperty(withNoActiveElement, 'target', { value: button });
        expect(shouldSuppressFocusedShortcut(withNoActiveElement)).toBe(false);
    });

    it('renders send-to buttons and detects active selection within a target', () => {
        const container = document.createElement('div');
        renderSendToButtons(container as HTMLDivElement, [{ title: 'Foobar2000' }, { title: 'VLC' }], 'send-to-btn');

        expect(container.querySelectorAll('button')).toHaveLength(2);
        expect((container.querySelector('[data-send-to-action-index="1"]') as HTMLButtonElement).textContent).toBe('Send to: VLC');

        const outer = document.createElement('div');
        const inner = document.createElement('span');
        inner.textContent = 'Selected text';
        outer.append(inner);
        document.body.append(outer);

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(inner);
        selection?.removeAllRanges();
        selection?.addRange(range);

        expect(activeSelectionTargetWithin([outer])).toBe(outer);
        expect(hasActiveSelectionWithin(outer)).toBe(true);

        selection?.removeAllRanges();
        expect(activeSelectionTargetWithin([outer])).toBeNull();
        expect(hasActiveSelectionWithin(outer)).toBe(false);

        const emptySelection = window.getSelection();
        const collapsedRange = document.createRange();
        collapsedRange.setStart(inner.firstChild as Text, 0);
        collapsedRange.setEnd(inner.firstChild as Text, 0);
        emptySelection?.removeAllRanges();
        emptySelection?.addRange(collapsedRange);
        expect(activeSelectionTargetWithin([outer])).toBeNull();
        expect(hasActiveSelectionWithin(outer)).toBe(false);
    });

    it('returns the matching owner when a selection is inside one of several targets', () => {
        const first = document.createElement('div');
        const second = document.createElement('div');
        const firstText = document.createElement('span');
        const secondText = document.createElement('span');
        firstText.textContent = 'First';
        secondText.textContent = 'Second';
        first.append(firstText);
        second.append(secondText);
        document.body.append(first, second);

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(secondText);
        selection?.removeAllRanges();
        selection?.addRange(range);

        expect(activeSelectionTargetWithin([first, second])).toBe(second);
        expect(activeSelectionTargetWithin([first])).toBeNull();
    });

    it('cleans sidebar labels and formats playback state logs', () => {
        expect(cleanSidebarQueueSelectionLabel('▸ Artist')).toBe('Artist');
        expect(cleanSidebarQueueSelectionLabel('▾ Album')).toBe('Album');
        expect(cleanSidebarQueueSelectionLabel('• Track')).toBe('Track');
        expect(cleanSidebarQueueSelectionLabel('Plain label')).toBe('Plain label');

        expect(formatPlaybackStateForLog({
            loaded: true,
            playing: false,
            sourcePath: '/music/track.flac',
            currentTime: 12.345,
            duration: 300.5,
            volume: 0.75,
            endEventId: 3,
        })).toBe('loaded=true playing=false source="/music/track.flac" time=12.35/300.50 volume=0.75 endEventId=3');

        expect(formatPlaybackStateForLog({
            loaded: false,
            playing: false,
            sourcePath: '',
            currentTime: Number.NaN,
            duration: Number.NaN,
            volume: Number.NaN,
            endEventId: 0,
        })).toBe('loaded=false playing=false source="" time=0.00/0.00 volume=0.00 endEventId=0');
    });
});