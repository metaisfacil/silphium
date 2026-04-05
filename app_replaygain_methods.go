package main

// AudioGetReplayGainReleaseDynamicRange resolves the release dynamic range used to indicate album-scoped ReplayGain.
func (a *App) AudioGetReplayGainReleaseDynamicRange(replayGainReleasePaths []string) (int, error) {
	normalizedReplayGainReleasePaths, err := a.normalizeReplayGainContextPaths(replayGainReleasePaths, "")
	if err != nil {
		return 0, err
	}

	if len(normalizedReplayGainReleasePaths) <= 1 {
		return 0, nil
	}

	return a.audioBackend().ReplayGainReleaseDynamicRange(normalizedReplayGainReleasePaths)
}
