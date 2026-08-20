package proctracer

import (
	"testing"
)

func TestProcessTreeScanner_ScanChildren(t *testing.T) {
	mock := NewMockProcReader()
	mock.PIDs = []int{100, 200, 300, 400, 500}

	// 100: Root agent
	mock.Stats[100] = &ProcessRawStat{PID: 100, PPID: 1, Comm: "antigravity", State: "S"}
	// 200: Child of 100 (bash)
	mock.Stats[200] = &ProcessRawStat{PID: 200, PPID: 100, Comm: "bash", State: "S", RSSPages: 50}
	mock.Cmdlines[200] = []string{"/bin/bash", "-c", "go test ./..."}
	// 300: Grandchild of 100 (go test, child of 200)
	mock.Stats[300] = &ProcessRawStat{PID: 300, PPID: 200, Comm: "go", State: "R", RSSPages: 120}
	mock.Cmdlines[300] = []string{"go", "test", "./..."}
	// 400: Child of 100 (mcp server)
	mock.Stats[400] = &ProcessRawStat{PID: 400, PPID: 100, Comm: "node", State: "S", RSSPages: 200}
	mock.Cmdlines[400] = []string{"node", "mcp-server.js"}
	// 500: Unrelated process (PPID 1)
	mock.Stats[500] = &ProcessRawStat{PID: 500, PPID: 1, Comm: "systemd-logind", State: "S"}

	scanner := NewProcessTreeScanner(mock)
	children, err := scanner.ScanChildren(100)
	if err != nil {
		t.Fatalf("ScanChildren(100) error: %v", err)
	}

	if len(children) != 3 {
		t.Fatalf("ScanChildren(100) found %d children, want 3", len(children))
	}

	foundPIDs := make(map[int]bool)
	for _, c := range children {
		foundPIDs[c.PID] = true
	}

	if !foundPIDs[200] || !foundPIDs[300] || !foundPIDs[400] {
		t.Errorf("ScanChildren(100) missing expected child PIDs: %+v", children)
	}
	if foundPIDs[500] {
		t.Errorf("ScanChildren(100) should not include unrelated PID 500")
	}
}

func TestProcessTreeScanner_EmptyAndMissingPIDs(t *testing.T) {
	mock := NewMockProcReader()
	mock.PIDs = []int{}

	scanner := NewProcessTreeScanner(mock)
	children, err := scanner.ScanChildren(100)
	if err != nil {
		t.Fatalf("unexpected error on empty PIDs: %v", err)
	}
	if len(children) != 0 {
		t.Errorf("children count = %d, want 0", len(children))
	}
}
