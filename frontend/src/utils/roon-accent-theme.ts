export type RoonAccentSettings = {
    color: string;
    saturation: number;
};

type RoonAccentThemeInput = {
    color?: string | null;
    saturation?: number | string | null;
};

type RgbColor = {
    r: number;
    g: number;
    b: number;
};

type HslColor = {
    h: number;
    s: number;
    l: number;
};

export const DEFAULT_ROON_ACCENT_COLOR = '#68b4ff';
export const DEFAULT_ROON_ACCENT_SATURATION = 100;

const clampUnit = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(1, Math.max(0, value));
};

const clampByte = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(255, Math.max(0, Math.round(value)));
};

const toHex = (value: number): string => clampByte(value).toString(16).padStart(2, '0');

const rgbToHex = (color: RgbColor): string => `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;

const parseHexColor = (value: string | null | undefined): RgbColor | null => {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    const shortMatch = /^#?([0-9a-f]{3})$/i.exec(trimmed);
    if (shortMatch) {
        const [r, g, b] = shortMatch[1].split('');
        return {
            r: Number.parseInt(`${r}${r}`, 16),
            g: Number.parseInt(`${g}${g}`, 16),
            b: Number.parseInt(`${b}${b}`, 16),
        };
    }

    const longMatch = /^#?([0-9a-f]{6})$/i.exec(trimmed);
    if (!longMatch) {
        return null;
    }

    return {
        r: Number.parseInt(longMatch[1].slice(0, 2), 16),
        g: Number.parseInt(longMatch[1].slice(2, 4), 16),
        b: Number.parseInt(longMatch[1].slice(4, 6), 16),
    };
};

const rgbToHsl = (color: RgbColor): HslColor => {
    const red = clampByte(color.r) / 255;
    const green = clampByte(color.g) / 255;
    const blue = clampByte(color.b) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;

    if (max === min) {
        return { h: 0, s: 0, l: lightness };
    }

    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue = 0;

    switch (max) {
        case red:
            hue = (green - blue) / delta + (green < blue ? 6 : 0);
            break;
        case green:
            hue = (blue - red) / delta + 2;
            break;
        default:
            hue = (red - green) / delta + 4;
            break;
    }

    return {
        h: (hue / 6) % 1,
        s: clampUnit(saturation),
        l: clampUnit(lightness),
    };
};

const hueToRgb = (p: number, q: number, t: number): number => {
    let value = t;
    if (value < 0) {
        value += 1;
    }
    if (value > 1) {
        value -= 1;
    }
    if (value < 1 / 6) {
        return p + (q - p) * 6 * value;
    }
    if (value < 1 / 2) {
        return q;
    }
    if (value < 2 / 3) {
        return p + (q - p) * (2 / 3 - value) * 6;
    }

    return p;
};

const hslToRgb = (color: HslColor): RgbColor => {
    const hue = ((color.h % 1) + 1) % 1;
    const saturation = clampUnit(color.s);
    const lightness = clampUnit(color.l);

    if (saturation === 0) {
        const grey = clampByte(lightness * 255);
        return { r: grey, g: grey, b: grey };
    }

    const q = lightness < 0.5
        ? lightness * (1 + saturation)
        : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;

    return {
        r: clampByte(hueToRgb(p, q, hue + 1 / 3) * 255),
        g: clampByte(hueToRgb(p, q, hue) * 255),
        b: clampByte(hueToRgb(p, q, hue - 1 / 3) * 255),
    };
};

const mixColors = (source: RgbColor, target: RgbColor, targetWeight: number): RgbColor => {
    const weight = clampUnit(targetWeight);
    const sourceWeight = 1 - weight;
    return {
        r: clampByte(source.r * sourceWeight + target.r * weight),
        g: clampByte(source.g * sourceWeight + target.g * weight),
        b: clampByte(source.b * sourceWeight + target.b * weight),
    };
};

const toCssRgbValue = (color: RgbColor): string => `${clampByte(color.r)} ${clampByte(color.g)} ${clampByte(color.b)}`;

export const normalizeRoonAccentColor = (value: string | null | undefined): string => {
    const parsed = parseHexColor(value);
    return parsed ? rgbToHex(parsed) : DEFAULT_ROON_ACCENT_COLOR;
};

export const normalizeRoonAccentSaturation = (value: number | string | null | undefined): number => {
    const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
        return DEFAULT_ROON_ACCENT_SATURATION;
    }

    return Math.min(100, Math.max(0, Math.round(parsed)));
};

export const resolveRoonAccentTheme = (settings: RoonAccentThemeInput | undefined) => {
    const color = normalizeRoonAccentColor(settings?.color);
    const saturation = normalizeRoonAccentSaturation(settings?.saturation);
    const baseColor = parseHexColor(color) ?? parseHexColor(DEFAULT_ROON_ACCENT_COLOR)!;
    const hsl = rgbToHsl(baseColor);
    const accentColor = hslToRgb({
        h: hsl.h,
        s: clampUnit(hsl.s * (saturation / 100)),
        l: hsl.l,
    });
    const accentSoft = mixColors(accentColor, { r: 255, g: 255, b: 255 }, 0.18);
    const accentSurface = mixColors(accentColor, { r: 10, g: 14, b: 22 }, 0.88);
    const accentDeep = mixColors(accentColor, { r: 8, g: 12, b: 18 }, 0.82);
    const sidebarTop = mixColors(accentColor, { r: 9, g: 12, b: 18 }, 0.78);
    const sidebarBottom = mixColors(accentColor, { r: 5, g: 8, b: 14 }, 0.9);
    const taskbarTop = mixColors(accentColor, { r: 15, g: 18, b: 25 }, 0.86);
    const taskbarBottom = mixColors(accentColor, { r: 8, g: 10, b: 16 }, 0.94);

    return {
        color,
        saturation,
        appliedColor: rgbToHex(accentColor),
        cssVars: {
            '--roon-accent-rgb': toCssRgbValue(accentColor),
            '--roon-accent-soft-rgb': toCssRgbValue(accentSoft),
            '--roon-accent-surface-rgb': toCssRgbValue(accentSurface),
            '--roon-accent-deep-rgb': toCssRgbValue(accentDeep),
            '--roon-accent-sidebar-top-rgb': toCssRgbValue(sidebarTop),
            '--roon-accent-sidebar-bottom-rgb': toCssRgbValue(sidebarBottom),
            '--roon-accent-taskbar-top-rgb': toCssRgbValue(taskbarTop),
            '--roon-accent-taskbar-bottom-rgb': toCssRgbValue(taskbarBottom),
        },
    };
};