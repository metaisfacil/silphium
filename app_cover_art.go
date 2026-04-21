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

func (a *App) readTrackEmbeddedCoverBytes(path string) ([]byte, string, bool) {
	if !a.isAllowedLibraryPath(path) {
		return nil, "", false
	}

	imageBytes, err := readTaglibImage(path)
	if err != nil || len(imageBytes) == 0 {
		return nil, "", false
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

	return imageBytes, mimeType, true
}

func (a *App) readTrackEmbeddedCoverThumbnailBytes(path string, maxEdge int) ([]byte, string, bool) {
	imageBytes, mimeType, ok := a.readTrackEmbeddedCoverBytes(path)
	if !ok {
		return nil, "", false
	}

	if maxEdge <= 0 {
		return imageBytes, mimeType, true
	}

	thumbnailBytes, thumbnailMimeType, ok := imageThumbnailBytes(imageBytes, maxEdge)
	if !ok {
		return imageBytes, mimeType, true
	}

	return thumbnailBytes, thumbnailMimeType, true
}

// ReadTrackEmbeddedCover extracts embedded cover art from a library track.
func (a *App) ReadTrackEmbeddedCover(path string) EmbeddedCoverArt {
	return profiledValue(a, "ReadTrackEmbeddedCover", func() EmbeddedCoverArt {
		imageBytes, mimeType, ok := a.readTrackEmbeddedCoverBytes(path)
		if !ok {
			return EmbeddedCoverArt{}
		}

		return EmbeddedCoverArt{
			Base64:   base64.StdEncoding.EncodeToString(imageBytes),
			MimeType: mimeType,
		}
	})
}
