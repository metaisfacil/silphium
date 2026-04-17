package main

// ValidateFFmpegPath reports whether the provided setting value resolves to a usable ffmpeg executable.
func (a *App) ValidateFFmpegPath(path string) FFmpegPathStatus {
	return profiledValue(a, "ValidateFFmpegPath", func() FFmpegPathStatus {
		return validateFFmpegPath(path)
	})
}
