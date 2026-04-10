package main

import (
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"testing"
)

func TestReplayGainHelpersAndCaches(t *testing.T) {
	helperDir := t.TempDir()
	ffmpegPath := copyCurrentTestBinary(t, helperDir, "ffmpeg.exe")
	trackOne := filepath.Join(helperDir, "01 One.flac")
	trackTwo := filepath.Join(helperDir, "02 Two.flac")
	writeTestFile(t, trackOne, "track one")
	writeTestFile(t, trackTwo, "track two")

	if _, err := calculateReplayGainWithFFmpeg("", ffmpegPath); err == nil {
		t.Fatal("calculateReplayGainWithFFmpeg(empty path) error = nil, want error")
	}
	if _, err := calculateReplayGainWithFFmpeg(trackOne, ""); err == nil {
		t.Fatal("calculateReplayGainWithFFmpeg(empty ffmpeg) error = nil, want error")
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "[Parsed_replaygain_0 @ 0] track_gain = -3.00 dB\n[Parsed_replaygain_0 @ 0] track_peak = 0.5")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	info, err := calculateReplayGainWithFFmpeg(trackOne, ffmpegPath)
	if err != nil {
		t.Fatalf("calculateReplayGainWithFFmpeg(success) error = %v", err)
	}
	if info.Source != string(replayGainSourceCalculated) || info.GainDB != -3 || info.Peak != 0.5 {
		t.Fatalf("calculateReplayGainWithFFmpeg(success) = %#v, want parsed replaygain info", info)
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "scan failed")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "1")
	if _, err := calculateReplayGainWithFFmpeg(trackOne, ffmpegPath); err == nil || !strings.Contains(err.Error(), "scan failed") {
		t.Fatalf("calculateReplayGainWithFFmpeg(error) = %v, want stderr error", err)
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "no gain data")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	if _, err := calculateReplayGainWithFFmpeg(trackOne, ffmpegPath); err == nil || !strings.Contains(err.Error(), "no gain data") {
		t.Fatalf("calculateReplayGainWithFFmpeg(no data) = %v, want no-data error", err)
	}

	if got := normalizeReplayGainReleasePaths([]string{"", "  ", trackOne, strings.ToUpper(trackOne), trackTwo}); len(got) != 2 {
		t.Fatalf("normalizeReplayGainReleasePaths() = %#v, want two unique paths", got)
	}
	if got := normalizeReplayGainReleasePaths([]string{"", "  "}); got != nil {
		t.Fatalf("normalizeReplayGainReleasePaths(empty) = %#v, want nil", got)
	}

	if _, ok := buildReplayGainReleaseCacheKey([]string{trackOne}); ok {
		t.Fatal("buildReplayGainReleaseCacheKey(single) = true, want false")
	}
	cacheKey, ok := buildReplayGainReleaseCacheKey([]string{trackOne, trackTwo, trackOne})
	if !ok || cacheKey == "" {
		t.Fatalf("buildReplayGainReleaseCacheKey() = (%q, %t), want non-empty key", cacheKey, ok)
	}
	if got := escapeFFConcatPath(`C:\Music\O'Brien.flac`); got != `C:\\Music\\O\'Brien.flac` {
		t.Fatalf("escapeFFConcatPath() = %q, want escaped ffconcat path", got)
	}

	albumInfo, ok := parseAlbumReplayGainAnalysisOutput("[Parsed_replaygain_0 @ 0] track_gain = -4.50 dB\n[Parsed_replaygain_0 @ 0] track_peak = 0.75")
	if !ok || albumInfo.Source != string(replayGainSourceAlbumCalc) {
		t.Fatalf("parseAlbumReplayGainAnalysisOutput() = (%#v, %t), want album-calculated info", albumInfo, ok)
	}
	if got, ok := parseReplayGainDynamicRangeOutput("LRA: 10.7 LU"); !ok || got != 11 {
		t.Fatalf("parseReplayGainDynamicRangeOutput() = (%d, %t), want (11, true)", got, ok)
	}
	if _, ok := parseReplayGainDynamicRangeOutput("LRA: 0 LU"); ok {
		t.Fatal("parseReplayGainDynamicRangeOutput(zero) = true, want false")
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "[Parsed_replaygain_0 @ 0] track_gain = -4.50 dB\n[Parsed_replaygain_0 @ 0] track_peak = 0.75")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	albumReplayGain, err := calculateAlbumReplayGainWithFFmpeg([]string{trackOne, trackTwo}, ffmpegPath)
	if err != nil || albumReplayGain.Source != string(replayGainSourceAlbumCalc) {
		t.Fatalf("calculateAlbumReplayGainWithFFmpeg() = (%#v, %v), want album-calculated info", albumReplayGain, err)
	}
	if _, err := calculateAlbumReplayGainWithFFmpeg([]string{trackOne}, ffmpegPath); err == nil {
		t.Fatal("calculateAlbumReplayGainWithFFmpeg(single track) error = nil, want error")
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "LRA: 10.7 LU")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	dynamicRange, err := calculateReleaseDynamicRangeWithFFmpeg([]string{trackOne, trackTwo}, ffmpegPath)
	if err != nil || dynamicRange != 11 {
		t.Fatalf("calculateReleaseDynamicRangeWithFFmpeg() = (%d, %v), want (11, nil)", dynamicRange, err)
	}
	if _, err := calculateReleaseDynamicRangeWithFFmpeg([]string{trackOne}, ffmpegPath); err == nil {
		t.Fatal("calculateReleaseDynamicRangeWithFFmpeg(single track) error = nil, want error")
	}

	backend := NewAudioBackend()
	backend.ffmpegPath = ffmpegPath
	signature, ok := trackTagsFileSignatureForPath(trackOne)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", trackOne)
	}
	backend.putReplayGainCache(trackOne, signature, ReplayGainInfo{GainDB: -2, Peak: 0.8}, true)
	if cachedInfo, hasValue, cacheHit := backend.getReplayGainCache(trackOne, signature); !cacheHit || !hasValue || cachedInfo.GainDB != -2 {
		t.Fatalf("getReplayGainCache() = (%#v, %t, %t), want cached replaygain info", cachedInfo, hasValue, cacheHit)
	}
	if _, _, cacheHit := backend.getReplayGainCache(trackOne, trackTagsFileSignature{Size: signature.Size + 1}); cacheHit {
		t.Fatal("getReplayGainCache(signature mismatch) = true, want false")
	}

	backend.putReplayGainReleaseCache(cacheKey, ReplayGainInfo{GainDB: -4, Peak: 0.7}, true)
	if cachedInfo, hasValue, cacheHit := backend.getReplayGainReleaseCache(cacheKey); !cacheHit || !hasValue || cachedInfo.GainDB != -4 {
		t.Fatalf("getReplayGainReleaseCache() = (%#v, %t, %t), want cached album replaygain info", cachedInfo, hasValue, cacheHit)
	}
	backend.putReplayGainReleaseDynamicRangeCache(cacheKey, 12, true)
	if cachedRange, hasValue, cacheHit := backend.getReplayGainReleaseDynamicRangeCache(cacheKey); !cacheHit || !hasValue || cachedRange != 12 {
		t.Fatalf("getReplayGainReleaseDynamicRangeCache() = (%d, %t, %t), want cached range", cachedRange, hasValue, cacheHit)
	}

	backendWithTags := NewAudioBackend()
	backendWithTags.ffmpegPath = ffmpegPath
	albumTagInfo, ok := backendWithTags.resolveAlbumReplayGainInfo(map[string][]string{"REPLAYGAIN_ALBUM_GAIN": {"-5 dB"}, "REPLAYGAIN_ALBUM_PEAK": {"0.9"}}, []string{trackOne, trackTwo})
	if !ok || albumTagInfo.Source != string(replayGainSourceAlbumTag) {
		t.Fatalf("resolveAlbumReplayGainInfo(tags) = (%#v, %t), want album tag info", albumTagInfo, ok)
	}

	backendWithDynamicRange := NewAudioBackend()
	backendWithDynamicRange.ffmpegPath = ffmpegPath
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "LRA: 9.6 LU")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	if resolvedRange, ok := backendWithDynamicRange.resolveReplayGainReleaseDynamicRange([]string{trackOne, trackTwo}); !ok || resolvedRange != 10 {
		t.Fatalf("resolveReplayGainReleaseDynamicRange() = (%d, %t), want (10, true)", resolvedRange, ok)
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "[Parsed_replaygain_0 @ 0] track_gain = -6.00 dB\n[Parsed_replaygain_0 @ 0] track_peak = 0.80")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	if resolvedInfo := backend.resolveReplayGainInfo(trackOne, map[string][]string{"REPLAYGAIN_TRACK_GAIN": {"-7 dB"}}, nil); resolvedInfo.Source != string(replayGainSourceTrackTag) {
		t.Fatalf("resolveReplayGainInfo(tags) = %#v, want track-tag info", resolvedInfo)
	}
	if resolvedInfo := backend.resolveReplayGainInfo(trackTwo, nil, nil); resolvedInfo.Source != string(replayGainSourceCalculated) {
		t.Fatalf("resolveReplayGainInfo(ffmpeg) = %#v, want calculated info", resolvedInfo)
	}
	if resolvedInfo := backend.resolveReplayGainInfo(trackTwo, nil, nil); resolvedInfo.Source != string(replayGainSourceCalculated) {
		t.Fatalf("resolveReplayGainInfo(cache hit) = %#v, want cached calculated info", resolvedInfo)
	}
}

