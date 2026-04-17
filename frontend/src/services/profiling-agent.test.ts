import { describe, expect, it, vi } from 'vitest';
import { installProfilingAgent, type ProfilingAPI } from './profiling-agent';

describe('profiling agent', () => {
    it('exposes the global profiling API and emits batches after backend enablement', async () => {
        const eventsOn = vi.fn((_eventName: string, callback: (payload: unknown) => void) => {
            if (_eventName === 'silphium:profiler:config') {
                callback({ enabled: true, sampleIntervalMs: 1000, httpAddr: '' });
            }

            return () => undefined;
        });
        const eventsEmit = vi.fn();
        const performanceObject = {
            now: vi.fn(() => 100),
            mark: vi.fn(),
            measure: vi.fn(),
        } as unknown as Performance;

        const windowObject = {} as Window;
        const api = installProfilingAgent({
            emitEvent: eventsEmit,
            onEvent: eventsOn,
            performanceObject,
            windowObject,
            documentObject: undefined as unknown as Document,
            setIntervalFn: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>),
            clearIntervalFn: vi.fn(),
        }) as ProfilingAPI;

        api.startMark('load');
        expect(api.endMark('load')).toBe(0);

        await api.flush();

        expect((windowObject as Window & { __profiling?: ProfilingAPI }).__profiling).toBe(api);
        expect(eventsEmit).toHaveBeenCalledWith('silphium:profiler:frontend-ready', expect.any(String));
    });
});