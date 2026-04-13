//go:build !windows

package main

import (
	"os"
	"strings"

	"github.com/fsnotify/fsnotify"
)

type fsnotifyLibraryEventWatcher struct {
	watcher *fsnotify.Watcher
	closed  bool
}

func libraryWatcherUsesRecursiveRootHandles() bool {
	return false
}

func newLibraryEventWatcher(roots []libraryRootConfig, watchablePaths []string, directoryPaths []string, onProgress func()) (libraryEventWatcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	if len(directoryPaths) > 0 {
		addLibraryWatchesFromDiscoveredDirectories(watcher, watchablePaths, onProgress)
	} else {
		for _, rootPath := range watchablePaths {
			addLibraryWatchesRecursive(watcher, rootPath, onProgress)
		}
	}

	return &fsnotifyLibraryEventWatcher{watcher: watcher}, nil
}

func addLibraryWatchesFromDiscoveredDirectories(watcher *fsnotify.Watcher, directoryPaths []string, onProgress func()) {
	for _, directoryPath := range directoryPaths {
		if strings.TrimSpace(directoryPath) == "" {
			continue
		}

		_ = watcher.Add(directoryPath)
		if onProgress != nil {
			onProgress()
		}
	}
}

func (w *fsnotifyLibraryEventWatcher) Close() error {
	if w.closed {
		return nil
	}
	w.closed = true
	return w.watcher.Close()
}

func (w *fsnotifyLibraryEventWatcher) Events() <-chan fsnotify.Event {
	return w.watcher.Events
}

func (w *fsnotifyLibraryEventWatcher) Errors() <-chan error {
	return w.watcher.Errors
}

func (w *fsnotifyLibraryEventWatcher) HandleCreatePath(path string) {
	if info, statErr := os.Stat(path); statErr == nil && info.IsDir() {
		addLibraryWatchesRecursive(w.watcher, path, nil)
	}
}

func (w *fsnotifyLibraryEventWatcher) IsClosed() bool {
	return w.closed
}
