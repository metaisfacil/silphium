import type { ArtistDetails, ArtistExternalUrl, Track } from '../types/app-types';
import { faviconUrlForResource } from '../utils/musicbrainz-entity-helpers';

type ArtistInfoElements = {
    artistInfoName: HTMLElement;
    artistInfoType: HTMLElement;
    artistInfoCountry: HTMLElement;
    artistInfoLifeSpan: HTMLElement;
    artistInfoGenres: HTMLElement;
    artistInfoSummary: HTMLElement;
    artistInfoLinks: HTMLElement;
};

type ArtistInfoControllerOptions = {
    elements: ArtistInfoElements;
    getTracks: () => Track[];
    getCurrentTrackIndex: () => number;
    getRequestVersion: () => number;
    lookupArtistByMBID: (mbid: string) => Promise<ArtistDetails>;
    openUrl: (url: string) => unknown;
};

export type ArtistInfoController = ReturnType<typeof createArtistInfoController>;

export const createArtistInfoController = (options: ArtistInfoControllerOptions) => {
    const {
        artistInfoName,
        artistInfoType,
        artistInfoCountry,
        artistInfoLifeSpan,
        artistInfoGenres,
        artistInfoSummary,
        artistInfoLinks,
    } = options.elements;

    const artistInfoByMBID = new Map<string, ArtistDetails>();

    const renderArtistUrlIcons = (urls?: ArtistExternalUrl[]): void => {
        artistInfoLinks.innerHTML = '';

        if (!urls || urls.length === 0) {
            artistInfoLinks.hidden = true;
            return;
        }

        artistInfoLinks.hidden = false;
        for (const url of urls) {
            const button = document.createElement('button');
            button.className = 'artist-link-btn';
            button.type = 'button';

            const fallback = document.createElement('span');
            fallback.className = 'artist-link-fallback';
            fallback.textContent = '🔗';

            const faviconUrl = faviconUrlForResource(url.resource);
            if (faviconUrl) {
                const icon = document.createElement('img');
                icon.className = 'artist-link-icon';
                icon.alt = '';
                icon.loading = 'lazy';
                icon.decoding = 'async';
                icon.referrerPolicy = 'no-referrer';
                icon.src = faviconUrl;
                icon.addEventListener('error', () => {
                    icon.remove();
                    fallback.hidden = false;
                });
                fallback.hidden = true;
                button.append(icon, fallback);
            } else {
                fallback.hidden = false;
                button.append(fallback);
            }

            button.title = `${url.type || 'Link'}: ${url.resource}`;
            button.setAttribute('aria-label', button.title);
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                void options.openUrl(url.resource);
            });
            artistInfoLinks.append(button);
        }
    };

    const reset = (): void => {
        artistInfoName.textContent = 'No artist info';
        artistInfoType.textContent = 'Type: —';
        artistInfoCountry.textContent = 'Country: —';
        artistInfoLifeSpan.textContent = 'Life span: —';
        artistInfoGenres.textContent = 'Genres: —';
        artistInfoSummary.textContent = 'Flip back after MBID lookup to see details.';
        renderArtistUrlIcons();
    };

    const renderArtistInfoPanel = (details: ArtistDetails): void => {
        artistInfoName.textContent = details.name || 'No artist info';
        artistInfoType.textContent = `Type: ${details.type || '—'}`;
        artistInfoCountry.textContent = `Country: ${details.country || '—'}`;
        artistInfoLifeSpan.textContent = `Life span: ${details.lifeSpan || '—'}`;
        artistInfoGenres.textContent = `Genres: ${details.genres?.length ? details.genres.join(', ') : '—'}`;
        artistInfoSummary.textContent = 'Artist information from MusicBrainz.';
        renderArtistUrlIcons(details.urls);
    };

    const hydrate = async (index: number): Promise<void> => {
        const tracks = options.getTracks();
        if (index < 0 || index >= tracks.length) {
            return;
        }

        const mbid = tracks[index].artistMbids[0];
        if (!mbid) {
            reset();
            return;
        }

        const cached = artistInfoByMBID.get(mbid);
        if (cached) {
            renderArtistInfoPanel(cached);
            return;
        }

        artistInfoSummary.textContent = 'Loading artist details from MusicBrainz…';
        const requestVersion = options.getRequestVersion();

        try {
            const details = await options.lookupArtistByMBID(mbid);
            if (requestVersion !== options.getRequestVersion() || index !== options.getCurrentTrackIndex()) {
                return;
            }

            if (!details.found) {
                artistInfoSummary.textContent = 'No artist details found for this MBID.';
                return;
            }

            artistInfoByMBID.set(mbid, details);
            renderArtistInfoPanel(details);
        } catch (error) {
            console.error(error);
            if (requestVersion === options.getRequestVersion() && index === options.getCurrentTrackIndex()) {
                artistInfoSummary.textContent = 'Unable to load artist details right now.';
            }
        }
    };

    return {
        clearCache: (): void => {
            artistInfoByMBID.clear();
        },
        hydrate,
        reset,
    };
};
