import type {
    AudioOutputDevice,
    AudioPlaybackState,
    LibraryFolderPage,
    LibraryIndexedFilePage,
    LibraryScanProgress,
    LibraryScanResult,
    LibrarySearchPage,
} from '../types/app-types';
import * as appBindings from '../../wailsjs/go/main/App';
import { formatPerfLogMessage } from './perf-log';

type BridgeTraceDetails = Record<string, unknown>;

type BridgeTraceSink = (message: string) => Promise<unknown> | unknown;

type TraceBridgeCallOptions<T> = {
    details?: BridgeTraceDetails;
    sink?: BridgeTraceSink;
    summarizeError?: (error: unknown) => BridgeTraceDetails | undefined;
    summarizeResult?: (result: T) => BridgeTraceDetails | undefined;
};

let bridgeTraceSequence = 0;

const maxTraceStringLength = 120;
const maxTraceArraySample = 4;
const maxTraceObjectSample = 4;

const truncateBridgeString = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length <= maxTraceStringLength) {
        return trimmed;
    }

    return `${trimmed.slice(0, maxTraceStringLength - 3)}...`;
};

const describeBridgeError = (error: unknown): string => {
    if (error instanceof Error) {
        return truncateBridgeString(error.message || error.name || 'Error');
    }
    if (typeof error === 'string') {
        return truncateBridgeString(error);
    }

    return truncateBridgeString(String(error));
};

const describeBridgeValue = (value: unknown): string => {
    if (typeof value === 'string') {
        return JSON.stringify(truncateBridgeString(value));
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (value === null) {
        return 'null';
    }
    if (value === undefined) {
        return 'undefined';
    }
    if (value instanceof Error) {
        return JSON.stringify(describeBridgeError(value));
    }
    if (Array.isArray(value)) {
        const sample = value.slice(0, maxTraceArraySample).map((entry) => describeBridgeValue(entry)).join(', ');
        const suffix = value.length > maxTraceArraySample ? ', ...' : '';
        return `${value.length}[${sample}${suffix}]`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).slice(0, maxTraceObjectSample)
            .map(([key, entryValue]) => `${key}:${describeBridgeValue(entryValue)}`);
        const suffix = Object.keys(value as Record<string, unknown>).length > maxTraceObjectSample ? ', ...' : '';
        return `{${entries.join(', ')}${suffix}}`;
    }

    return JSON.stringify(truncateBridgeString(String(value)));
};

const formatBridgeTraceDetails = (details: BridgeTraceDetails | undefined): string => {
    if (!details) {
        return '';
    }

    const tokens = Object.entries(details)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${describeBridgeValue(value)}`);
    return tokens.join(' ');
};

const emitBridgeTraceLine = (message: string, sink?: BridgeTraceSink): void => {
    console.warn(message);
    if (!sink) {
        return;
    }

    void Promise.resolve(sink(message)).catch(() => undefined);
};

const nextBridgeTraceSequence = (): number => {
    bridgeTraceSequence += 1;
    return bridgeTraceSequence;
};

const reserveBridgeTraceRequestId = (scope: string, name: string): Promise<number | undefined> | undefined => {
    let reserveRequestId: ((scope: string, name: string) => Promise<number> | number) | undefined;
    try {
        reserveRequestId = appBindings.ReserveBridgeTraceRequestID;
    } catch {
        return undefined;
    }

    if (typeof reserveRequestId !== 'function') {
        return undefined;
    }

    try {
        return Promise.resolve(reserveRequestId(scope, name)).then((requestId) => {
            if (typeof requestId !== 'number' || !Number.isFinite(requestId) || requestId <= 0) {
                return undefined;
            }
            return requestId;
        }).catch(() => undefined);
    } catch {
        return Promise.resolve(undefined);
    }
};

export const logBridgeEvent = (
    scope: string,
    name: string,
    details?: BridgeTraceDetails,
    options: { sink?: BridgeTraceSink } = {},
): void => {
    const sequence = nextBridgeTraceSequence();
    const formattedDetails = formatBridgeTraceDetails(details);
    emitBridgeTraceLine(
        formatPerfLogMessage(`[BRIDGE] FE #${sequence} ${scope} ${name}${formattedDetails ? ` ${formattedDetails}` : ''}`),
        options.sink,
    );
};

