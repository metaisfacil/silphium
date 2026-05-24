package main

import (
	"strings"
	"time"
)

const (
	mediaPlaybackStatusClosed  = 0
	mediaPlaybackStatusStopped = 2
	mediaPlaybackStatusPlaying = 3
	mediaPlaybackStatusPaused  = 4
)

type timeSpan struct {
	Duration int64
}

func playbackStatusForSnapshot(snapshot systemMediaTransportControlsSnapshot) uintptr {
	if !snapshot.Loaded || snapshot.SourcePath == "" {
		return systemMediaTransportControlsResetPlaybackStatus()
	}
	if snapshot.Playing {
		return mediaPlaybackStatusPlaying
	}
	return mediaPlaybackStatusPaused
}

func systemMediaTransportControlsResetPlaybackStatus() uintptr {
	return mediaPlaybackStatusClosed
}

func secondsToTimeSpan(seconds float64) timeSpan {
	if seconds <= 0 {
		return timeSpan{}
	}
	return timeSpan{Duration: int64(seconds * float64(time.Second/100))}
}

func timeSpanToSeconds(value timeSpan) float64 {
	return float64(value.Duration) / float64(time.Second/100)
}

func timeSpanSyscallArg(value timeSpan) uintptr {
	return uintptr(value.Duration)
}

func systemMediaTransportControlsWindowTitleScore(title string) int {
	trimmedTitle := strings.TrimSpace(title)
	if trimmedTitle == "" {
		return -1
	}
	if trimmedTitle == "Silphium" {
		return 2
	}
	if strings.EqualFold(trimmedTitle, "Silphium") {
		return 1
	}

	return 0
}
