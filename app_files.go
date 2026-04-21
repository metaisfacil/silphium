package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"image"
	"image/png"
	"net/http"
	"os"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"

	_ "golang.org/x/image/bmp"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const defaultImageThumbnailMaxEdge = 96
const maxImageThumbnailMaxEdge = 800

func (a *App) readLibraryFileBytes(path string) ([]byte, bool) {
	if !a.isAllowedLibraryPath(path) {
		return nil, false
	}

	rawBytes, err := os.ReadFile(path)
	if err != nil || len(rawBytes) == 0 {
		return nil, false
	}

	return rawBytes, true
}

// ReadFileBase64 reads a file from the allowed library scope and returns its base64 content.
func (a *App) ReadFileBase64(path string) string {
	return profiledValue(a, "ReadFileBase64", func() string {
		if !a.isAllowedLibraryPath(path) {
			return ""
		}

		rawBytes, err := os.ReadFile(path)
		if err != nil {
			return ""
		}

		return base64.StdEncoding.EncodeToString(rawBytes)
	})
}

func decodeShareImagePayload(imageBase64 string) ([]byte, bool) {
	payload := strings.TrimSpace(imageBase64)
	if payload == "" {
		return nil, false
	}

	if commaIndex := strings.Index(payload, ","); commaIndex >= 0 && strings.Contains(payload[:commaIndex], ";base64") {
		payload = payload[commaIndex+1:]
	}

	decoded, err := base64.StdEncoding.DecodeString(payload)
	if err != nil || len(decoded) == 0 {
		return nil, false
	}

	return decoded, true
}

// SaveShareImageFile decodes a base64 PNG payload and writes it to the requested path.
func (a *App) SaveShareImageFile(path string, imageBase64 string) bool {
	return profiledValue(a, "SaveShareImageFile", func() bool {
		cleanPath := strings.TrimSpace(path)
		if cleanPath == "" {
			return false
		}

		decoded, ok := decodeShareImagePayload(imageBase64)
		if !ok {
			return false
		}

		return os.WriteFile(cleanPath, decoded, 0o644) == nil
	})
}

// CopyShareImageToClipboard decodes a base64 PNG payload and writes it to the operating system clipboard.
func (a *App) CopyShareImageToClipboard(imageBase64 string) bool {
	return profiledValue(a, "CopyShareImageToClipboard", func() bool {
		decoded, ok := decodeShareImagePayload(imageBase64)
		if !ok {
			return false
		}

		return copyShareImageToClipboardPNG(decoded) == nil
	})
}

// ReadImageThumbnail reads an image from the allowed library scope and returns a cheap thumbnail.
func (a *App) ReadImageThumbnail(path string, maxEdge int) EmbeddedCoverArt {
	return profiledValue(a, "ReadImageThumbnail", func() EmbeddedCoverArt {
		rawBytes, ok := a.readLibraryFileBytes(path)
		if !ok {
			return EmbeddedCoverArt{}
		}

		if maxEdge <= 0 {
			maxEdge = defaultImageThumbnailMaxEdge
		}
		if maxEdge > maxImageThumbnailMaxEdge {
			maxEdge = maxImageThumbnailMaxEdge
		}

		mimeType := strings.TrimSpace(http.DetectContentType(rawBytes))
		config, _, err := image.DecodeConfig(bytes.NewReader(rawBytes))
		if err != nil {
			return EmbeddedCoverArt{}
		}
		if config.Width <= 0 || config.Height <= 0 {
			return EmbeddedCoverArt{}
		}
		if config.Width <= maxEdge && config.Height <= maxEdge && strings.HasPrefix(mimeType, "image/") {
			return EmbeddedCoverArt{
				Base64:   base64.StdEncoding.EncodeToString(rawBytes),
				MimeType: mimeType,
			}
		}

		decoded, _, err := image.Decode(bytes.NewReader(rawBytes))
		if err != nil {
			return EmbeddedCoverArt{}
		}

		bounds := decoded.Bounds()
		if bounds.Dx() <= 0 || bounds.Dy() <= 0 {
			return EmbeddedCoverArt{}
		}

		thumbnail := resizeImageThumbnail(decoded, maxEdge)
		var encoded bytes.Buffer
		encoder := png.Encoder{CompressionLevel: png.BestSpeed}
		if err := encoder.Encode(&encoded, thumbnail); err != nil {
			return EmbeddedCoverArt{}
		}

		return EmbeddedCoverArt{
			Base64:   base64.StdEncoding.EncodeToString(encoded.Bytes()),
			MimeType: "image/png",
		}
	})
}

