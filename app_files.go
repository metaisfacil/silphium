package main

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"os"
	"unicode/utf16"
	"unicode/utf8"
)

// ReadFileBase64 reads a file from the allowed library scope and returns its base64 content.
func (a *App) ReadFileBase64(path string) string {
	if !a.isAllowedLibraryPath(path) {
		return ""
	}

	rawBytes, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	return base64.StdEncoding.EncodeToString(rawBytes)
}

// ReadTextFile reads and decodes a text file from the allowed library scope.
func (a *App) ReadTextFile(path string) string {
	if !a.isAllowedLibraryPath(path) {
		return ""
	}

	rawBytes, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	return decodeTextFileBytes(rawBytes)
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
