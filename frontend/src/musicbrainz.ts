import { BrowserOpenURL } from '../wailsjs/runtime/runtime';

const MB_BASE = 'https://musicbrainz.org';
const artistJoinPhrasePattern = /\s+featuring\s*|\s+feat(?!uring)\.?\s*|\s+ft\.?\s*|\s+and\s+|\s*&\s*|\s*,\s*|\s*;\s*|\s*\/\s*|\s+\+\s*|\s+x\s+/gi;

export type MusicBrainzIds = {
    recordingId?: string;
    releaseId?: string;
    artistId?: string;
};

type ArtistLinkOptions = {
    artistText?: string;
    artistMbids?: string[];
};

type ParsedArtistCredits = {
    artists: string[];
    joinPhrases: string[];
};

const mbUrl = (type: string, id?: string): string | undefined =>
    id ? `${MB_BASE}/${type}/${id}` : undefined;

const setLink = (el: HTMLElement, url: string | undefined): void => {
    if (url) {
        el.dataset.mbUrl = url;
    } else {
        delete el.dataset.mbUrl;
    }
};

const normalizeArtistMbids = (artistMbids?: string[]): string[] => {
    if (!artistMbids || artistMbids.length === 0) {
        return [];
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const mbid of artistMbids) {
        const clean = mbid.trim();
        if (!clean) {
            continue;
        }

        const key = clean.toLowerCase();
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        normalized.push(clean);
    }

    return normalized;
};

const parseArtistCredits = (artistText: string, expectedArtists: number): ParsedArtistCredits | null => {
    if (expectedArtists <= 0) {
        return null;
    }

    if (expectedArtists === 1) {
        return {
            artists: [artistText.trim()],
            joinPhrases: [],
        };
    }

    const separatorMatcher = new RegExp(artistJoinPhrasePattern.source, artistJoinPhrasePattern.flags);
    const artists: string[] = [];
    const joinPhrases: string[] = [];
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = separatorMatcher.exec(artistText)) !== null && artists.length < expectedArtists - 1) {
        const artist = artistText.slice(cursor, match.index).trim();
        if (!artist) {
            continue;
        }

        artists.push(artist);
        joinPhrases.push(match[0]);
        cursor = match.index + match[0].length;
    }

    const tail = artistText.slice(cursor).trim();
    if (!tail) {
        return null;
    }

    artists.push(tail);
    if (artists.length !== expectedArtists) {
        return null;
    }

    return { artists, joinPhrases };
};

const renderArtistLinks = (
    artistEl: HTMLElement,
    artistText: string,
    artistMbids: string[],
    fallbackArtistId?: string,
): void => {
    setLink(artistEl, undefined);
    artistEl.textContent = artistText;

    if (!artistText) {
        return;
    }

    if (artistMbids.length === 0) {
        setLink(artistEl, mbUrl('artist', fallbackArtistId));
        return;
    }

    if (artistMbids.length === 1) {
        setLink(artistEl, mbUrl('artist', artistMbids[0]));
        return;
    }

    const parsed = parseArtistCredits(artistText, artistMbids.length);
    if (!parsed) {
        setLink(artistEl, mbUrl('artist', artistMbids[0] || fallbackArtistId));
        return;
    }

    artistEl.textContent = '';
    for (let index = 0; index < parsed.artists.length; index += 1) {
        const artistSpan = document.createElement('span');
        artistSpan.className = 'track-artist-link';
        artistSpan.textContent = parsed.artists[index];
        setLink(artistSpan, mbUrl('artist', artistMbids[index]));
        artistEl.append(artistSpan);

        const joinPhrase = parsed.joinPhrases[index];
        if (joinPhrase) {
            artistEl.append(document.createTextNode(joinPhrase));
        }
    }
};

export const applyMbLinks = (
    titleEl: HTMLElement,
    albumEl: HTMLElement,
    artistEl: HTMLElement,
    ids: MusicBrainzIds,
    options?: ArtistLinkOptions,
): void => {
    setLink(titleEl, mbUrl('recording', ids.recordingId));
    setLink(albumEl, mbUrl('release', ids.releaseId));

    const artistText = options?.artistText ?? artistEl.textContent ?? '';
    const artistMbids = normalizeArtistMbids(options?.artistMbids);
    renderArtistLinks(artistEl, artistText, artistMbids, ids.artistId);
};

export const openMbLink = (el: HTMLElement): void => {
    const closest = el.closest('[data-mb-url]');
    const url = closest instanceof HTMLElement ? closest.dataset.mbUrl : el.dataset.mbUrl;
    if (url) {
        BrowserOpenURL(url);
    }
};