func TestResolveReplayGainReleaseDynamicRangeEdgeCases(t *testing.T) {
	helperDir := t.TempDir()
	ffmpegPath := copyCurrentTestBinary(t, helperDir, "ffmpeg.exe")
	trackOne := filepath.Join(helperDir, "01 One.flac")
	trackTwo := filepath.Join(helperDir, "02 Two.flac")
	writeTestFile(t, trackOne, "track one")
	writeTestFile(t, trackTwo, "track two")

	backend := NewAudioBackend()
	backend.ffmpegPath = ffmpegPath
	if dynamicRange, ok := backend.resolveReplayGainReleaseDynamicRange([]string{trackOne}); ok || dynamicRange != 0 {
		t.Fatalf("resolveReplayGainReleaseDynamicRange(single) = (%d, %t), want (0, false)", dynamicRange, ok)
	}

	cacheKey, ok := buildReplayGainReleaseCacheKey([]string{trackOne, trackTwo})
	if !ok {
		t.Fatal("buildReplayGainReleaseCacheKey(two tracks) = false, want true")
	}
	backend.putReplayGainReleaseDynamicRangeCache(cacheKey, 0, false)
	if dynamicRange, ok := backend.resolveReplayGainReleaseDynamicRange([]string{trackTwo, trackOne}); ok || dynamicRange != 0 {
		t.Fatalf("resolveReplayGainReleaseDynamicRange(cached miss) = (%d, %t), want (0, false)", dynamicRange, ok)
	}

	failingBackend := NewAudioBackend()
	failingBackend.ffmpegPath = ffmpegPath
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "range scan failed")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "1")
	if dynamicRange, ok := failingBackend.resolveReplayGainReleaseDynamicRange([]string{trackOne, trackTwo}); ok || dynamicRange != 0 {
		t.Fatalf("resolveReplayGainReleaseDynamicRange(error) = (%d, %t), want (0, false)", dynamicRange, ok)
	}
	if _, hasValue, cacheHit := failingBackend.getReplayGainReleaseDynamicRangeCache(cacheKey); !cacheHit || hasValue {
		t.Fatalf("getReplayGainReleaseDynamicRangeCache(error miss) = (%t, %t), want (false, true)", hasValue, cacheHit)
	}
}

