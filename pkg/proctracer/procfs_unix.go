//go:build !windows

package proctracer

import (
	"errors"
	"syscall"

	"golang.org/x/sys/unix"
)

// IsProcessAlive checks if a process with the given PID is currently active.
func IsProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := unix.Kill(pid, 0)
	if err == nil {
		return true
	}
	return errors.Is(err, syscall.EPERM)
}
