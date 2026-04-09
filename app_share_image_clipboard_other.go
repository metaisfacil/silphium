//go:build !darwin

package main

import "errors"

func copyShareImageToClipboardPNGPlatform([]byte) error {
	return errors.New("share image clipboard copy is unavailable on this platform")
}
