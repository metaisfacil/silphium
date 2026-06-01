package main

import (
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestSystemMediaTransportControlsSnapshotForStateFallsBackToTrackTagDuration(t *testing.T) {
	app := NewApp()
	trackPath := filepath.Join(t.TempDir(), "boy.flac")
	if err := os.WriteFile(trackPath, []byte("test"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", trackPath, err)
	}

	signature, ok := trackTagsFileSignatureForPath(trackPath)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", trackPath)
	}

	app.putTrackTagsCache(trackPath, signature, TrackTags{
		Title:        "Boy",
		Artist:       "UCHUSENTAI:NOIZ",
		Album:        "Boy",
		AlbumArtist:  "UCHUSENTAI:NOIZ",
		DurationSecs: 215.5,
	}, true)

	snapshot := app.systemMediaTransportControlsSnapshotForState(AudioPlaybackState{
		Loaded:      true,
		Playing:     false,
		CurrentTime: 82.564561,
		Duration:    0,
		SourcePath:  trackPath,
	})

	if snapshot.Duration != 215.5 {
		t.Fatalf("snapshot.Duration = %v, want 215.5", snapshot.Duration)
	}
	if snapshot.Title != "Boy" {
		t.Fatalf("snapshot.Title = %q, want %q", snapshot.Title, "Boy")
	}
	if snapshot.Artist != "UCHUSENTAI:NOIZ" {
		t.Fatalf("snapshot.Artist = %q, want %q", snapshot.Artist, "UCHUSENTAI:NOIZ")
	}
}

func TestSystemMediaTransportControlsSnapshotUsesSelectiveSQLiteFallbackWithoutLoadingStore(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := newTestAppWithLoadedSettings(AppSettings{})
	app.settingsPath = filepath.Join(t.TempDir(), appSettingsFileName)

	signature, ok := trackTagsFileSignatureForPath(fixture.trackOne)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", fixture.trackOne)
	}

	store := newMusicBrainzTagDatabaseStore()
	store.Tracks[normalizePath(fixture.trackOne)] = musicBrainzTagTrackRecord{
		Signature:       signature,
		Title:           "Intro",
		TrackArtist:     "Artist One",
		AlbumTitle:      "Album One",
		AlbumArtist:     "Album Artist One",
		TrackNumber:     1,
		TrackTotal:      8,
		DurationSeconds: 215.5,
	}
	if err := writeMusicBrainzTagDatabaseStoreToSQLite(app.musicBrainzTagDatabasePath(), store); err != nil {
		t.Fatalf("writeMusicBrainzTagDatabaseStoreToSQLite() error = %v", err)
	}

	snapshot := app.systemMediaTransportControlsSnapshotForState(AudioPlaybackState{
		Loaded:      true,
		Playing:     false,
		CurrentTime: 0,
		Duration:    0,
		SourcePath:  normalizePath(fixture.trackOne),
	})

	if snapshot.Title != "Intro" {
		t.Fatalf("snapshot.Title = %q, want %q", snapshot.Title, "Intro")
	}
	if snapshot.Artist != "Artist One" {
		t.Fatalf("snapshot.Artist = %q, want %q", snapshot.Artist, "Artist One")
	}
	if snapshot.AlbumTitle != "Album One" {
		t.Fatalf("snapshot.AlbumTitle = %q, want %q", snapshot.AlbumTitle, "Album One")
	}
	if snapshot.AlbumArtist != "Album Artist One" {
		t.Fatalf("snapshot.AlbumArtist = %q, want %q", snapshot.AlbumArtist, "Album Artist One")
	}
	if snapshot.Duration != 215.5 {
		t.Fatalf("snapshot.Duration = %v, want 215.5", snapshot.Duration)
	}
	if app.musicBrainzTagStoreLoaded {
		t.Fatal("systemMediaTransportControlsSnapshotForState() loaded the metadata store, want selective SQLite fallback")
	}
	if _, _, cacheHit := app.getTrackTagsCache(normalizePath(fixture.trackOne), signature); cacheHit {
		t.Fatal("systemMediaTransportControlsSnapshotForState() populated the shared track-tags cache from a partial SQLite row")
	}
}