func TestReplayGainParsingAndCacheEviction(t *testing.T) {
	if gain, ok := parseReplayGainDBValue(" +3.50 dB "); !ok || gain != 3.5 {
		t.Fatalf("parseReplayGainDBValue(valid) = (%f, %t), want (3.5, true)", gain, ok)
	}
	if _, ok := parseReplayGainDBValue("not a gain"); ok {
		t.Fatal("parseReplayGainDBValue(invalid) = true, want false")
	}
	if peak, ok := parseReplayGainPeakValue("0.875"); !ok || peak != 0.875 {
		t.Fatalf("parseReplayGainPeakValue(valid) = (%f, %t), want (0.875, true)", peak, ok)
	}
	if _, ok := parseReplayGainPeakValue("0"); ok {
		t.Fatal("parseReplayGainPeakValue(zero) = true, want false")
	}

	sanitized := sanitizeReplayGainInfo(ReplayGainInfo{GainDB: math.NaN(), Peak: -1, Source: " calculated "})
	if sanitized.GainDB != 0 || sanitized.Peak != 0 || sanitized.Source != "calculated" {
		t.Fatalf("sanitizeReplayGainInfo() = %#v, want zeroed numeric values and trimmed source", sanitized)
	}
	if got := (ReplayGainInfo{GainDB: 6, Peak: 0.8}).Scale(); math.Abs(got-1.25) > 0.000001 {
		t.Fatalf("ReplayGainInfo.Scale() = %f, want 1.25", got)
	}

	trackCacheBackend := NewAudioBackend()
	for index := 0; index <= replayGainCacheLimit; index++ {
		path := fmt.Sprintf("track-%d.flac", index)
		trackCacheBackend.putReplayGainCache(path, trackTagsFileSignature{Size: int64(index), ModUnixNs: int64(index)}, ReplayGainInfo{GainDB: float64(index)}, true)
	}
	if got, want := len(trackCacheBackend.replayGainCacheByPath), replayGainCacheLimit; got != want {
		t.Fatalf("replay gain track cache len = %d, want %d", got, want)
	}
	if _, exists := trackCacheBackend.replayGainCacheByPath["track-0.flac"]; exists {
		t.Fatal("expected oldest replay gain track cache entry to be evicted")
	}

	releaseCacheBackend := NewAudioBackend()
	for index := 0; index <= replayGainCacheLimit; index++ {
		key := fmt.Sprintf("release-%d", index)
		releaseCacheBackend.putReplayGainReleaseCache(key, ReplayGainInfo{GainDB: float64(index)}, index%2 == 0)
	}
	if got, want := len(releaseCacheBackend.replayGainReleaseCacheByKey), replayGainCacheLimit; got != want {
		t.Fatalf("replay gain release cache len = %d, want %d", got, want)
	}
	if _, exists := releaseCacheBackend.replayGainReleaseCacheByKey["release-0"]; exists {
		t.Fatal("expected oldest replay gain release cache entry to be evicted")
	}

	dynamicRangeBackend := NewAudioBackend()
	for index := 0; index <= replayGainCacheLimit; index++ {
		key := fmt.Sprintf("range-%d", index)
		dynamicRangeBackend.putReplayGainReleaseDynamicRangeCache(key, index, index%2 == 0)
	}
	if got, want := len(dynamicRangeBackend.replayGainReleaseCacheByKey), replayGainCacheLimit; got != want {
		t.Fatalf("replay gain dynamic range cache len = %d, want %d", got, want)
	}
	if _, exists := dynamicRangeBackend.replayGainReleaseCacheByKey["range-0"]; exists {
		t.Fatal("expected oldest replay gain dynamic range cache entry to be evicted")
	}
}

