import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../wailsjs/runtime/runtime', () => ({
    BrowserOpenURL: vi.fn(async () => undefined),
    EventsOn: vi.fn(),
    OnFileDrop: vi.fn(),
}));

import { setupVolumeControlBindings } from './app-event-bindings';

const flushPromises = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

const volumeControlMarkup = (value: number): string => `
    <div class="volume-wrap">
        <button id="volume-btn" type="button"><svg class="control-icon" viewBox="0 0 24 24" aria-hidden="true"></svg></button>
        <div class="volume-popout"><input id="volume" type="range" min="0" max="1" value="${value}" step="0.01"></div>
    </div>
`;

describe('setupVolumeControlBindings', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('mutes and restores volume on button click without toggling popout state', async () => {
        document.body.innerHTML = volumeControlMarkup(0.8);

        const volume = document.querySelector('#volume') as HTMLInputElement;
        const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;
        const audioSetVolume = vi.fn(async (volumeValue: number) => ({ loaded: true, playing: false, sourcePath: '', currentTime: 0, duration: 0, volume: volumeValue, endEventId: 0 }));
        const applyPlaybackState = vi.fn();
        const handleAudioError = vi.fn();

        const volumeRow = setupVolumeControlBindings({
            document,
            volume,
            volumeBtn,
            audioSetVolume,
            applyPlaybackState,
            handleAudioError,
        });

        expect(volumeRow.classList.contains('open')).toBe(false);
        expect(volumeBtn.classList.contains('is-muted')).toBe(false);
        expect(volumeBtn.getAttribute('aria-label')).toBe('Mute');

        volumeBtn.click();
        await flushPromises();
        expect(Number(volume.value)).toBe(0);
        expect(volumeBtn.classList.contains('is-muted')).toBe(true);
        expect(volumeBtn.getAttribute('aria-label')).toBe('Unmute');
        expect(volumeRow.classList.contains('open')).toBe(false);

        volumeBtn.click();
        await flushPromises();
        expect(Number(volume.value)).toBe(0.8);
        expect(volumeBtn.classList.contains('is-muted')).toBe(false);
        expect(volumeBtn.getAttribute('aria-label')).toBe('Mute');
        expect(audioSetVolume).toHaveBeenNthCalledWith(1, 0);
        expect(audioSetVolume).toHaveBeenNthCalledWith(2, 0.8);
        expect(applyPlaybackState).toHaveBeenCalledTimes(2);
        expect(handleAudioError).not.toHaveBeenCalled();

        volume.value = '0';
        volume.dispatchEvent(new Event('input', { bubbles: true }));
        await flushPromises();
        expect(volumeBtn.classList.contains('is-muted')).toBe(true);
        expect(volumeBtn.getAttribute('aria-label')).toBe('Unmute');
    });

    it('opens only from the icon hitbox, then keeps the wider hover area until hidden', () => {
        document.body.innerHTML = volumeControlMarkup(0.6);

        const volume = document.querySelector('#volume') as HTMLInputElement;
        const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;
        const volumeIcon = volumeBtn.querySelector('.control-icon') as SVGElement;

        const volumeRow = setupVolumeControlBindings({
            document,
            volume,
            volumeBtn,
            audioSetVolume: vi.fn(async (volumeValue: number) => ({ loaded: true, playing: false, sourcePath: '', currentTime: 0, duration: 0, volume: volumeValue, endEventId: 0 })),
            applyPlaybackState: vi.fn(),
            handleAudioError: vi.fn(),
        });

        volumeRow.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        expect(volumeRow.classList.contains('open')).toBe(false);

        volumeIcon.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        expect(volumeRow.classList.contains('open')).toBe(true);

        volumeRow.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        expect(volumeRow.classList.contains('open')).toBe(true);

        volumeRow.dispatchEvent(new Event('pointerleave', { bubbles: true }));
        vi.advanceTimersByTime(250);
        volumeRow.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        vi.advanceTimersByTime(400);
        expect(volumeRow.classList.contains('open')).toBe(true);

        volumeRow.dispatchEvent(new Event('pointerleave', { bubbles: true }));
        vi.advanceTimersByTime(510);
        expect(volumeRow.classList.contains('open')).toBe(false);

        volumeRow.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        expect(volumeRow.classList.contains('open')).toBe(false);
    });

    it('adjusts volume with mouse wheel over the volume button', async () => {
        document.body.innerHTML = volumeControlMarkup(0.5);

        const volume = document.querySelector('#volume') as HTMLInputElement;
        const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;
        const audioSetVolume = vi.fn(async (volumeValue: number) => ({ loaded: true, playing: false, sourcePath: '', currentTime: 0, duration: 0, volume: volumeValue, endEventId: 0 }));

        setupVolumeControlBindings({
            document,
            volume,
            volumeBtn,
            audioSetVolume,
            applyPlaybackState: vi.fn(),
            handleAudioError: vi.fn(),
        });

        volumeBtn.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }));
        await flushPromises();
        expect(Number(volume.value)).toBeCloseTo(0.55, 5);

        volumeBtn.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
        await flushPromises();
        expect(Number(volume.value)).toBeCloseTo(0.5, 5);

        expect(audioSetVolume).toHaveBeenNthCalledWith(1, 0.55);
        expect(audioSetVolume).toHaveBeenNthCalledWith(2, 0.5);
    });
});
