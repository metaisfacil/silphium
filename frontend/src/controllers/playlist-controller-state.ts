export type PlaylistSource = 'queue' | 'playlist';

export type PlaylistControllerState = {
    loadedPlaylistTrackIndexes: number[] | null;
    loadedPlaylistName: string;
    loadedPlaylistPath: string;
    editableQueueTrackIndexes: number[] | null;
    selectedSource: PlaylistSource;
    selectedFavoriteIndex: number | null;
    playbackSource: PlaylistSource;
};

export const createPlaylistControllerState = (): PlaylistControllerState => ({
    loadedPlaylistTrackIndexes: null,
    loadedPlaylistName: '',
    loadedPlaylistPath: '',
    editableQueueTrackIndexes: null,
    selectedSource: 'queue',
    selectedFavoriteIndex: null,
    playbackSource: 'queue',
});