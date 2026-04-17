export type PlaylistSource = 'queue' | 'playlist' | 'history';

export type LoadedListenHistoryItem = {
    listenedAt: number;
};

export type LoadedPlaylistCachedItem = {
    cachedTrackTitle?: string;
    cachedArtistName?: string;
};

export type PlaylistControllerState = {
    loadedPlaylistTrackIndexes: number[] | null;
    loadedPlaylistName: string;
    loadedPlaylistPath: string;
    loadedPlaylistReadOnly: boolean;
    loadedPlaylistHistoryItems: LoadedListenHistoryItem[] | null;
    loadedPlaylistCachedItems: LoadedPlaylistCachedItem[] | null;
    editableQueueTrackIndexes: number[] | null;
    editableQueueCurrentPosition: number | null;
    selectedSource: PlaylistSource;
    selectedFavoriteIndex: number | null;
    playbackSource: PlaylistSource;
};

export const createPlaylistControllerState = (): PlaylistControllerState => ({
    loadedPlaylistTrackIndexes: null,
    loadedPlaylistName: '',
    loadedPlaylistPath: '',
    loadedPlaylistReadOnly: false,
    loadedPlaylistHistoryItems: null,
    loadedPlaylistCachedItems: null,
    editableQueueTrackIndexes: null,
    editableQueueCurrentPosition: null,
    selectedSource: 'queue',
    selectedFavoriteIndex: null,
    playbackSource: 'queue',
});