func TestReplayGainHelperFallbackAndFFmpegEmptyOutputBranches(t *testing.T) {
	helperDir := t.TempDir()
	ffmpegPath := copyCurrentTestBinary(t, helperDir, "ffmpeg.exe")
	trackOne := filepath.Join(helperDir, "01 One.flac")
	trackTwo := filepath.Join(helperDir, "02 Two.flac")
	writeTestFile(t, trackOne, "track one")
	writeTestFile(t, trackTwo, "track two")

	if info, ok := extractTrackReplayGainFromTags(map[string][]string{"REPLAYGAIN_TRACK_GAIN": {"bad"}}); ok || info != (ReplayGainInfo{}) {
		t.Fatalf("extractTrackReplayGainFromTags(invalid) = (%#v, %t), want empty false", info, ok)
	}
	if info, ok := extractAlbumReplayGainFromTags(map[string][]string{"REPLAYGAIN_ALBUM_GAIN": {"bad"}}); ok || info != (ReplayGainInfo{}) {
		t.Fatalf("extractAlbumReplayGainFromTags(invalid) = (%#v, %t), want empty false", info, ok)
	}
	if info, ok := extractReplayGainFromTags(map[string][]string{"OTHER": {"value"}}); ok || info != (ReplayGainInfo{}) {
		t.Fatalf("extractReplayGainFromTags(missing) = (%#v, %t), want empty false", info, ok)
	}
	if _, ok := parseReplayGainAnalysisOutput("track_gain = not-a-number"); ok {
		t.Fatal("parseReplayGainAnalysisOutput(invalid gain) = true, want false")
	}
	if _, ok := parseAlbumReplayGainAnalysisOutput("no replaygain here"); ok {
		t.Fatal("parseAlbumReplayGainAnalysisOutput(invalid) = true, want false")
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "1")
	if _, err := calculateReplayGainWithFFmpeg(trackOne, ffmpegPath); err == nil || !strings.Contains(err.Error(), "ffmpeg replaygain scan failed") {
		t.Fatalf("calculateReplayGainWithFFmpeg(empty failing output) = %v, want wrapped error", err)
	}
	if _, err := calculateAlbumReplayGainWithFFmpeg([]string{trackOne, trackTwo}, ffmpegPath); err == nil || !strings.Contains(err.Error(), "ffmpeg album replaygain scan failed") {
		t.Fatalf("calculateAlbumReplayGainWithFFmpeg(empty failing output) = %v, want wrapped error", err)
	}
	if _, err := calculateReleaseDynamicRangeWithFFmpeg([]string{trackOne, trackTwo}, ffmpegPath); err == nil || !strings.Contains(err.Error(), "ffmpeg album dynamic range scan failed") {
		t.Fatalf("calculateReleaseDynamicRangeWithFFmpeg(empty failing output) = %v, want wrapped error", err)
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "no album replaygain data")
	if _, err := calculateAlbumReplayGainWithFFmpeg([]string{trackOne, trackTwo}, ffmpegPath); err == nil || !strings.Contains(err.Error(), "no gain data") {
		t.Fatalf("calculateAlbumReplayGainWithFFmpeg(no data) = %v, want no-data error", err)
	}
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "no dynamic range data")
	if _, err := calculateReleaseDynamicRangeWithFFmpeg([]string{trackOne, trackTwo}, ffmpegPath); err == nil || !strings.Contains(err.Error(), "no range data") {
		t.Fatalf("calculateReleaseDynamicRangeWithFFmpeg(no data) = %v, want no-data error", err)
	}
}

