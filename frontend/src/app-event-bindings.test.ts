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
        document.body.innerHTML = `
            <div class="volume-wrap">
                <button id="volume-btn" type="button"></button>
                <div class="volume-popout"><input id="volume" type="range" min="0" max="1" value="0.8" step="0.01"></div>
            </div>
        `;

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

    it('keeps popout open while hovered and closes after leaving for about half a second', () => {
        document.body.innerHTML = `
            <div class="volume-wrap">
                <button id="volume-btn" type="button"></button>
                <div class="volume-popout"><input id="volume" type="range" min="0" max="1" value="0.6" step="0.01"></div>
            </div>
        `;

        const volume = document.querySelector('#volume') as HTMLInputElement;
        const volumeBtn = document.querySelector('#volume-btn') as HTMLButtonElement;

        const volumeRow = setupVolumeControlBindings({
            document,
            volume,
            volumeBtn,
            audioSetVolume: vi.fn(async (volumeValue: number) => ({ loaded: true, playing: false, sourcePath: '', currentTime: 0, duration: 0, volume: volumeValue, endEventId: 0 })),
            applyPlaybackState: vi.fn(),
            handleAudioError: vi.fn(),
        });

        volumeRow.dispatchEvent(new Event('pointerenter', { bubbles: true }));
        expect(volumeRow.classList.contains('open')).toBe(true);

        volumeRow.dispatchEvent(new Event('pointerleave', { bubbles: true }));
        vi.advanceTimersByTime(450);
        expect(volumeRow.classList.contains('open')).toBe(true);

        vi.advanceTimersByTime(60);
        expect(volumeRow.classList.contains('open')).toBe(false);
    });

    it('adjusts volume with mouse wheel over the volume button', async () => {
        document.body.innerHTML = `
            <div class="volume-wrap">
                <button id="volume-btn" type="button"></button>
                <div class="volume-popout"><input id="volume" type="range" min="0" max="1" value="0.5" step="0.01"></div>
            </div>
        `;

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
