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
            fallback.innerHTML = '<svg class="overlay-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M8.71 15.29C7.93 14.51 7.93 13.24 8.71 12.46L12.46 8.71C13.24 7.93 14.51 7.93 15.29 8.71C16.07 9.49 16.07 10.76 15.29 11.54L14.37 12.46C13.98 12.85 13.98 13.48 14.37 13.87C14.76 14.26 15.39 14.26 15.78 13.87L16.7 12.95C18.27 11.39 18.27 8.86 16.7 7.29C15.14 5.73 12.61 5.73 11.05 7.29L7.29 11.05C5.73 12.61 5.73 15.14 7.29 16.7C8.86 18.27 11.39 18.27 12.95 16.7L13.87 15.78C14.26 15.39 14.26 14.76 13.87 14.37C13.48 13.98 12.85 13.98 12.46 14.37L11.54 15.29C10.76 16.07 9.49 16.07 8.71 15.29Z"/></svg>';

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
