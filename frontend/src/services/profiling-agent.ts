import { EventsEmit, EventsOn } from '../../wailsjs/runtime/runtime';

const profilerFrontendBatchEvent = 'silphium:profiler:frontend-batch';
const profilerFrontendReadyEvent = 'silphium:profiler:frontend-ready';
const profilerFrontendConfigEvent = 'silphium:profiler:config';
const eventLoopSampleMs = 50;
const forcedReflowWindowMs = 16;

type MetricEvent = {
    timestamp: string;
    source: 'frontend';
    type: 'cpu' | 'memory' | 'render' | 'event' | 'measure' | 'longtask';
    name: string;
    value: number;
    meta?: Record<string, unknown>;
};

type FrontendBatch = {
    timestamp: string;
    sequence: number;
    events: MetricEvent[];
};

type ProfilingConfig = {
    enabled: boolean;
    sampleIntervalMs: number;
    httpAddr?: string;
    exportPath?: string;
    maxBufferSize?: number;
    cpuProfileEnabled?: boolean;
};

export type ProfilingSnapshot = {
    enabled: boolean;
    queuedEventCount: number;
    lastFlushAt: string | null;
    lastFPS: number;
    lastLongTaskMs: number;
    lastEventLoopLagMs: number;
    sampleIntervalMs: number;
};

export type ProfilingAPI = {
    startMark: (name: string) => void;
    endMark: (name: string, meta?: Record<string, unknown>) => number;
    measure: (name: string, startMark?: string, endMark?: string, meta?: Record<string, unknown>) => number;
    snapshot: () => ProfilingSnapshot;
    flush: () => Promise<void>;
};

type ProfilingAgentOptions = {
    emitEvent?: typeof EventsEmit;
    onEvent?: typeof EventsOn;
    performanceObject?: Performance;
    fetchFn?: typeof fetch;
    requestAnimationFrameFn?: typeof requestAnimationFrame;
    cancelAnimationFrameFn?: typeof cancelAnimationFrame;
    setIntervalFn?: typeof setInterval;
    clearIntervalFn?: typeof clearInterval;
    windowObject?: Window;
    documentObject?: Document;
};

type HeapPerformance = Performance & {
    memory?: {
        usedJSHeapSize: number;
        totalJSHeapSize: number;
        jsHeapSizeLimit: number;
    };
};

const nowTimestamp = (): string => new Date().toISOString();

const recordEvent = (
    queue: MetricEvent[],
    type: MetricEvent['type'],
    name: string,
    value: number,
    meta?: Record<string, unknown>,
): void => {
    queue.push({
        timestamp: nowTimestamp(),
        source: 'frontend',
        type,
        name,
        value,
        meta,
    });
};

