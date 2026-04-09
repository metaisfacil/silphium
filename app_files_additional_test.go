package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func init() {
	image.RegisterFormat(
		"zerobounds",
		"ZBND",
		func(io.Reader) (image.Image, error) {
			return image.NewRGBA(image.Rect(0, 0, 0, 0)), nil
		},
		func(io.Reader) (image.Config, error) {
			return image.Config{}, nil
		},
	)
}

func writePNGFile(t *testing.T, path string, width int, height int) []byte {
	t.Helper()

	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x + 1), G: uint8(y + 1), B: 120, A: 255})
		}
	}

	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatalf("png.Encode() error = %v", err)
	}

	if err := os.WriteFile(path, encoded.Bytes(), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", path, err)
	}

	return encoded.Bytes()
}

func TestReadFileBase64AndSaveShareImageFile(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := &App{}
	app.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: "Library"}}

	if got := app.ReadFileBase64(fixture.outsideTrack); got != "" {
		t.Fatalf("ReadFileBase64(outside) = %q, want empty", got)
	}
	if got := app.ReadFileBase64(filepath.Join(fixture.rootOne, "missing.flac")); got != "" {
		t.Fatalf("ReadFileBase64(missing) = %q, want empty", got)
	}

	wantBytes, err := os.ReadFile(fixture.trackOne)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", fixture.trackOne, err)
	}
	if got := app.ReadFileBase64(fixture.trackOne); got != base64.StdEncoding.EncodeToString(wantBytes) {
		t.Fatalf("ReadFileBase64(%q) = %q, want %q", fixture.trackOne, got, base64.StdEncoding.EncodeToString(wantBytes))
	}

	outputPath := filepath.Join(fixture.tempDir, "share.png")
	if app.SaveShareImageFile("", "abc") {
		t.Fatal("SaveShareImageFile(empty path) = true, want false")
	}
	if app.SaveShareImageFile(outputPath, "") {
		t.Fatal("SaveShareImageFile(empty payload) = true, want false")
	}
	if app.SaveShareImageFile(outputPath, "%%notbase64%%") {
		t.Fatal("SaveShareImageFile(invalid payload) = true, want false")
	}

	payload := []byte("png payload")
	encodedPayload := "data:image/png;base64," + base64.StdEncoding.EncodeToString(payload)
	if !app.SaveShareImageFile(outputPath, encodedPayload) {
		t.Fatal("SaveShareImageFile(valid payload) = false, want true")
	}

	savedBytes, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", outputPath, err)
	}
	if !bytes.Equal(savedBytes, payload) {
		t.Fatalf("saved payload = %q, want %q", string(savedBytes), string(payload))
	}
}

func TestCopyShareImageToClipboard(t *testing.T) {
	app := &App{}
	originalCopyShareImageToClipboardPNG := copyShareImageToClipboardPNG
	t.Cleanup(func() {
		copyShareImageToClipboardPNG = originalCopyShareImageToClipboardPNG
	})

	var copiedPayload []byte
	copyShareImageToClipboardPNG = func(imagePNG []byte) error {
		copiedPayload = append([]byte(nil), imagePNG...)
		return nil
	}

	if app.CopyShareImageToClipboard("") {
		t.Fatal("CopyShareImageToClipboard(empty payload) = true, want false")
	}
	if app.CopyShareImageToClipboard("%%notbase64%%") {
		t.Fatal("CopyShareImageToClipboard(invalid payload) = true, want false")
	}

	payload := []byte("png payload")
	encodedPayload := "data:image/png;base64," + base64.StdEncoding.EncodeToString(payload)
	if !app.CopyShareImageToClipboard(encodedPayload) {
		t.Fatal("CopyShareImageToClipboard(valid payload) = false, want true")
	}
	if !bytes.Equal(copiedPayload, payload) {
		t.Fatalf("clipboard payload = %q, want %q", string(copiedPayload), string(payload))
	}

	copyShareImageToClipboardPNG = func([]byte) error {
		return errors.New("clipboard unavailable")
	}
	if app.CopyShareImageToClipboard(encodedPayload) {
		t.Fatal("CopyShareImageToClipboard(copy failure) = true, want false")
	}
}

