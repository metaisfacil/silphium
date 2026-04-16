import { describe, expect, it } from 'vitest';

import { formatPerfLogMessage, formatPerfTimestamp } from './perf-log';

describe('formatPerfTimestamp', () => {
    it('formats timestamps with millisecond precision', () => {
        const date = new Date(2026, 3, 16, 18, 56, 29, 944);

        expect(formatPerfTimestamp(date)).toBe('2026-04-16 18:56:29.944');
    });
});

describe('formatPerfLogMessage', () => {
    it('prepends a timestamped PERF prefix', () => {
        const date = new Date(2026, 3, 16, 18, 56, 29, 944);

        expect(formatPerfLogMessage('frame gap 142.5ms', date)).toBe('[2026-04-16 18:56:29.944] [PERF] frame gap 142.5ms');
    });
});