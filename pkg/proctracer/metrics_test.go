package proctracer

import (
	"testing"
	"time"
)

func TestProcessStateTracker_Sample(t *testing.T) {
	mock := NewMockProcReader()
	pid := 500

	mock.Stats[pid] = &ProcessRawStat{
		PID:        pid,
		Comm:       "agy",
		State:      "R",
		UTime:      100,
		STime:      50,
		NumThreads: 8,
		RSSPages:   1000,
	}
	mock.Statms[pid] = &ProcessRawStatm{
		Size:     2000,
		Resident: 1000,
	}
	mock.IOs[pid] = &ProcessRawIO{
		ReadBytes:  1048576,
		WriteBytes: 524288,
		ReadCalls:  100,
		WriteCalls: 50,
	}
	mock.FDCounts[pid] = 42

	tracker := NewProcessStateTracker(mock)

	// First sample (initialization)
	m1, err := tracker.Sample(pid)
	if err != nil {
		t.Fatalf("first sample failed: %v", err)
	}

	if m1.RSSBytes != 1000*4096 {
		t.Errorf("m1.RSSBytes = %d, want %d", m1.RSSBytes, 1000*4096)
	}
	if m1.VMSBytes != 2000*4096 {
		t.Errorf("m1.VMSBytes = %d, want %d", m1.VMSBytes, 2000*4096)
	}
	if m1.PeakRSSBytes != 1000*4096 {
		t.Errorf("m1.PeakRSSBytes = %d, want %d", m1.PeakRSSBytes, 1000*4096)
	}
	if m1.FDCount != 42 {
		t.Errorf("m1.FDCount = %d, want 42", m1.FDCount)
	}
	if m1.ThreadCount != 8 {
		t.Errorf("m1.ThreadCount = %d, want 8", m1.ThreadCount)
	}

	// Advance time and update stats for delta computation
	time.Sleep(10 * time.Millisecond)
	mock.Stats[pid].UTime = 150
	mock.Stats[pid].STime = 70
	mock.IOs[pid].ReadBytes += 1048576
	mock.IOs[pid].WriteBytes += 524288
	mock.IOs[pid].ReadCalls += 50
	mock.IOs[pid].WriteCalls += 25

	m2, err := tracker.Sample(pid)
	if err != nil {
		t.Fatalf("second sample failed: %v", err)
	}

	if m2.CPUPercent < 0 {
		t.Errorf("m2.CPUPercent should be non-negative, got %f", m2.CPUPercent)
	}
	if m2.ReadBytesSec <= 0 {
		t.Errorf("m2.ReadBytesSec should be positive, got %f", m2.ReadBytesSec)
	}
	if m2.WriteBytesSec <= 0 {
		t.Errorf("m2.WriteBytesSec should be positive, got %f", m2.WriteBytesSec)
	}
	if m2.TotalReadBytes != 2097152 {
		t.Errorf("m2.TotalReadBytes = %d, want 2097152", m2.TotalReadBytes)
	}
}

func TestProcessStateTracker_NonExistentPID(t *testing.T) {
	mock := NewMockProcReader()
	tracker := NewProcessStateTracker(mock)

	_, err := tracker.Sample(99999)
	if err == nil {
		t.Errorf("Sample() non-existent PID should return error")
	}
}