func TestReadImageThumbnailAndResize(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := &App{}
	app.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: "Library"}}

	smallImagePath := filepath.Join(fixture.albumOneFolder, "small.png")
	smallImageBytes := writePNGFile(t, smallImagePath, 4, 4)
	largeImagePath := filepath.Join(fixture.albumOneFolder, "large.png")
	largeImageBytes := writePNGFile(t, largeImagePath, 300, 120)
	invalidImagePath := filepath.Join(fixture.albumOneFolder, "broken.bin")
	writeTestFile(t, invalidImagePath, "not-an-image")
	zeroBoundsPath := filepath.Join(fixture.albumOneFolder, "zero.img")
	if err := os.WriteFile(zeroBoundsPath, []byte("ZBNDpayload"), 0o644); err != nil {
		t.Fatalf("WriteFile(%q) error = %v", zeroBoundsPath, err)
	}

	if got := app.ReadImageThumbnail(fixture.outsideTrack, 10); got != (EmbeddedCoverArt{}) {
		t.Fatalf("ReadImageThumbnail(outside) = %#v, want empty", got)
	}
	if got := app.ReadImageThumbnail(filepath.Join(fixture.albumOneFolder, "missing.png"), 10); got != (EmbeddedCoverArt{}) {
		t.Fatalf("ReadImageThumbnail(missing) = %#v, want empty", got)
	}
	if got := app.ReadImageThumbnail(invalidImagePath, 10); got != (EmbeddedCoverArt{}) {
		t.Fatalf("ReadImageThumbnail(invalid) = %#v, want empty", got)
	}
	if got := app.ReadImageThumbnail(zeroBoundsPath, 10); got != (EmbeddedCoverArt{}) {
		t.Fatalf("ReadImageThumbnail(zero bounds) = %#v, want empty", got)
	}

	inlineThumbnail := app.ReadImageThumbnail(smallImagePath, 10)
	if inlineThumbnail.MimeType != "image/png" {
		t.Fatalf("ReadImageThumbnail(small).MimeType = %q, want %q", inlineThumbnail.MimeType, "image/png")
	}
	if inlineThumbnail.Base64 != base64.StdEncoding.EncodeToString(smallImageBytes) {
		t.Fatal("ReadImageThumbnail(small) should return the original PNG bytes")
	}

	resizedThumbnail := app.ReadImageThumbnail(largeImagePath, 0)
	decodedThumbnail, err := base64.StdEncoding.DecodeString(resizedThumbnail.Base64)
	if err != nil {
		t.Fatalf("DecodeString(thumbnail) error = %v", err)
	}
	decodedImage, _, err := image.Decode(bytes.NewReader(decodedThumbnail))
	if err != nil {
		t.Fatalf("image.Decode(thumbnail) error = %v", err)
	}
	if resizedThumbnail.MimeType != "image/png" {
		t.Fatalf("ReadImageThumbnail(large).MimeType = %q, want %q", resizedThumbnail.MimeType, "image/png")
	}
	if decodedImage.Bounds().Dx() > defaultImageThumbnailMaxEdge || decodedImage.Bounds().Dy() > defaultImageThumbnailMaxEdge {
		t.Fatalf("ReadImageThumbnail(large) bounds = %v, want max edge <= %d", decodedImage.Bounds(), defaultImageThumbnailMaxEdge)
	}

	clampedThumbnail := app.ReadImageThumbnail(largeImagePath, maxImageThumbnailMaxEdge+100)
	if clampedThumbnail.Base64 != base64.StdEncoding.EncodeToString(largeImageBytes) {
		t.Fatal("ReadImageThumbnail(clamped max edge) should still return the original PNG bytes when the source is already within the capped limit")
	}

	zeroSized := resizeImageNearest(image.NewRGBA(image.Rect(0, 0, 0, 0)), 10)
	if got, want := zeroSized.Bounds().Dx(), 1; got != want {
		t.Fatalf("resizeImageNearest(zero).Dx = %d, want %d", got, want)
	}
	if got, want := zeroSized.Bounds().Dy(), 1; got != want {
		t.Fatalf("resizeImageNearest(zero).Dy = %d, want %d", got, want)
	}

	clone := resizeImageNearest(image.NewRGBA(image.Rect(0, 0, 4, 4)), 10)
	if got, want := clone.Bounds().Dx(), 4; got != want {
		t.Fatalf("resizeImageNearest(clone).Dx = %d, want %d", got, want)
	}

	wide := resizeImageNearest(image.NewRGBA(image.Rect(0, 0, 200, 100)), 50)
	if got, want := wide.Bounds().Dx(), 50; got != want {
		t.Fatalf("resizeImageNearest(wide).Dx = %d, want %d", got, want)
	}
	if got, want := wide.Bounds().Dy(), 25; got != want {
		t.Fatalf("resizeImageNearest(wide).Dy = %d, want %d", got, want)
	}

	tall := resizeImageNearest(image.NewRGBA(image.Rect(0, 0, 100, 200)), 50)
	if got, want := tall.Bounds().Dx(), 25; got != want {
		t.Fatalf("resizeImageNearest(tall).Dx = %d, want %d", got, want)
	}
	if got, want := tall.Bounds().Dy(), 50; got != want {
		t.Fatalf("resizeImageNearest(tall).Dy = %d, want %d", got, want)
	}
}