func TestReplayGainResolveBranchesForCachesAndAlbumPreference(t *testing.T) {
	originalReadTaglibTags := readTaglibTags
	t.Cleanup(func() {
		readTaglibTags = originalReadTaglibTags
	})

	helperDir := t.TempDir()
	ffmpegPath := copyCurrentTestBinary(t, helperDir, "ffmpeg.exe")
	trackOne := filepath.Join(helperDir, "01 One.flac")
	trackTwo := filepath.Join(helperDir, "02 Two.flac")
	writeTestFile(t, trackOne, "track one")
	writeTestFile(t, trackTwo, "track two")

	cacheKey, ok := buildReplayGainReleaseCacheKey([]string{trackOne, trackTwo})
	if !ok {
		t.Fatal("buildReplayGainReleaseCacheKey(two tracks) = false, want true")
	}

	backendWithCachedMiss := NewAudioBackend()
	backendWithCachedMiss.putReplayGainReleaseCache(cacheKey, ReplayGainInfo{}, false)
	if info, ok := backendWithCachedMiss.resolveAlbumReplayGainInfo(nil, []string{trackOne, trackTwo}); ok || info != (ReplayGainInfo{}) {
		t.Fatalf("resolveAlbumReplayGainInfo(cached miss) = (%#v, %t), want empty false", info, ok)
	}

	backendWithoutAlbumFallback := NewAudioBackend()
	backendWithoutAlbumFallback.ffmpegPath = ffmpegPath
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "[Parsed_replaygain_0 @ 0] track_gain = -5.00 dB\n[Parsed_replaygain_0 @ 0] track_peak = 0.70")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "0")
	albumInfo, ok := backendWithoutAlbumFallback.resolveAlbumReplayGainInfo(nil, []string{trackOne, trackTwo})
	if ok || albumInfo != (ReplayGainInfo{}) {
		t.Fatalf("resolveAlbumReplayGainInfo(no tag fallback) = (%#v, %t), want empty false", albumInfo, ok)
	}
	if cachedInfo, hasValue, cacheHit := backendWithoutAlbumFallback.getReplayGainReleaseCache(cacheKey); !cacheHit || hasValue || cachedInfo != (ReplayGainInfo{}) {
		t.Fatalf("getReplayGainReleaseCache(no tag fallback) = (%#v, %t, %t), want cached miss", cachedInfo, hasValue, cacheHit)
	}

	signature, ok := trackTagsFileSignatureForPath(trackOne)
	if !ok {
		t.Fatalf("trackTagsFileSignatureForPath(%q) = false, want true", trackOne)
	}
	backendWithTrackCachedMiss := NewAudioBackend()
	backendWithTrackCachedMiss.putReplayGainCache(trackOne, signature, ReplayGainInfo{}, false)
	if info := backendWithTrackCachedMiss.resolveReplayGainInfo(trackOne, nil, nil); info != (ReplayGainInfo{}) {
		t.Fatalf("resolveReplayGainInfo(cached miss) = %#v, want empty info", info)
	}

	backendWithAlbumPreference := NewAudioBackend()
	albumPreferred := backendWithAlbumPreference.resolveReplayGainInfo(trackOne, map[string][]string{"REPLAYGAIN_ALBUM_GAIN": {"-4 dB"}, "REPLAYGAIN_ALBUM_PEAK": {"0.9"}}, []string{trackOne, trackTwo})
	if albumPreferred.Source != string(replayGainSourceAlbumTag) || albumPreferred.GainDB != -4 {
		t.Fatalf("resolveReplayGainInfo(album preferred) = %#v, want album-tag info", albumPreferred)
	}

	readTaglibTags = func(path string) (map[string][]string, error) {
		return map[string][]string{"REPLAYGAIN_TRACK_GAIN": {"-6 dB"}, "REPLAYGAIN_TRACK_PEAK": {"0.8"}}, nil
	}
	backendWithTaglibFallback := NewAudioBackend()
	info := backendWithTaglibFallback.resolveReplayGainInfo(trackOne, nil, nil)
	if info.Source != string(replayGainSourceTrackTag) || info.GainDB != -6 {
		t.Fatalf("resolveReplayGainInfo(taglib fallback) = %#v, want track-tag info", info)
	}
	if cachedInfo, hasValue, cacheHit := backendWithTaglibFallback.getReplayGainCache(trackOne, signature); !cacheHit || !hasValue || cachedInfo.Source != string(replayGainSourceTrackTag) {
		t.Fatalf("getReplayGainCache(taglib fallback) = (%#v, %t, %t), want cached track-tag info", cachedInfo, hasValue, cacheHit)
	}
}

