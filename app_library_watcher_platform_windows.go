//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unsafe"

	"github.com/fsnotify/fsnotify"
	"golang.org/x/sys/windows"
)

const windowsLibraryWatcherBufferSize = 64 * 1024

const windowsLibraryWatchFilter = windows.FILE_NOTIFY_CHANGE_FILE_NAME |
	windows.FILE_NOTIFY_CHANGE_DIR_NAME |
	windows.FILE_NOTIFY_CHANGE_LAST_WRITE |
	windows.FILE_NOTIFY_CHANGE_CREATION |
	windows.FILE_NOTIFY_CHANGE_SIZE

const windowsLibraryWatcherDebounceDuration = 750 * time.Millisecond

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
	path       string
	handle     windows.Handle
	signal     windows.Handle
	overlapped windows.Overlapped
	buffer     []byte
	ready      chan error
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
		handle, handleErr := windows.CreateFile(
			windows.StringToUTF16Ptr(rootPath),
			windows.FILE_LIST_DIRECTORY,
			windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE,
			nil,
			windows.OPEN_EXISTING,
			windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OVERLAPPED,
			0,
		)
		if handleErr != nil {
			_ = watcher.Close()
			return nil, os.NewSyscallError("CreateFile", handleErr)
		}

		signal, signalErr := windows.CreateEvent(nil, 1, 0, nil)
		if signalErr != nil {
			_ = windows.CloseHandle(handle)
			_ = watcher.Close()
			return nil, os.NewSyscallError("CreateEvent", signalErr)
		}

		root := &windowsLibraryWatchRoot{
			path:   rootPath,
			handle: handle,
			signal: signal,
			buffer: make([]byte, windowsLibraryWatcherBufferSize),
			ready:  make(chan error, 1),
		}
		root.overlapped.HEvent = signal
		watcher.roots = append(watcher.roots, root)
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

func (r *windowsLibraryWatchRoot) startRead() error {
	if err := windows.ResetEvent(r.signal); err != nil {
		return os.NewSyscallError("ResetEvent", err)
	}
	r.overlapped = windows.Overlapped{HEvent: r.signal}
	err := windows.ReadDirectoryChanges(
		r.handle,
		&r.buffer[0],
		uint32(len(r.buffer)),
		true,
		windowsLibraryWatchFilter,
		nil,
		&r.overlapped,
		0,
	)
	if err != nil && !errors.Is(err, windows.ERROR_IO_PENDING) {
		return os.NewSyscallError("ReadDirectoryChanges", err)
	}

	return nil
}

func parseWindowsLibraryWatchEvents(rootPath string, buffer []byte) []fsnotify.Event {
	events := make([]fsnotify.Event, 0, 8)
	offset := 0
	for offset+12 <= len(buffer) {
		raw := (*windows.FileNotifyInformation)(unsafe.Pointer(&buffer[offset]))
		nameLength := int(raw.FileNameLength / 2)
		if nameLength <= 0 {
			if raw.NextEntryOffset == 0 {
				break
			}
			offset += int(raw.NextEntryOffset)
			continue
		}

		nameUnits := unsafe.Slice((*uint16)(unsafe.Pointer(&raw.FileName)), nameLength)
		fullPath := filepath.Clean(filepath.Join(rootPath, windows.UTF16ToString(nameUnits)))
		switch raw.Action {
		case windows.FILE_ACTION_ADDED:
			events = append(events, fsnotify.Event{Name: fullPath, Op: fsnotify.Create})
		case windows.FILE_ACTION_REMOVED:
			events = append(events, fsnotify.Event{Name: fullPath, Op: fsnotify.Remove})
		case windows.FILE_ACTION_MODIFIED:
			events = append(events, fsnotify.Event{Name: fullPath, Op: fsnotify.Write})
		case windows.FILE_ACTION_RENAMED_OLD_NAME:
			events = append(events, fsnotify.Event{Name: fullPath, Op: fsnotify.Rename})
		case windows.FILE_ACTION_RENAMED_NEW_NAME:
			events = append(events, fsnotify.Event{Name: fullPath, Op: fsnotify.Create})
		}

		if raw.NextEntryOffset == 0 {
			break
		}
		offset += int(raw.NextEntryOffset)
	}

	return events
}

func isWindowsLibraryWatcherShutdownError(err error) bool {
	return errors.Is(err, windows.ERROR_OPERATION_ABORTED) ||
		errors.Is(err, windows.ERROR_INVALID_HANDLE) ||
		errors.Is(err, windows.ERROR_ACCESS_DENIED)
}

func (w *windowsLibraryEventWatcher) watchRoot(root *windowsLibraryWatchRoot) {
	defer w.wg.Done()

	if err := root.startRead(); err != nil {
		root.ready <- err
		return
	}
	root.ready <- nil
	for {
		status, err := windows.WaitForMultipleObjects([]windows.Handle{w.stop, root.signal}, false, windows.INFINITE)
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

		var bytesReturned uint32
		err = windows.GetOverlappedResult(root.handle, &root.overlapped, &bytesReturned, false)
		if err != nil {
			if w.isClosed() && isWindowsLibraryWatcherShutdownError(err) {
				return
			}
			if errors.Is(err, windows.ERROR_NOTIFY_ENUM_DIR) {
				if !w.sendEvent(fsnotify.Event{Name: root.path, Op: fsnotify.Write}) {
					return
				}
			} else {
				w.sendError(os.NewSyscallError("GetOverlappedResult", err))
				return
			}
		} else {
			for _, event := range parseWindowsLibraryWatchEvents(root.path, root.buffer[:bytesReturned]) {
				if !w.sendEvent(event) {
					return
				}
			}
		}

		if err := root.startRead(); err != nil {
			if w.isClosed() && isWindowsLibraryWatcherShutdownError(err) {
				return
			}
			w.sendError(err)
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
	for _, root := range roots {
		if root == nil || root.handle == 0 {
			continue
		}
		_ = windows.CancelIoEx(root.handle, &root.overlapped)
	}
	w.wg.Wait()

	for _, root := range roots {
		if root == nil {
			continue
		}
		if root.signal != 0 {
			_ = windows.CloseHandle(root.signal)
			root.signal = 0
		}
		if root.handle != 0 {
			_ = windows.CloseHandle(root.handle)
			root.handle = 0
		}
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

func (w *windowsLibraryEventWatcher) DebounceDuration() time.Duration {
	return windowsLibraryWatcherDebounceDuration
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
