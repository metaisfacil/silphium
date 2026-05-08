//go:build windows

package main

import (
	"context"
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

func TestNewHiddenUtilityCommand(t *testing.T) {
	command := newHiddenUtilityCommand("cmd", "/c", "echo")
	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow {
		t.Fatalf("newHiddenUtilityCommand() = %#v, want HideWindow=true", command.SysProcAttr)
	}
}

func TestNewHiddenUtilityCommandContext(t *testing.T) {
	command := newHiddenUtilityCommandContext(context.Background(), "cmd", "/c", "echo")
	if command.SysProcAttr == nil || !command.SysProcAttr.HideWindow {
		t.Fatalf("newHiddenUtilityCommandContext() = %#v, want HideWindow=true", command.SysProcAttr)
	}
}
