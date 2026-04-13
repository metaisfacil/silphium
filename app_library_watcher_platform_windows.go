//go:build windows

package main

import (
	"fmt"
	"os"
	"sync"

	"github.com/fsnotify/fsnotify"
	"golang.org/x/sys/windows"
)

const windowsLibraryWatchFilter = windows.FILE_NOTIFY_CHANGE_FILE_NAME |
	windows.FILE_NOTIFY_CHANGE_DIR_NAME |
	windows.FILE_NOTIFY_CHANGE_LAST_WRITE |
	windows.FILE_NOTIFY_CHANGE_CREATION |
	windows.FILE_NOTIFY_CHANGE_SIZE

type windowsLibraryEventWatcher struct {
	done   chan struct{}
	events chan fsnotify.Event
	errors chan error

	mu     sync.Mutex
	closed bool
	stop   windows.Handle
	roots  []*windowsLibraryWatchRoot
	wg     sync.WaitGroup
}

type windowsLibraryWatchRoot struct {
	path   string
	handle windows.Handle
	ready  chan error
}

func libraryWatcherUsesRecursiveRootHandles() bool {
	return true
}

func newLibraryEventWatcher(roots []libraryRootConfig, _ []string, _ []string, onProgress func()) (libraryEventWatcher, error) {
	rootPaths := collectWatchableLibraryRootPaths(roots)
	if len(rootPaths) == 0 {
		return nil, fmt.Errorf("no valid library roots to watch")
	}

	stopSignal, err := windows.CreateEvent(nil, 1, 0, nil)
	if err != nil {
		return nil, os.NewSyscallError("CreateEvent", err)
	}

	watcher := &windowsLibraryEventWatcher{
		done:   make(chan struct{}),
		events: make(chan fsnotify.Event, 256),
		errors: make(chan error, 32),
		stop:   stopSignal,
		roots:  make([]*windowsLibraryWatchRoot, 0, len(rootPaths)),
	}

	for _, rootPath := range rootPaths {
		handle, handleErr := windows.FindFirstChangeNotification(rootPath, true, windowsLibraryWatchFilter)
		if handleErr != nil {
			_ = watcher.Close()
			return nil, os.NewSyscallError("FindFirstChangeNotification", handleErr)
		}

		watcher.roots = append(watcher.roots, &windowsLibraryWatchRoot{
			path:   rootPath,
			handle: handle,
			ready:  make(chan error, 1),
		})
		if onProgress != nil {
			onProgress()
		}
	}

	for _, root := range watcher.roots {
		watcher.wg.Add(1)
		go watcher.watchRoot(root)
		if err := <-root.ready; err != nil {
			_ = watcher.Close()
			return nil, err
		}
	}

	return watcher, nil
}

func (w *windowsLibraryEventWatcher) watchRoot(root *windowsLibraryWatchRoot) {
	defer w.wg.Done()

	root.ready <- nil
	for {
		status, err := windows.WaitForMultipleObjects([]windows.Handle{w.stop, root.handle}, false, windows.INFINITE)
		if err != nil {
			if w.isClosed() {
				return
			}

			w.sendError(os.NewSyscallError("WaitForMultipleObjects", err))
			return
		}

		if status == windows.WAIT_OBJECT_0 {
			return
		}
		if status != windows.WAIT_OBJECT_0+1 {
			w.sendError(fmt.Errorf("unexpected watcher wait status: %d", status))
			return
		}

		if !w.sendEvent(fsnotify.Event{Name: root.path, Op: fsnotify.Write}) {
			return
		}

		if err := windows.FindNextChangeNotification(root.handle); err != nil {
			if w.isClosed() {
				return
			}

			w.sendError(os.NewSyscallError("FindNextChangeNotification", err))
			return
		}
	}
}

func (w *windowsLibraryEventWatcher) Close() error {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return nil
	}
	w.closed = true
	close(w.done)
	roots := append([]*windowsLibraryWatchRoot(nil), w.roots...)
	stop := w.stop
	w.stop = 0
	w.mu.Unlock()

	if stop != 0 {
		_ = windows.SetEvent(stop)
	}
	w.wg.Wait()

	for _, root := range roots {
		if root == nil || root.handle == 0 {
			continue
		}
		_ = windows.FindCloseChangeNotification(root.handle)
		root.handle = 0
	}
	if stop != 0 {
		_ = windows.CloseHandle(stop)
	}
	close(w.events)
	close(w.errors)
	return nil
}

func (w *windowsLibraryEventWatcher) Events() <-chan fsnotify.Event {
	return w.events
}

func (w *windowsLibraryEventWatcher) Errors() <-chan error {
	return w.errors
}

func (w *windowsLibraryEventWatcher) HandleCreatePath(string) {
}

func (w *windowsLibraryEventWatcher) IsClosed() bool {
	return w.isClosed()
}

func (w *windowsLibraryEventWatcher) isClosed() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.closed
}

func (w *windowsLibraryEventWatcher) sendEvent(event fsnotify.Event) bool {
	select {
	case <-w.done:
		return false
	case w.events <- event:
		return true
	}
}

func (w *windowsLibraryEventWatcher) sendError(err error) bool {
	if err == nil {
		return true
	}

	select {
	case <-w.done:
		return false
	case w.errors <- err:
		return true
	}
}