export const installProfilingAgent = (options: ProfilingAgentOptions = {}): ProfilingAPI => {
    const emitEvent = options.emitEvent ?? EventsEmit;
    const onEvent = options.onEvent ?? EventsOn;
    const performanceObject = (options.performanceObject ?? globalThis.performance) as HeapPerformance;
    const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
    const requestAnimationFrameFn = options.requestAnimationFrameFn ?? globalThis.requestAnimationFrame?.bind(globalThis);
    const cancelAnimationFrameFn = options.cancelAnimationFrameFn ?? globalThis.cancelAnimationFrame?.bind(globalThis);
    const setIntervalFn = options.setIntervalFn ?? globalThis.setInterval.bind(globalThis);
    const clearIntervalFn = options.clearIntervalFn ?? globalThis.clearInterval.bind(globalThis);
    const windowObject = options.windowObject ?? globalThis.window;
    const documentObject = options.documentObject ?? globalThis.document;

    const queue: MetricEvent[] = [];
    const markTimes = new Map<string, number>();
    const detachFns: Array<() => void> = [];
    let enabled = false;
    let sampleIntervalMs = 1000;
    let batchSequence = 0;
    let lastFlushAt: string | null = null;
    let lastFPS = 0;
    let lastLongTaskMs = 0;
    let lastEventLoopLagMs = 0;
    let intervalHandle: ReturnType<typeof setInterval> | undefined;
    let eventLoopHandle: ReturnType<typeof setInterval> | undefined;
    let rafHandle = 0;
    let frameCount = 0;
    let frameWindowStartedAt = 0;
    let expectedEventLoopAt = 0;
    let lastMutationAt = -1;
    let httpAddr = '';

    const snapshot = (): ProfilingSnapshot => ({
        enabled,
        queuedEventCount: queue.length,
        lastFlushAt,
        lastFPS,
        lastLongTaskMs,
        lastEventLoopLagMs,
        sampleIntervalMs,
    });

    const measureDuration = (name: string, startAt: number, endAt: number, meta?: Record<string, unknown>): number => {
        const duration = Math.max(0, endAt - startAt);
        if (enabled) {
            recordEvent(queue, 'measure', name, duration, meta);
        }
        return duration;
    };

    const startMark = (name: string): void => {
        const trimmedName = name.trim();
        if (trimmedName === '') {
            return;
        }

        markTimes.set(trimmedName, performanceObject.now());
        performanceObject.mark?.(trimmedName);
    };

    const endMark = (name: string, meta?: Record<string, unknown>): number => {
        const trimmedName = name.trim();
        if (trimmedName === '') {
            return 0;
        }

        const startAt = markTimes.get(trimmedName);
        const endAt = performanceObject.now();
        performanceObject.mark?.(`${trimmedName}:end`);
        if (startAt === undefined) {
            return 0;
        }

        performanceObject.measure?.(trimmedName, trimmedName, `${trimmedName}:end`);
        return measureDuration(trimmedName, startAt, endAt, meta);
    };

    const measure = (name: string, startMarkName?: string, endMarkName?: string, meta?: Record<string, unknown>): number => {
        const startName = (startMarkName ?? name).trim();
        const endName = (endMarkName ?? `${name}:end`).trim();
        const startAt = markTimes.get(startName);
        const endAt = markTimes.get(endName) ?? performanceObject.now();
        if (startAt === undefined) {
            return 0;
        }

        performanceObject.measure?.(name, startName, endName);
        return measureDuration(name, startAt, endAt, meta);
    };

    const postBatchOverHTTP = async (batch: FrontendBatch): Promise<void> => {
        if (!fetchFn || httpAddr.trim() === '') {
            return;
        }

        await fetchFn(`http://${httpAddr}/debug/profiler/frontend`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
        });
    };

    const flush = async (): Promise<void> => {
        if (!enabled || queue.length === 0) {
            return;
        }

        const batch: FrontendBatch = {
            timestamp: nowTimestamp(),
            sequence: ++batchSequence,
            events: queue.splice(0, queue.length),
        };

        emitEvent(profilerFrontendBatchEvent, JSON.stringify(batch));
        if (httpAddr.trim() !== '') {
            await postBatchOverHTTP(batch).catch(() => undefined);
        }
        lastFlushAt = batch.timestamp;
    };

    const stopSampling = (): void => {
        if (intervalHandle !== undefined) {
            clearIntervalFn(intervalHandle);
            intervalHandle = undefined;
        }
        if (eventLoopHandle !== undefined) {
            clearIntervalFn(eventLoopHandle);
            eventLoopHandle = undefined;
        }
        if (rafHandle !== 0 && cancelAnimationFrameFn) {
            cancelAnimationFrameFn(rafHandle);
            rafHandle = 0;
        }
    };

    const startSampling = (): void => {
        stopSampling();
        frameCount = 0;
        frameWindowStartedAt = performanceObject.now();

        if (requestAnimationFrameFn) {
            const frameTick = (timestamp: number): void => {
                frameCount += 1;
                const elapsed = timestamp - frameWindowStartedAt;
                if (elapsed >= sampleIntervalMs) {
                    lastFPS = (frameCount * 1000) / elapsed;
                    recordEvent(queue, 'render', 'render.fps', lastFPS);
                    frameWindowStartedAt = timestamp;
                    frameCount = 0;
                }
                rafHandle = requestAnimationFrameFn(frameTick);
            };
            rafHandle = requestAnimationFrameFn(frameTick);
        }

        expectedEventLoopAt = performanceObject.now() + eventLoopSampleMs;
        eventLoopHandle = setIntervalFn(() => {
            const now = performanceObject.now();
            const lag = Math.max(0, now - expectedEventLoopAt);
            expectedEventLoopAt = now + eventLoopSampleMs;
            if (lag >= 50) {
                lastEventLoopLagMs = lag;
                recordEvent(queue, 'longtask', 'event-loop.blocked', lag);
            }
        }, eventLoopSampleMs);

        intervalHandle = setIntervalFn(() => {
            if (performanceObject.memory) {
                recordEvent(queue, 'memory', 'memory.js_heap_used_bytes', performanceObject.memory.usedJSHeapSize);
                recordEvent(queue, 'memory', 'memory.js_heap_total_bytes', performanceObject.memory.totalJSHeapSize, {
                    heapLimitBytes: performanceObject.memory.jsHeapSizeLimit,
                });
            }

            void flush();
        }, sampleIntervalMs);
    };

    const observeEntries = (entryTypes: string[]): void => {
        if (typeof PerformanceObserver === 'undefined') {
            return;
        }

        for (const entryType of entryTypes) {
            try {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        switch (entry.entryType) {
                            case 'longtask':
                                lastLongTaskMs = entry.duration;
                                recordEvent(queue, 'longtask', entry.name || 'longtask', entry.duration, {
                                    startTime: entry.startTime,
                                });
                                break;
                            case 'measure':
                                recordEvent(queue, 'measure', entry.name, entry.duration);
                                break;
                            case 'paint':
                                recordEvent(queue, 'render', `paint.${entry.name}`, entry.startTime);
                                break;
                            case 'navigation':
                                recordEvent(queue, 'event', 'navigation.total', entry.duration, {
                                    startTime: entry.startTime,
                                    entryType: entry.entryType,
                                });
                                break;
                            case 'resource':
                                recordEvent(queue, 'event', `resource.${entry.name}`, entry.duration, {
                                    startTime: entry.startTime,
                                    initiatorType: (entry as PerformanceResourceTiming).initiatorType,
                                });
                                break;
                            default:
                                break;
                        }
                    }
                });
                observer.observe({ entryTypes: [entryType] });
                detachFns.push(() => observer.disconnect());
            } catch {
                // Embedded runtimes do not support every PerformanceObserver entry type.
            }
        }
    };

    const installLayoutThrashDetection = (): void => {
        if (!windowObject || !documentObject || typeof MutationObserver === 'undefined') {
            return;
        }

        const mutationObserver = new MutationObserver(() => {
            lastMutationAt = performanceObject.now();
        });
        mutationObserver.observe(documentObject.documentElement, {
            attributes: true,
            childList: true,
            subtree: true,
        });
        detachFns.push(() => mutationObserver.disconnect());

        const prototype = (globalThis as { Element?: typeof Element }).Element?.prototype as {
            getBoundingClientRect?: () => DOMRect;
            __profilingWrappedRect?: boolean;
        };
        if (!prototype || typeof prototype.getBoundingClientRect !== 'function' || prototype.__profilingWrappedRect) {
            return;
        }

        const originalGetBoundingClientRect = prototype.getBoundingClientRect;
        prototype.getBoundingClientRect = function wrappedGetBoundingClientRect(this: Element): DOMRect {
            const now = performanceObject.now();
            if (enabled && lastMutationAt >= 0 && (now - lastMutationAt) <= forcedReflowWindowMs) {
                recordEvent(queue, 'render', 'layout.forced-reflow', now - lastMutationAt, {
                    tagName: this.tagName,
                });
            }
            return originalGetBoundingClientRect.call(this);
        };
        prototype.__profilingWrappedRect = true;
    };

    const noteReactAvailability = (): void => {
        if ((globalThis as { React?: unknown }).React) {
            recordEvent(queue, 'event', 'react.profiler.available', 1);
        }
    };

    const enable = (config: ProfilingConfig): void => {
        enabled = config.enabled;
        sampleIntervalMs = Math.max(250, config.sampleIntervalMs || 1000);
        httpAddr = typeof config.httpAddr === 'string' ? config.httpAddr : '';
        if (!enabled) {
            stopSampling();
            return;
        }

        observeEntries(['longtask', 'measure', 'navigation', 'resource', 'paint']);
        installLayoutThrashDetection();
        noteReactAvailability();
        startSampling();
    };

    const removeConfigListener = onEvent(profilerFrontendConfigEvent, (config: ProfilingConfig) => {
        enable(config);
    });
    detachFns.push(removeConfigListener);
    emitEvent(profilerFrontendReadyEvent, nowTimestamp());

    const api: ProfilingAPI = {
        startMark,
        endMark,
        measure,
        snapshot,
        flush,
    };

    (windowObject as Window & { __profiling?: ProfilingAPI }).__profiling = api;
    return api;
};