export const traceBridgeCall = async <T>(
    scope: string,
    name: string,
    callback: () => Promise<T>,
    options: TraceBridgeCallOptions<T> = {},
): Promise<T> => {
    const sequence = nextBridgeTraceSequence();
    const requestIdPromise = reserveBridgeTraceRequestId(scope, name);
    const requestId = requestIdPromise ? await requestIdPromise : undefined;
    const startedAtMs = performance.now();
    const startDetails = formatBridgeTraceDetails(options.details);
    emitBridgeTraceLine(
        formatPerfLogMessage(
            `[BRIDGE] FE #${sequence} ${scope} ${name} START`
            + `${requestId ? ` requestId=${requestId}` : ''}`
            + `${startDetails ? ` ${startDetails}` : ''}`,
        ),
        options.sink,
    );

    try {
        const result = await callback();
        const resultDetails = formatBridgeTraceDetails(options.summarizeResult?.(result));
        emitBridgeTraceLine(
            formatPerfLogMessage(
                `[BRIDGE] FE #${sequence} ${scope} ${name} END`
                + `${requestId ? ` requestId=${requestId}` : ''}`
                + ` bridgeElapsed=${(performance.now() - startedAtMs).toFixed(1)}ms`
                + `${resultDetails ? ` ${resultDetails}` : ''}`,
            ),
            options.sink,
        );
        return result;
    } catch (error) {
        const errorDetails = formatBridgeTraceDetails({
            ...(options.summarizeError?.(error) || {}),
            error: describeBridgeError(error),
        });
        emitBridgeTraceLine(
            formatPerfLogMessage(
                `[BRIDGE] FE #${sequence} ${scope} ${name} ERROR`
                + `${requestId ? ` requestId=${requestId}` : ''}`
                + ` bridgeElapsed=${(performance.now() - startedAtMs).toFixed(1)}ms`
                + `${errorDetails ? ` ${errorDetails}` : ''}`,
            ),
            options.sink,
        );
        throw error;
    }
};

export const summarizeAudioPlaybackStateForBridge = (
    state: AudioPlaybackState | Partial<AudioPlaybackState> | null | undefined,
): BridgeTraceDetails => ({
    loaded: !!state?.loaded,
    playing: !!state?.playing,
    currentTime: typeof state?.currentTime === 'number' ? Number(state.currentTime.toFixed(3)) : undefined,
    duration: typeof state?.duration === 'number' ? Number(state.duration.toFixed(3)) : undefined,
    sourcePath: state?.sourcePath || undefined,
    volume: typeof state?.volume === 'number' ? Number(state.volume.toFixed(3)) : undefined,
    endEventId: typeof state?.endEventId === 'number' ? state.endEventId : undefined,
});

export const summarizeAudioOutputDevicesForBridge = (devices: AudioOutputDevice[] | null | undefined): BridgeTraceDetails => ({
    devices: Array.isArray(devices) ? devices.length : 0,
    selectedDefault: Array.isArray(devices) ? devices.find((device) => device.isDefault)?.name || undefined : undefined,
});

export const summarizeLibraryScanResultForBridge = (scanResult: LibraryScanResult | null | undefined): BridgeTraceDetails => ({
    rootPath: scanResult?.rootPath || undefined,
    rootName: scanResult?.rootName || undefined,
    scanGeneration: scanResult?.scanGeneration,
    totalEntries: scanResult?.totalEntries,
    trackCount: scanResult?.trackCount,
    textFileCount: scanResult?.textFileCount,
    imageFileCount: scanResult?.imageFileCount,
    deferredFiles: !!scanResult?.deferredFiles,
    truncated: !!scanResult?.truncated,
});

export const summarizeLibraryScanProgressForBridge = (progress: LibraryScanProgress | null | undefined): BridgeTraceDetails => ({
    rootPath: progress?.rootPath || undefined,
    entriesScanned: progress?.entriesScanned,
    totalEntries: progress?.totalEntries,
    elapsedMs: progress?.elapsedMs,
    etaSeconds: progress?.etaSeconds,
    phase: progress?.phase || undefined,
});

export const summarizeLibraryIndexedFilePageForBridge = (page: LibraryIndexedFilePage | null | undefined): BridgeTraceDetails => ({
    kind: page?.kind || undefined,
    offset: page?.offset,
    limit: page?.limit,
    totalEntries: page?.totalEntries,
    entries: page?.entries?.length,
});

export const summarizeLibraryFolderPageForBridge = (page: LibraryFolderPage | null | undefined): BridgeTraceDetails => ({
    folderPath: page?.folderPath || undefined,
    offset: page?.offset,
    limit: page?.limit,
    totalEntries: page?.totalEntries,
    entries: page?.entries?.length,
});

export const summarizeLibrarySearchPageForBridge = (page: LibrarySearchPage | null | undefined): BridgeTraceDetails => ({
    query: page?.query || undefined,
    offset: page?.offset,
    limit: page?.limit,
    totalEntries: page?.totalEntries,
    entries: page?.entries?.length,
});