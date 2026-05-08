package main

import (
	"context"
	"os/exec"
)

func newHiddenUtilityCommand(name string, args ...string) *exec.Cmd {
	command := exec.Command(name, args...)
	configureHiddenUtilityCommand(command)
	return command
}

func newHiddenUtilityCommandContext(ctx context.Context, name string, args ...string) *exec.Cmd {
	command := exec.CommandContext(ctx, name, args...)
	configureHiddenUtilityCommand(command)
	return command
}
