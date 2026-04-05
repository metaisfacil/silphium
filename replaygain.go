package main

import (
	"fmt"
	"math"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"

	taglib "go.senan.xyz/taglib"
)

const replayGainCacheLimit = 4096

// ReplayGainSource describes where the ReplayGain values were obtained from.
type ReplayGainSource string

const (
	replayGainSourceTrackTag   ReplayGainSource = "track-tag"
	replayGainSourceAlbumTag   ReplayGainSource = "album-tag"
	replayGainSourceCalculated ReplayGainSource = "calculated"
	replayGainSourceAlbumCalc  ReplayGainSource = "album-calculated"
)

// ReplayGainInfo stores the gain, peak, and provenance for a ReplayGain result.
type ReplayGainInfo struct {
	GainDB float64 `json:"gainDb,omitempty"`
	Peak   float64 `json:"peak,omitempty"`
	Source string  `json:"source,omitempty"`
}

type replayGainCacheEntry struct {
	Signature trackTagsFileSignature
	Info      ReplayGainInfo
	HasValue  bool
}

type replayGainReleaseCacheEntry struct {
	Info            ReplayGainInfo
	HasValue        bool
	DynamicRange    int
	HasDynamicRange bool
}

var replayGainDBPattern = regexp.MustCompile(`(?i)[+\-]?(?:\d+(?:\.\d+)?|\.\d+)`)
var replayGainPeakPattern = regexp.MustCompile(`(?i)[+\-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+\-]?\d+)?`)
var replayGainTrackLinePattern = regexp.MustCompile(`(?im)track_gain\s*=\s*([+\-]?(?:\d+(?:\.\d+)?|\.\d+))\s*dB`)
var replayGainPeakLinePattern = regexp.MustCompile(`(?im)track_peak\s*=\s*([+\-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+\-]?\d+)?)`)
var replayGainDynamicRangeLinePattern = regexp.MustCompile(`(?im)^\s*LRA:\s*([+\-]?(?:\d+(?:\.\d+)?|\.\d+))(?:\s*(?:LU|LUFS))?\b`)