func TestTimeSpanSyscallArgUsesDurationValue(t *testing.T) {
	const durationValue = int64(2_155_000_000)

	if got := timeSpanSyscallArg(timeSpan{Duration: durationValue}); got != uintptr(durationValue) {
		t.Fatalf("timeSpanSyscallArg() = %d, want %d", got, durationValue)
	}
}

func TestNormalizeSystemMediaTransportControlsSeekSeconds(t *testing.T) {
	testCases := []struct {
		name   string
		input  float64
		want   float64
		wantOK bool
	}{
		{name: "regular", input: 12.5, want: 12.5, wantOK: true},
		{name: "negative clamps to start", input: -4.25, want: 0, wantOK: true},
		{name: "nan rejected", input: math.NaN(), want: 0, wantOK: false},
		{name: "positive infinity rejected", input: math.Inf(1), want: 0, wantOK: false},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			got, gotOK := normalizeSystemMediaTransportControlsSeekSeconds(testCase.input)
			if gotOK != testCase.wantOK {
				t.Fatalf("normalizeSystemMediaTransportControlsSeekSeconds(%v) ok = %t, want %t", testCase.input, gotOK, testCase.wantOK)
			}
			if got != testCase.want {
				t.Fatalf("normalizeSystemMediaTransportControlsSeekSeconds(%v) = %v, want %v", testCase.input, got, testCase.want)
			}
		})
	}
}

func TestPlaybackStatusForSnapshot(t *testing.T) {
	testCases := []struct {
		name     string
		snapshot systemMediaTransportControlsSnapshot
		want     uintptr
	}{
		{
			name:     "unloaded snapshot resets to closed",
			snapshot: systemMediaTransportControlsSnapshot{},
			want:     mediaPlaybackStatusClosed,
		},
		{
			name: "loaded snapshot without source resets to closed",
			snapshot: systemMediaTransportControlsSnapshot{
				Loaded: true,
			},
			want: mediaPlaybackStatusClosed,
		},
		{
			name: "playing snapshot reports playing",
			snapshot: systemMediaTransportControlsSnapshot{
				Loaded:     true,
				Playing:    true,
				SourcePath: `C:\music\track.flac`,
			},
			want: mediaPlaybackStatusPlaying,
		},
		{
			name: "paused snapshot reports paused",
			snapshot: systemMediaTransportControlsSnapshot{
				Loaded:     true,
				Playing:    false,
				SourcePath: `C:\music\track.flac`,
			},
			want: mediaPlaybackStatusPaused,
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := playbackStatusForSnapshot(testCase.snapshot); got != testCase.want {
				t.Fatalf("playbackStatusForSnapshot(%+v) = %d, want %d", testCase.snapshot, got, testCase.want)
			}
		})
	}
}

func TestSystemMediaTransportControlsResetPlaybackStatus(t *testing.T) {
	if got := systemMediaTransportControlsResetPlaybackStatus(); got != mediaPlaybackStatusClosed {
		t.Fatalf("systemMediaTransportControlsResetPlaybackStatus() = %d, want %d", got, mediaPlaybackStatusClosed)
	}
}

func TestSystemMediaTransportControlsWindowTitleScore(t *testing.T) {
	testCases := []struct {
		name  string
		title string
		want  int
	}{
		{name: "blank rejected", title: "   ", want: -1},
		{name: "exact Silphium preferred", title: "Silphium", want: 2},
		{name: "case-insensitive Silphium accepted", title: "silphium", want: 1},
		{name: "other titled window accepted", title: "Silphium Dev Build", want: 0},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := systemMediaTransportControlsWindowTitleScore(testCase.title); got != testCase.want {
				t.Fatalf("systemMediaTransportControlsWindowTitleScore(%q) = %d, want %d", testCase.title, got, testCase.want)
			}
		})
	}
}

func TestTimeSpanToSeconds(t *testing.T) {
	got := timeSpanToSeconds(secondsToTimeSpan(215.5))
	if math.Abs(got-215.5) > 0.0001 {
		t.Fatalf("timeSpanToSeconds(secondsToTimeSpan(215.5)) = %v, want 215.5", got)
	}
}