func TestReplayGainAdditionalEdgeBranches(t *testing.T) {
	helperDir := t.TempDir()
	ffmpegPath := copyCurrentTestBinary(t, helperDir, "ffmpeg.exe")
	trackOne := filepath.Join(helperDir, "01 One.flac")
	trackTwo := filepath.Join(helperDir, "02 Two.flac")
	writeTestFile(t, trackOne, "track one")
	writeTestFile(t, trackTwo, "track two")

	if got := (ReplayGainInfo{GainDB: -10000}).Scale(); got != 1 {
		t.Fatalf("ReplayGainInfo.Scale()(underflow) = %f, want 1", got)
	}

	albumOnlyInfo, ok := extractReplayGainFromTags(map[string][]string{
		"REPLAYGAIN_ALBUM_GAIN": {"-4.00 dB"},
		"REPLAYGAIN_ALBUM_PEAK": {"0.95"},
	})
	if !ok || albumOnlyInfo.Source != string(replayGainSourceAlbumTag) || albumOnlyInfo.GainDB != -4 || albumOnlyInfo.Peak != 0.95 {
		t.Fatalf("extractReplayGainFromTags(album fallback) = (%#v, %t), want album-tag info", albumOnlyInfo, ok)
	}

	overflowingGainOutput := fmt.Sprintf("track_gain = %s dB", strings.Repeat("9", 400))
	if _, ok := parseReplayGainAnalysisOutput(overflowingGainOutput); ok {
		t.Fatal("parseReplayGainAnalysisOutput(overflowing gain) = true, want false")
	}
	if dynamicRange, ok := parseReplayGainDynamicRangeOutput("LRA: 0.1 LU"); !ok || dynamicRange != 1 {
		t.Fatalf("parseReplayGainDynamicRangeOutput(tiny positive) = (%d, %t), want (1, true)", dynamicRange, ok)
	}

	t.Setenv("SILPHIUM_TEST_FFMPEG_STDOUT", "album stderr text")
	t.Setenv("SILPHIUM_TEST_FFMPEG_STDERR", "album stderr text")
	t.Setenv("SILPHIUM_TEST_FFMPEG_EXIT", "1")
	if _, err := calculateAlbumReplayGainWithFFmpeg([]string{trackOne, trackTwo}, ffmpegPath); err == nil || !strings.Contains(err.Error(), "album stderr text") {
		t.Fatalf("calculateAlbumReplayGainWithFFmpeg(stderr) = %v, want stderr-wrapped error", err)
	}
	if _, err := calculateReleaseDynamicRangeWithFFmpeg([]string{trackOne, trackTwo}, ""); err == nil || !strings.Contains(err.Error(), "ffmpeg executable was not found") {
		t.Fatalf("calculateReleaseDynamicRangeWithFFmpeg(empty ffmpeg) = %v, want missing-ffmpeg error", err)
	}

	cacheBackend := NewAudioBackend()
	cacheBackend.putReplayGainReleaseCache("album-key", ReplayGainInfo{GainDB: -3}, true)
	cacheBackend.putReplayGainReleaseCache("other-key", ReplayGainInfo{GainDB: -2}, true)
	cacheBackend.putReplayGainReleaseCache("album-key", ReplayGainInfo{GainDB: -1}, true)
	if got, want := len(cacheBackend.replayGainReleaseCacheOrder), 2; got != want {
		t.Fatalf("putReplayGainReleaseCache(duplicate) order len = %d, want %d", got, want)
	}
	if lastKey := cacheBackend.replayGainReleaseCacheOrder[len(cacheBackend.replayGainReleaseCacheOrder)-1]; lastKey != "album-key" {
		t.Fatalf("putReplayGainReleaseCache(duplicate) last key = %q, want album-key", lastKey)
	}

	albumCacheBackend := NewAudioBackend()
	albumCacheKey, ok := buildReplayGainReleaseCacheKey([]string{trackOne, trackTwo})
	if !ok {
		t.Fatal("buildReplayGainReleaseCacheKey(two tracks) = false, want true")
	}
	albumCacheBackend.putReplayGainReleaseCache(albumCacheKey, ReplayGainInfo{GainDB: -6, Peak: 0.8}, true)
	if info, ok := albumCacheBackend.resolveAlbumReplayGainInfo(nil, []string{trackTwo, trackOne}); !ok || info.Source != "" || info.GainDB != -6 || info.Peak != 0.8 {
		t.Fatalf("resolveAlbumReplayGainInfo(cached hit) = (%#v, %t), want cached album replaygain info", info, ok)
	}

	dynamicRangeBackend := NewAudioBackend()
	dynamicRangeBackend.putReplayGainReleaseDynamicRangeCache(albumCacheKey, 9, true)
	if dynamicRange, ok := dynamicRangeBackend.resolveReplayGainReleaseDynamicRange([]string{trackTwo, trackOne}); !ok || dynamicRange != 9 {
		t.Fatalf("resolveReplayGainReleaseDynamicRange(cached hit) = (%d, %t), want (9, true)", dynamicRange, ok)
	}
}
