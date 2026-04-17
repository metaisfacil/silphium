/// <reference types="vite/client" />

type ProfilingSnapshot = {
	enabled: boolean;
	queuedEventCount: number;
	lastFlushAt: string | null;
	lastFPS: number;
	lastLongTaskMs: number;
	lastEventLoopLagMs: number;
	sampleIntervalMs: number;
};

type ProfilingAPI = {
	startMark: (name: string) => void;
	endMark: (name: string, meta?: Record<string, unknown>) => number;
	measure: (name: string, startMark?: string, endMark?: string, meta?: Record<string, unknown>) => number;
	snapshot: () => ProfilingSnapshot;
	flush: () => Promise<void>;
};

interface Window {
	__profiling?: ProfilingAPI;
}
