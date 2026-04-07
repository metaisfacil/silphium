package main

import (
	"encoding/base64"
	"net/http"
	"strings"

	taglib "go.senan.xyz/taglib"
)

var readTaglibImage = taglib.ReadImage
var readTaglibProperties = taglib.ReadProperties

// EmbeddedCoverArt contains encoded album art extracted from audio metadata.
type EmbeddedCoverArt struct {
	Base64   string `json:"base64"`
	MimeType string `json:"mimeType"`
}

// ReadTrackEmbeddedCover extracts embedded cover art from a library track.
func (a *App) ReadTrackEmbeddedCover(path string) EmbeddedCoverArt {
	if !a.isAllowedLibraryPath(path) {
		return EmbeddedCoverArt{}
	}

	imageBytes, err := readTaglibImage(path)
	if err != nil {
		return EmbeddedCoverArt{}
	}
	if len(imageBytes) == 0 {
		return EmbeddedCoverArt{}
	}

	mimeType := ""
	if properties, err := readTaglibProperties(path); err == nil && len(properties.Images) > 0 {
		mimeType = strings.TrimSpace(properties.Images[0].MIMEType)
	}

	if mimeType == "" {
		mimeType = strings.TrimSpace(http.DetectContentType(imageBytes))
	}
	if !strings.HasPrefix(mimeType, "image/") {
		mimeType = ""
	}
	if mimeType == "" {
		mimeType = "image/jpeg"
	}

	return EmbeddedCoverArt{
		Base64:   base64.StdEncoding.EncodeToString(imageBytes),
		MimeType: mimeType,
	}
}
