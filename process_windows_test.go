//go:build windows

package main

import (
	"os/exec"
	"testing"
)

func TestConfigureHiddenUtilityCommand(t *testing.T) {
	configureHiddenUtilityCommand(nil)

	command := exec.Command("cmd", "/c", "echo")
	configureHiddenUtilityCommand(command)
	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow {
		t.Fatalf("configureHiddenUtilityCommand() = %#v, want HideWindow=true", command.SysProcAttr)
	}
}
