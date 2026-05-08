//go:build !windows

package main

import "os/exec"

func configureHiddenUtilityCommand(command *exec.Cmd) {
	_ = command
}
