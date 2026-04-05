package main

// ValidateFFmpegPath reports whether the provided setting value resolves to a usable ffmpeg executable.
func (a *App) ValidateFFmpegPath(path string) FFmpegPathStatus {
	return validateFFmpegPath(path)
}
