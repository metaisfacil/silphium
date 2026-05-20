//go:build !windows

package main

type noopSystemMediaTransportControlsManager struct{}

func newSystemMediaTransportControlsManager() systemMediaTransportControlsManager {
	return noopSystemMediaTransportControlsManager{}
}

func (noopSystemMediaTransportControlsManager) Start(*App) {}

func (noopSystemMediaTransportControlsManager) Stop() {}

func (noopSystemMediaTransportControlsManager) Sync(systemMediaTransportControlsSnapshot) {}
