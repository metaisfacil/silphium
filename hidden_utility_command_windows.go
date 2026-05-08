//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

func configureHiddenUtilityCommand(command *exec.Cmd) {
	if command == nil {
		return
	}

	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
