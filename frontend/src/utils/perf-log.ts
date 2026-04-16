const padPerfTimestampPart = (value: number, width = 2): string => String(value).padStart(width, '0');

export const formatPerfTimestamp = (date: Date = new Date()): string => {
    const year = date.getFullYear();
    const month = padPerfTimestampPart(date.getMonth() + 1);
    const day = padPerfTimestampPart(date.getDate());
    const hours = padPerfTimestampPart(date.getHours());
    const minutes = padPerfTimestampPart(date.getMinutes());
    const seconds = padPerfTimestampPart(date.getSeconds());
    const milliseconds = padPerfTimestampPart(date.getMilliseconds(), 3);
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
};

export const formatPerfLogMessage = (message: string, date: Date = new Date()): string => {
    return `[${formatPerfTimestamp(date)}] [PERF] ${message}`;
};