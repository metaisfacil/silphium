package main

import (
	"errors"
	"fmt"
	"strconv"
)

func formatReplayGainDBTagValue(gainDB float64) string {
	return fmt.Sprintf("%+.2f dB", gainDB)
}

func formatReplayGainPeakTagValue(peak float64) string {
	return strconv.FormatFloat(peak, 'f', 6, 64)
}

// AudioGetReplayGainReleaseDynamicRange resolves the release dynamic range used to indicate album-scoped ReplayGain.
func (a *App) AudioGetReplayGainReleaseDynamicRange(replayGainReleasePaths []string) (int, error) {
	return profiledResult(a, "AudioGetReplayGainReleaseDynamicRange", func() (int, error) {
		normalizedReplayGainReleasePaths, err := a.normalizeReplayGainContextPaths(replayGainReleasePaths, "")
		if err != nil {
			return 0, err
		}

		if len(normalizedReplayGainReleasePaths) <= 1 {
			return 0, nil
		}

		return a.audioBackend().ReplayGainReleaseDynamicRange(normalizedReplayGainReleasePaths)
	})
}

// AudioWriteReplayGainTags calculates ReplayGain values and writes them into the selected track files.
func (a *App) AudioWriteReplayGainTags(paths []string) error {
	return profiledError(a, "AudioWriteReplayGainTags", func() error {
		normalizedPaths, err := a.normalizeReplayGainContextPaths(paths, "")
		if err != nil {
			return err
		}

		if len(normalizedPaths) == 0 {
			return errors.New("at least one track path is required")
		}

		a.ensureSettingsLoaded()
		backend := a.audioBackend()
		backend.SetFFmpegPath(a.settingsState().settings.FFmpegPath)

		var albumReplayGain ReplayGainInfo
		hasAlbumReplayGain := len(normalizedPaths) > 1
		if hasAlbumReplayGain {
			albumReplayGain, err = calculateAlbumReplayGainWithFFmpeg(normalizedPaths, backend.ffmpegPath)
			if err != nil {
				return fmt.Errorf("calculate album replaygain: %w", err)
			}
		}

		for _, path := range normalizedPaths {
			trackReplayGain, trackErr := calculateReplayGainWithFFmpeg(path, backend.ffmpegPath)
			if trackErr != nil {
				return fmt.Errorf("calculate track replaygain for %q: %w", path, trackErr)
			}

			tags := map[string][]string{
				"REPLAYGAIN_TRACK_GAIN": {formatReplayGainDBTagValue(trackReplayGain.GainDB)},
				"REPLAYGAIN_TRACK_PEAK": {formatReplayGainPeakTagValue(trackReplayGain.Peak)},
			}
			if hasAlbumReplayGain {
				tags["REPLAYGAIN_ALBUM_GAIN"] = []string{formatReplayGainDBTagValue(albumReplayGain.GainDB)}
				tags["REPLAYGAIN_ALBUM_PEAK"] = []string{formatReplayGainPeakTagValue(albumReplayGain.Peak)}
			}

			if writeErr := writeTaglibTags(path, tags, 0); writeErr != nil {
				return fmt.Errorf("write replaygain tags for %q: %w", path, writeErr)
			}
		}

		backend.invalidateReplayGainCachePaths(normalizedPaths)
		if cacheKey, ok := buildReplayGainReleaseCacheKey(normalizedPaths); ok {
			backend.invalidateReplayGainReleaseCacheKey(cacheKey)
		}
		a.invalidateTrackTagsCachePaths(normalizedPaths)

		return nil
	})
}
