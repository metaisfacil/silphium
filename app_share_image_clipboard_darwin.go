//go:build darwin

package main

import "golang.design/x/clipboard"

func copyShareImageToClipboardPNGPlatform(imagePNG []byte) error {
	if err := clipboard.Init(); err != nil {
		return err
	}

	clipboard.Write(clipboard.FmtImage, imagePNG)
	return nil
}