func TestTextDecodingHelpers(t *testing.T) {
	fixture := createLibraryTestFixture(t)
	app := &App{}
	app.activeLibraryRoots = []libraryRootConfig{{Path: fixture.rootOne, Name: "Library"}}

	textPath := filepath.Join(fixture.albumOneFolder, "utf8.txt")
	writeTestFile(t, textPath, "plain text")
	if got := app.ReadTextFile(textPath); got != "plain text" {
		t.Fatalf("ReadTextFile(%q) = %q, want %q", textPath, got, "plain text")
	}
	if got := app.ReadTextFile(fixture.outsideTrack); got != "" {
		t.Fatalf("ReadTextFile(outside) = %q, want empty", got)
	}
	if got := app.ReadTextFile(filepath.Join(fixture.albumOneFolder, "missing.txt")); got != "" {
		t.Fatalf("ReadTextFile(missing) = %q, want empty", got)
	}

	if got := decodeTextFileBytes(nil); got != "" {
		t.Fatalf("decodeTextFileBytes(nil) = %q, want empty", got)
	}
	if got := decodeTextFileBytes(append([]byte{0xEF, 0xBB, 0xBF}, []byte("utf8 bom")...)); got != "utf8 bom" {
		t.Fatalf("decodeTextFileBytes(utf8 bom) = %q, want %q", got, "utf8 bom")
	}
	if got := decodeTextFileBytes([]byte{0xFF, 0xFE, 'H', 0x00, 'i', 0x00}); got != "Hi" {
		t.Fatalf("decodeTextFileBytes(utf16le) = %q, want %q", got, "Hi")
	}
	if got := decodeTextFileBytes([]byte{0xFE, 0xFF, 0x00, 'H', 0x00, 'i'}); got != "Hi" {
		t.Fatalf("decodeTextFileBytes(utf16be) = %q, want %q", got, "Hi")
	}
	if got := decodeTextFileBytes([]byte("valid utf8")); got != "valid utf8" {
		t.Fatalf("decodeTextFileBytes(valid utf8) = %q, want %q", got, "valid utf8")
	}
	if got := decodeTextFileBytes([]byte{0xFF, 0x00, 0xFE, 0x00}); got != "ÿþ" {
		t.Fatalf("decodeTextFileBytes(heuristic le) = %q, want %q", got, "ÿþ")
	}
	if got := decodeTextFileBytes([]byte{0x00, 0xFF, 0x00, 0xFE}); got != "ÿþ" {
		t.Fatalf("decodeTextFileBytes(heuristic be) = %q, want %q", got, "ÿþ")
	}
	if got := decodeTextFileBytes([]byte{0xFF, 0xFD, 0xFF}); got != string([]byte{0xFF, 0xFD, 0xFF}) {
		t.Fatalf("decodeTextFileBytes(fallback) = %q, want raw string", got)
	}

	if got := decodeUTF16Bytes(nil, binary.LittleEndian); got != "" {
		t.Fatalf("decodeUTF16Bytes(nil) = %q, want empty", got)
	}
	if got := decodeUTF16Bytes([]byte{0xFF, 0xFE, 'A', 0x00}, binary.LittleEndian); got != "A" {
		t.Fatalf("decodeUTF16Bytes(bom) = %q, want %q", got, "A")
	}
	if got := decodeUTF16Bytes([]byte{'B', 0x00, 0x00}, binary.LittleEndian); got != "B" {
		t.Fatalf("decodeUTF16Bytes(odd length) = %q, want %q", got, "B")
	}
	if got := decodeUTF16Bytes([]byte{0x00}, binary.LittleEndian); got != "" {
		t.Fatalf("decodeUTF16Bytes(trimmed empty) = %q, want empty", got)
	}

	evenZeroRatio, oddZeroRatio := utf16ZeroRatios([]byte{'A', 0x00, 'B', 0x00})
	if evenZeroRatio != 0 || oddZeroRatio != 1 {
		t.Fatalf("utf16ZeroRatios() = (%.2f, %.2f), want (0.00, 1.00)", evenZeroRatio, oddZeroRatio)
	}
	if evenZeroRatio, oddZeroRatio := utf16ZeroRatios([]byte{0x41}); evenZeroRatio != 0 || oddZeroRatio != 0 {
		t.Fatalf("utf16ZeroRatios(short) = (%.2f, %.2f), want (0.00, 0.00)", evenZeroRatio, oddZeroRatio)
	}
}
