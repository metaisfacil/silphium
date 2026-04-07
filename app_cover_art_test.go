package main

import (
	"encoding/base64"
	"errors"
	"path/filepath"
	"testing"

	taglib "go.senan.xyz/taglib"
)

func TestReadTrackEmbeddedCover(t *testing.T) {
	originalReadTaglibImage := readTaglibImage
	originalReadTaglibProperties := readTaglibProperties
	t.Cleanup(func() {
		readTaglibImage = originalReadTaglibImage
		readTaglibProperties = originalReadTaglibProperties
	})

	root := t.TempDir()
	trackPath := filepath.Join(root, "track.flac")
	writeTestFile(t, trackPath, "track")
	app := &App{activeLibraryRoots: []libraryRootConfig{{Path: normalizePath(root), Name: filepath.Base(root)}}}

	if cover := app.ReadTrackEmbeddedCover(filepath.Join(t.TempDir(), "outside.flac")); cover != (EmbeddedCoverArt{}) {
		t.Fatalf("ReadTrackEmbeddedCover(outside path) = %#v, want empty result", cover)
	}

	readTaglibImage = func(_ string) ([]byte, error) {
		return nil, errors.New("read failed")
	}
	if cover := app.ReadTrackEmbeddedCover(trackPath); cover != (EmbeddedCoverArt{}) {
		t.Fatalf("ReadTrackEmbeddedCover(read error) = %#v, want empty result", cover)
	}

	pngBytes := []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 0x00}
	readTaglibImage = func(_ string) ([]byte, error) {
		return pngBytes, nil
	}
	readTaglibProperties = func(_ string) (taglib.Properties, error) {
		return taglib.Properties{Images: []taglib.ImageDesc{{MIMEType: " image/png "}}}, nil
	}
	if cover := app.ReadTrackEmbeddedCover(trackPath); cover.MimeType != "image/png" || cover.Base64 != base64.StdEncoding.EncodeToString(pngBytes) {
		t.Fatalf("ReadTrackEmbeddedCover(explicit mime) = %#v, want encoded PNG cover", cover)
	}

	textBytes := []byte("plain text")
	readTaglibImage = func(_ string) ([]byte, error) {
		return textBytes, nil
	}
	readTaglibProperties = func(_ string) (taglib.Properties, error) {
		return taglib.Properties{Images: []taglib.ImageDesc{{MIMEType: "text/plain"}}}, nil
	}
	if cover := app.ReadTrackEmbeddedCover(trackPath); cover.MimeType != "image/jpeg" || cover.Base64 != base64.StdEncoding.EncodeToString(textBytes) {
		t.Fatalf("ReadTrackEmbeddedCover(fallback mime) = %#v, want JPEG fallback", cover)
	}

	readTaglibImage = func(_ string) ([]byte, error) {
		return nil, nil
	}
	if cover := app.ReadTrackEmbeddedCover(trackPath); cover != (EmbeddedCoverArt{}) {
		t.Fatalf("ReadTrackEmbeddedCover(empty image) = %#v, want empty result", cover)
	}
}