func resizeImageThumbnail(source image.Image, maxEdge int) *image.RGBA {
	bounds := source.Bounds()
	sourceWidth := bounds.Dx()
	sourceHeight := bounds.Dy()
	if sourceWidth <= 0 || sourceHeight <= 0 {
		return image.NewRGBA(image.Rect(0, 0, 1, 1))
	}

	targetWidth := sourceWidth
	targetHeight := sourceHeight
	if sourceWidth >= sourceHeight && sourceWidth > maxEdge {
		targetWidth = maxEdge
		targetHeight = max(1, (sourceHeight*maxEdge+sourceWidth/2)/sourceWidth)
	} else if sourceHeight > sourceWidth && sourceHeight > maxEdge {
		targetHeight = maxEdge
		targetWidth = max(1, (sourceWidth*maxEdge+sourceHeight/2)/sourceHeight)
	}

	resized := image.NewRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	xdraw.ApproxBiLinear.Scale(resized, resized.Bounds(), source, bounds, xdraw.Src, nil)

	return resized
}

// ReadTextFile reads and decodes a text file from the allowed library scope.
func (a *App) ReadTextFile(path string) string {
	return profiledValue(a, "ReadTextFile", func() string {
		if !a.isAllowedLibraryPath(path) {
			return ""
		}

		rawBytes, err := os.ReadFile(path)
		if err != nil {
			return ""
		}

		return decodeTextFileBytes(rawBytes)
	})
}

func decodeTextFileBytes(rawBytes []byte) string {
	if len(rawBytes) == 0 {
		return ""
	}

	if bytes.HasPrefix(rawBytes, []byte{0xEF, 0xBB, 0xBF}) {
		return string(rawBytes[3:])
	}

	if bytes.HasPrefix(rawBytes, []byte{0xFF, 0xFE}) {
		return decodeUTF16Bytes(rawBytes[2:], binary.LittleEndian)
	}

	if bytes.HasPrefix(rawBytes, []byte{0xFE, 0xFF}) {
		return decodeUTF16Bytes(rawBytes[2:], binary.BigEndian)
	}

	if utf8.Valid(rawBytes) {
		return string(rawBytes)
	}

	evenZeroRatio, oddZeroRatio := utf16ZeroRatios(rawBytes)
	if oddZeroRatio > 0.6 && evenZeroRatio < 0.2 {
		return decodeUTF16Bytes(rawBytes, binary.LittleEndian)
	}

	if evenZeroRatio > 0.6 && oddZeroRatio < 0.2 {
		return decodeUTF16Bytes(rawBytes, binary.BigEndian)
	}

	return string(rawBytes)
}

func decodeUTF16Bytes(rawBytes []byte, order binary.ByteOrder) string {
	if len(rawBytes) == 0 {
		return ""
	}

	if len(rawBytes)%2 != 0 {
		rawBytes = rawBytes[:len(rawBytes)-1]
	}

	if len(rawBytes) == 0 {
		return ""
	}

	units := make([]uint16, 0, len(rawBytes)/2)
	for index := 0; index+1 < len(rawBytes); index += 2 {
		units = append(units, order.Uint16(rawBytes[index:index+2]))
	}

	decoded := utf16.Decode(units)
	if len(decoded) > 0 && decoded[0] == '\ufeff' {
		decoded = decoded[1:]
	}

	return string(decoded)
}

func utf16ZeroRatios(rawBytes []byte) (float64, float64) {
	if len(rawBytes) < 2 {
		return 0, 0
	}

	evenTotal := 0
	evenZeros := 0
	oddTotal := 0
	oddZeros := 0

	for index, value := range rawBytes {
		if index%2 == 0 {
			evenTotal++
			if value == 0 {
				evenZeros++
			}
			continue
		}

		oddTotal++
		if value == 0 {
			oddZeros++
		}
	}

	if evenTotal == 0 || oddTotal == 0 {
		return 0, 0
	}

	return float64(evenZeros) / float64(evenTotal), float64(oddZeros) / float64(oddTotal)
}
