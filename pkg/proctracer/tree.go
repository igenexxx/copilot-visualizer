package proctracer

import (
	"strings"
)

// ProcessTreeScanner finds all descendant processes for a given parent PID.
type ProcessTreeScanner struct {
	reader ProcReader
}

// NewProcessTreeScanner creates a scanner for descendant processes.
func NewProcessTreeScanner(reader ProcReader) *ProcessTreeScanner {
	if reader == nil {
		reader = NewDefaultProcReader()
	}
	return &ProcessTreeScanner{reader: reader}
}

// ScanChildren finds all direct and indirect children of the root PID.
func (s *ProcessTreeScanner) ScanChildren(rootPID int) ([]SubprocessInfo, error) {
	pids, err := s.reader.ListPIDs()
	if err != nil {
		return nil, err
	}

	// Map ppid -> list of child pids, and cache stats
	childrenMap := make(map[int][]int)
	statMap := make(map[int]*ProcessRawStat)

	for _, pid := range pids {
		stat, err := s.reader.ReadStat(pid)
		if err != nil {
			continue
		}
		statMap[pid] = stat
		childrenMap[stat.PPID] = append(childrenMap[stat.PPID], pid)
	}

	// Collect all descendants via BFS
	var descendants []int
	queue := []int{rootPID}
	visited := make(map[int]bool)
	visited[rootPID] = true

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]

		for _, child := range childrenMap[curr] {
			if !visited[child] {
				visited[child] = true
				descendants = append(descendants, child)
				queue = append(queue, child)
			}
		}
	}

	pageSize := s.reader.GetPageSize()
	var result []SubprocessInfo

	for _, childPID := range descendants {
		stat, ok := statMap[childPID]
		if !ok {
			continue
		}

		cmdline, _ := s.reader.ReadCmdline(childPID)
		fullCmd := strings.Join(cmdline, " ")
		if fullCmd == "" {
			fullCmd = stat.Comm
		}

		var rssBytes uint64
		if stat.RSSPages > 0 {
			rssBytes = uint64(stat.RSSPages) * pageSize
		}

		result = append(result, SubprocessInfo{
			PID:      childPID,
			PPID:     stat.PPID,
			Name:     stat.Comm,
			Cmdline:  fullCmd,
			State:    ProcessStateString(stat.State),
			RSSBytes: rssBytes,
		})
	}

	return result, nil
}