func isFiniteFloat64(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func sanitizeReplayGainInfo(info ReplayGainInfo) ReplayGainInfo {
	if !isFiniteFloat64(info.GainDB) {
		info.GainDB = 0
	}
	if !isFiniteFloat64(info.Peak) || info.Peak <= 0 {
		info.Peak = 0
	}
	info.Source = strings.TrimSpace(info.Source)
	return info
}

// Scale converts the ReplayGain value to a linear amplitude multiplier.
func (info ReplayGainInfo) Scale() float64 {
	sanitized := sanitizeReplayGainInfo(info)
	scale := math.Pow(10, sanitized.GainDB/20)
	if !isFiniteFloat64(scale) || scale <= 0 {
		return 1
	}

	if scale > 1 && sanitized.Peak > 0 {
		clipSafeScale := 1 / sanitized.Peak
		if isFiniteFloat64(clipSafeScale) && clipSafeScale > 0 && clipSafeScale < scale {
			scale = clipSafeScale
		}
	}

	if !isFiniteFloat64(scale) || scale <= 0 {
		return 1
	}

	return scale
}

func parseReplayGainDBValue(value string) (float64, bool) {
	match := replayGainDBPattern.FindString(strings.TrimSpace(value))
	if match == "" {
		return 0, false
	}

	parsed, err := strconv.ParseFloat(match, 64)
	if err != nil || !isFiniteFloat64(parsed) {
		return 0, false
	}

	return parsed, true
}

func parseReplayGainPeakValue(value string) (float64, bool) {
	match := replayGainPeakPattern.FindString(strings.TrimSpace(value))
	if match == "" {
		return 0, false
	}

	parsed, err := strconv.ParseFloat(match, 64)
	if err != nil || !isFiniteFloat64(parsed) || parsed <= 0 {
		return 0, false
	}

	return parsed, true
}

func extractTrackReplayGainFromTags(tags map[string][]string) (ReplayGainInfo, bool) {
	if len(tags) == 0 {
		return ReplayGainInfo{}, false
	}

	trackGainValue := firstTagValue(tags, "REPLAYGAIN_TRACK_GAIN")
	if gainDB, ok := parseReplayGainDBValue(trackGainValue); ok {
		info := ReplayGainInfo{
			GainDB: gainDB,
			Source: string(replayGainSourceTrackTag),
		}
		if peak, ok := parseReplayGainPeakValue(firstTagValue(tags, "REPLAYGAIN_TRACK_PEAK")); ok {
			info.Peak = peak
		}
		return sanitizeReplayGainInfo(info), true
	}

	return ReplayGainInfo{}, false
}

func extractAlbumReplayGainFromTags(tags map[string][]string) (ReplayGainInfo, bool) {
	if len(tags) == 0 {
		return ReplayGainInfo{}, false
	}

	albumGainValue := firstTagValue(tags, "REPLAYGAIN_ALBUM_GAIN")
	if gainDB, ok := parseReplayGainDBValue(albumGainValue); ok {
		info := ReplayGainInfo{
			GainDB: gainDB,
			Source: string(replayGainSourceAlbumTag),
		}
		if peak, ok := parseReplayGainPeakValue(firstTagValue(tags, "REPLAYGAIN_ALBUM_PEAK")); ok {
			info.Peak = peak
		}
		return sanitizeReplayGainInfo(info), true
	}

	return ReplayGainInfo{}, false
}

func extractReplayGainFromTags(tags map[string][]string) (ReplayGainInfo, bool) {
	if info, ok := extractTrackReplayGainFromTags(tags); ok {
		return info, true
	}

	if info, ok := extractAlbumReplayGainFromTags(tags); ok {
		return info, true
	}

	return ReplayGainInfo{}, false
}

func parseReplayGainAnalysisOutput(output string) (ReplayGainInfo, bool) {
	gainMatch := replayGainTrackLinePattern.FindStringSubmatch(output)
	if len(gainMatch) < 2 {
		return ReplayGainInfo{}, false
	}

	gainDB, ok := parseReplayGainDBValue(gainMatch[1])
	if !ok {
		return ReplayGainInfo{}, false
	}

	info := ReplayGainInfo{
		GainDB: gainDB,
		Source: string(replayGainSourceCalculated),
	}

	peakMatch := replayGainPeakLinePattern.FindStringSubmatch(output)
	if len(peakMatch) >= 2 {
		if peak, ok := parseReplayGainPeakValue(peakMatch[1]); ok {
			info.Peak = peak
		}
	}

	return sanitizeReplayGainInfo(info), true
}

func calculateReplayGainWithFFmpeg(path string, ffmpegPath string) (ReplayGainInfo, error) {
	trimmedPath := strings.TrimSpace(path)
	trimmedFFmpegPath := strings.TrimSpace(ffmpegPath)
	if trimmedPath == "" {
		return ReplayGainInfo{}, fmt.Errorf("track path is required")
	}
	if trimmedFFmpegPath == "" {
		return ReplayGainInfo{}, fmt.Errorf("ffmpeg executable was not found")
	}

	command := exec.Command(
		trimmedFFmpegPath,
		"-nostdin",
		"-hide_banner",
		"-nostats",
		"-loglevel", "info",
		"-i", trimmedPath,
		"-map", "0:a:0",
		"-af", "replaygain",
		"-f", "null",
		"-",
	)
	configureHiddenUtilityCommand(command)

	rawOutput, err := command.CombinedOutput()
	output := string(rawOutput)
	if info, ok := parseReplayGainAnalysisOutput(output); ok {
		return info, nil
	}

	if err != nil {
		trimmedOutput := strings.TrimSpace(output)
		if trimmedOutput != "" {
			return ReplayGainInfo{}, fmt.Errorf("ffmpeg replaygain scan failed: %s", trimmedOutput)
		}
		return ReplayGainInfo{}, fmt.Errorf("ffmpeg replaygain scan failed: %w", err)
	}

	return ReplayGainInfo{}, fmt.Errorf("ffmpeg replaygain scan returned no gain data")
}

func normalizeReplayGainReleasePaths(paths []string) []string {
	if len(paths) == 0 {
		return nil
	}

	normalized := make([]string, 0, len(paths))
	seen := make(map[string]struct{}, len(paths))
	for _, rawPath := range paths {
		trimmedPath := strings.TrimSpace(rawPath)
		if trimmedPath == "" {
			continue
		}

		normalizedKey := strings.ToLower(trimmedPath)
		if _, exists := seen[normalizedKey]; exists {
			continue
		}

		seen[normalizedKey] = struct{}{}
		normalized = append(normalized, trimmedPath)
	}

	if len(normalized) == 0 {
		return nil
	}

	return normalized
}

func buildReplayGainReleaseCacheKey(paths []string) (string, bool) {
	normalized := normalizeReplayGainReleasePaths(paths)
	if len(normalized) <= 1 {
		return "", false
	}

	parts := make([]string, 0, len(normalized))
	for _, path := range normalized {
		signature, ok := trackTagsFileSignatureForPath(path)
		if !ok {
			return "", false
		}

		parts = append(parts, fmt.Sprintf("%s|%d|%d", strings.ToLower(path), signature.Size, signature.ModUnixNs))
	}

	sort.Strings(parts)
	return strings.Join(parts, "||"), true
}

func escapeFFConcatPath(path string) string {
	escaped := strings.ReplaceAll(path, "\\", "\\\\")
	escaped = strings.ReplaceAll(escaped, "'", "\\'")
	return escaped
}

func parseAlbumReplayGainAnalysisOutput(output string) (ReplayGainInfo, bool) {
	info, ok := parseReplayGainAnalysisOutput(output)
	if !ok {
		return ReplayGainInfo{}, false
	}

	info.Source = string(replayGainSourceAlbumCalc)
	return sanitizeReplayGainInfo(info), true
}

func parseReplayGainDynamicRangeOutput(output string) (int, bool) {
	match := replayGainDynamicRangeLinePattern.FindStringSubmatch(output)
	if len(match) < 2 {
		return 0, false
	}

	parsed, err := strconv.ParseFloat(match[1], 64)
	if err != nil || !isFiniteFloat64(parsed) || parsed <= 0 {
		return 0, false
	}

	rounded := int(math.Round(parsed))
	if rounded <= 0 {
		rounded = 1
	}

	return rounded, true
}

func calculateAlbumReplayGainWithFFmpeg(paths []string, ffmpegPath string) (ReplayGainInfo, error) {
	normalized := normalizeReplayGainReleasePaths(paths)
	if len(normalized) <= 1 {
		return ReplayGainInfo{}, fmt.Errorf("album replaygain requires multiple tracks")
	}
	trimmedFFmpegPath := strings.TrimSpace(ffmpegPath)
	if trimmedFFmpegPath == "" {
		return ReplayGainInfo{}, fmt.Errorf("ffmpeg executable was not found")
	}

	concatFile, err := os.CreateTemp("", "silphium-replaygain-*.ffconcat")
	if err != nil {
		return ReplayGainInfo{}, err
	}
	concatPath := concatFile.Name()
	defer func() {
		_ = concatFile.Close()
		_ = os.Remove(concatPath)
	}()

	builder := strings.Builder{}
	builder.WriteString("ffconcat version 1.0\n")
	for _, path := range normalized {
		builder.WriteString("file '")
		builder.WriteString(escapeFFConcatPath(path))
		builder.WriteString("'\n")
	}

	if _, err := concatFile.WriteString(builder.String()); err != nil {
		return ReplayGainInfo{}, err
	}
	if err := concatFile.Close(); err != nil {
		return ReplayGainInfo{}, err
	}

	command := exec.Command(
		trimmedFFmpegPath,
		"-nostdin",
		"-hide_banner",
		"-nostats",
		"-loglevel", "info",
		"-safe", "0",
		"-f", "concat",
		"-i", concatPath,
		"-map", "0:a:0",
		"-af", "replaygain",
		"-f", "null",
		"-",
	)
	configureHiddenUtilityCommand(command)

	rawOutput, err := command.CombinedOutput()
	output := string(rawOutput)
	if info, ok := parseAlbumReplayGainAnalysisOutput(output); ok {
		return info, nil
	}

	if err != nil {
		trimmedOutput := strings.TrimSpace(output)
		if trimmedOutput != "" {
			return ReplayGainInfo{}, fmt.Errorf("ffmpeg album replaygain scan failed: %s", trimmedOutput)
		}
		return ReplayGainInfo{}, fmt.Errorf("ffmpeg album replaygain scan failed: %w", err)
	}

	return ReplayGainInfo{}, fmt.Errorf("ffmpeg album replaygain scan returned no gain data")
}

func calculateReleaseDynamicRangeWithFFmpeg(paths []string, ffmpegPath string) (int, error) {
	normalized := normalizeReplayGainReleasePaths(paths)
	if len(normalized) <= 1 {
		return 0, fmt.Errorf("album dynamic range requires multiple tracks")
	}
	trimmedFFmpegPath := strings.TrimSpace(ffmpegPath)
	if trimmedFFmpegPath == "" {
		return 0, fmt.Errorf("ffmpeg executable was not found")
	}

	concatFile, err := os.CreateTemp("", "silphium-dynamic-range-*.ffconcat")
	if err != nil {
		return 0, err
	}
	concatPath := concatFile.Name()
	defer func() {
		_ = concatFile.Close()
		_ = os.Remove(concatPath)
	}()

	builder := strings.Builder{}
	builder.WriteString("ffconcat version 1.0\n")
	for _, path := range normalized {
		builder.WriteString("file '")
		builder.WriteString(escapeFFConcatPath(path))
		builder.WriteString("'\n")
	}

	if _, err := concatFile.WriteString(builder.String()); err != nil {
		return 0, err
	}
	if err := concatFile.Close(); err != nil {
		return 0, err
	}

	command := exec.Command(
		trimmedFFmpegPath,
		"-nostdin",
		"-hide_banner",
		"-nostats",
		"-loglevel", "info",
		"-safe", "0",
		"-f", "concat",
		"-i", concatPath,
		"-map", "0:a:0",
		"-filter:a", "ebur128",
		"-f", "null",
		"-",
	)
	configureHiddenUtilityCommand(command)

	rawOutput, err := command.CombinedOutput()
	output := string(rawOutput)
	if dynamicRange, ok := parseReplayGainDynamicRangeOutput(output); ok {
		return dynamicRange, nil
	}

	if err != nil {
		trimmedOutput := strings.TrimSpace(output)
		if trimmedOutput != "" {
			return 0, fmt.Errorf("ffmpeg album dynamic range scan failed: %s", trimmedOutput)
		}
		return 0, fmt.Errorf("ffmpeg album dynamic range scan failed: %w", err)
	}

	return 0, fmt.Errorf("ffmpeg album dynamic range scan returned no range data")
}

func (b *AudioBackend) removeReplayGainCacheOrderEntryLocked(path string) {
	for idx, cachedPath := range b.replayGainCacheOrder {
		if cachedPath != path {
			continue
		}

		b.replayGainCacheOrder = append(b.replayGainCacheOrder[:idx], b.replayGainCacheOrder[idx+1:]...)
		return
	}
}

func (b *AudioBackend) touchReplayGainCacheOrderLocked(path string) {
	b.removeReplayGainCacheOrderEntryLocked(path)
	b.replayGainCacheOrder = append(b.replayGainCacheOrder, path)
}

func (b *AudioBackend) getReplayGainCache(path string, signature trackTagsFileSignature) (ReplayGainInfo, bool, bool) {
	b.replayGainCacheMu.Lock()
	defer b.replayGainCacheMu.Unlock()

	entry, exists := b.replayGainCacheByPath[path]
	if !exists {
		return ReplayGainInfo{}, false, false
	}

	if entry.Signature != signature {
		delete(b.replayGainCacheByPath, path)
		b.removeReplayGainCacheOrderEntryLocked(path)
		return ReplayGainInfo{}, false, false
	}

	b.touchReplayGainCacheOrderLocked(path)
	return entry.Info, entry.HasValue, true
}

func (b *AudioBackend) putReplayGainCache(path string, signature trackTagsFileSignature, info ReplayGainInfo, hasValue bool) {
	b.replayGainCacheMu.Lock()
	defer b.replayGainCacheMu.Unlock()

	if b.replayGainCacheByPath == nil {
		b.replayGainCacheByPath = make(map[string]replayGainCacheEntry, replayGainCacheLimit)
	}

	b.replayGainCacheByPath[path] = replayGainCacheEntry{
		Signature: signature,
		Info:      sanitizeReplayGainInfo(info),
		HasValue:  hasValue,
	}
	b.touchReplayGainCacheOrderLocked(path)

	for len(b.replayGainCacheOrder) > replayGainCacheLimit {
		evictedPath := b.replayGainCacheOrder[0]
		b.replayGainCacheOrder = b.replayGainCacheOrder[1:]
		delete(b.replayGainCacheByPath, evictedPath)
	}
}

func (b *AudioBackend) getReplayGainReleaseCache(key string) (ReplayGainInfo, bool, bool) {
	b.replayGainReleaseCacheMu.Lock()
	defer b.replayGainReleaseCacheMu.Unlock()

	entry, exists := b.replayGainReleaseCacheByKey[key]
	if !exists {
		return ReplayGainInfo{}, false, false
	}

	return entry.Info, entry.HasValue, true
}

func (b *AudioBackend) putReplayGainReleaseCache(key string, info ReplayGainInfo, hasValue bool) {
	b.replayGainReleaseCacheMu.Lock()
	defer b.replayGainReleaseCacheMu.Unlock()

	if b.replayGainReleaseCacheByKey == nil {
		b.replayGainReleaseCacheByKey = make(map[string]replayGainReleaseCacheEntry, replayGainCacheLimit)
	}

	entry := b.replayGainReleaseCacheByKey[key]
	entry.Info = sanitizeReplayGainInfo(info)
	entry.HasValue = hasValue
	b.replayGainReleaseCacheByKey[key] = entry

	for index, cachedKey := range b.replayGainReleaseCacheOrder {
		if cachedKey != key {
			continue
		}

		b.replayGainReleaseCacheOrder = append(b.replayGainReleaseCacheOrder[:index], b.replayGainReleaseCacheOrder[index+1:]...)
		break
	}
	b.replayGainReleaseCacheOrder = append(b.replayGainReleaseCacheOrder, key)

	for len(b.replayGainReleaseCacheOrder) > replayGainCacheLimit {
		evictedKey := b.replayGainReleaseCacheOrder[0]
		b.replayGainReleaseCacheOrder = b.replayGainReleaseCacheOrder[1:]
		delete(b.replayGainReleaseCacheByKey, evictedKey)
	}
}

func (b *AudioBackend) getReplayGainReleaseDynamicRangeCache(key string) (int, bool, bool) {
	b.replayGainReleaseCacheMu.Lock()
	defer b.replayGainReleaseCacheMu.Unlock()

	entry, exists := b.replayGainReleaseCacheByKey[key]
	if !exists {
		return 0, false, false
	}

	return entry.DynamicRange, entry.HasDynamicRange, true
}

func (b *AudioBackend) putReplayGainReleaseDynamicRangeCache(key string, dynamicRange int, hasValue bool) {
	b.replayGainReleaseCacheMu.Lock()
	defer b.replayGainReleaseCacheMu.Unlock()

	if b.replayGainReleaseCacheByKey == nil {
		b.replayGainReleaseCacheByKey = make(map[string]replayGainReleaseCacheEntry, replayGainCacheLimit)
	}

	entry := b.replayGainReleaseCacheByKey[key]
	entry.DynamicRange = dynamicRange
	entry.HasDynamicRange = hasValue
	b.replayGainReleaseCacheByKey[key] = entry

	for index, cachedKey := range b.replayGainReleaseCacheOrder {
		if cachedKey != key {
			continue
		}

		b.replayGainReleaseCacheOrder = append(b.replayGainReleaseCacheOrder[:index], b.replayGainReleaseCacheOrder[index+1:]...)
		break
	}
	b.replayGainReleaseCacheOrder = append(b.replayGainReleaseCacheOrder, key)

	for len(b.replayGainReleaseCacheOrder) > replayGainCacheLimit {
		evictedKey := b.replayGainReleaseCacheOrder[0]
		b.replayGainReleaseCacheOrder = b.replayGainReleaseCacheOrder[1:]
		delete(b.replayGainReleaseCacheByKey, evictedKey)
	}
}

func (b *AudioBackend) resolveAlbumReplayGainInfo(preloadedTags map[string][]string, releasePaths []string) (ReplayGainInfo, bool) {
	normalizedReleasePaths := normalizeReplayGainReleasePaths(releasePaths)
	if len(normalizedReleasePaths) <= 1 {
		return ReplayGainInfo{}, false
	}

	cacheKey, hasCacheKey := buildReplayGainReleaseCacheKey(normalizedReleasePaths)
	if hasCacheKey {
		if cachedInfo, cachedHasValue, cacheHit := b.getReplayGainReleaseCache(cacheKey); cacheHit {
			if cachedHasValue {
				return cachedInfo, true
			}
			return ReplayGainInfo{}, false
		}
	}

	if info, ok := extractAlbumReplayGainFromTags(preloadedTags); ok {
		if hasCacheKey {
			b.putReplayGainReleaseCache(cacheKey, info, true)
		}
		return info, true
	}

	for _, releasePath := range normalizedReleasePaths {
		tags, err := taglib.ReadTags(releasePath)
		if err != nil {
			continue
		}

		if info, ok := extractAlbumReplayGainFromTags(tags); ok {
			if hasCacheKey {
				b.putReplayGainReleaseCache(cacheKey, info, true)
			}
			return info, true
		}
	}

	info, err := calculateAlbumReplayGainWithFFmpeg(normalizedReleasePaths, b.ffmpegPath)
	if err == nil {
		if hasCacheKey {
			b.putReplayGainReleaseCache(cacheKey, info, true)
		}
		return info, true
	}

	logAudioEvent("Album ReplayGain scan failed releaseSize=%d error=%v", len(normalizedReleasePaths), err)
	if hasCacheKey {
		b.putReplayGainReleaseCache(cacheKey, ReplayGainInfo{}, false)
	}

	return ReplayGainInfo{}, false
}

func (b *AudioBackend) resolveReplayGainReleaseDynamicRange(releasePaths []string) (int, bool) {
	normalizedReleasePaths := normalizeReplayGainReleasePaths(releasePaths)
	if len(normalizedReleasePaths) <= 1 {
		return 0, false
	}

	cacheKey, hasCacheKey := buildReplayGainReleaseCacheKey(normalizedReleasePaths)
	if hasCacheKey {
		if cachedDynamicRange, cachedHasValue, cacheHit := b.getReplayGainReleaseDynamicRangeCache(cacheKey); cacheHit {
			if cachedHasValue {
				return cachedDynamicRange, true
			}
			return 0, false
		}
	}

	dynamicRange, err := calculateReleaseDynamicRangeWithFFmpeg(normalizedReleasePaths, b.ffmpegPath)
	if err == nil {
		if hasCacheKey {
			b.putReplayGainReleaseDynamicRangeCache(cacheKey, dynamicRange, true)
		}
		return dynamicRange, true
	}

	logAudioEvent("Album dynamic range scan failed releaseSize=%d error=%v", len(normalizedReleasePaths), err)
	if hasCacheKey {
		b.putReplayGainReleaseDynamicRangeCache(cacheKey, 0, false)
	}

	return 0, false
}

func (b *AudioBackend) resolveReplayGainInfo(path string, preloadedTags map[string][]string, releasePaths []string) ReplayGainInfo {
	if info, ok := b.resolveAlbumReplayGainInfo(preloadedTags, releasePaths); ok {
		return info
	}

	signature, hasSignature := trackTagsFileSignatureForPath(path)
	if hasSignature {
		if cachedInfo, cachedHasValue, cacheHit := b.getReplayGainCache(path, signature); cacheHit {
			if cachedHasValue {
				return cachedInfo
			}
			return ReplayGainInfo{}
		}
	}

	tags := preloadedTags
	if info, ok := extractReplayGainFromTags(tags); ok {
		if hasSignature {
			b.putReplayGainCache(path, signature, info, true)
		}
		return info
	}

	if tags == nil {
		loadedTags, err := taglib.ReadTags(path)
		if err == nil {
			tags = loadedTags
			if info, ok := extractReplayGainFromTags(tags); ok {
				if hasSignature {
					b.putReplayGainCache(path, signature, info, true)
				}
				return info
			}
		}
	}

	info, err := calculateReplayGainWithFFmpeg(path, b.ffmpegPath)
	if err == nil {
		if hasSignature {
			b.putReplayGainCache(path, signature, info, true)
		}
		return info
	}

	logAudioEvent("ReplayGain scan failed path=%q error=%v", path, err)
	if hasSignature {
		b.putReplayGainCache(path, signature, ReplayGainInfo{}, false)
	}

	return ReplayGainInfo{}
}
