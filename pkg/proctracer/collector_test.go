package proctracer

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestCollector_SampleAndPolling(t *testing.T) {
	mock := NewMockProcReader()
	myPID := os.Getpid()

	mock.Stats[myPID] = &ProcessRawStat{
		PID:        myPID,
		Comm:       "antigravity",
		State:      "S",
		UTime:      10,
		STime:      20,
		NumThreads: 4,
		RSSPages:   500,
	}
	mock.Statms[myPID] = &ProcessRawStatm{
		Size:     1000,
		Resident: 500,
	}
	mock.IOs[myPID] = &ProcessRawIO{
		ReadBytes:  1000,
		WriteBytes: 2000,
	}

	target := TargetProcess{
		PID:   myPID,
		Kind:  TargetKindAntigravity,
		Name:  "antigravity",
		Model: "gemini-3.7-flash",
		Cwd:   "/workspace",
	}

	c := NewCollector(target, mock)

	// Sample once
	snap, err := c.Sample()
	if err != nil {
		t.Fatalf("Sample() error: %v", err)
	}

	if snap.Target.PID != myPID {
		t.Errorf("snap.Target.PID = %d, want %d", snap.Target.PID, myPID)
	}
	if snap.Metrics.RSSBytes != 500*4096 {
		t.Errorf("snap.Metrics.RSSBytes = %d, want %d", snap.Metrics.RSSBytes, 500*4096)
	}

	// Test StartPolling and Stop
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	stream := c.StartPolling(ctx, 30*time.Millisecond)
	var receivedSnapshots int
	for range stream {
		receivedSnapshots++
	}

	if receivedSnapshots == 0 {
		t.Errorf("StartPolling() should have delivered at least 1 snapshot")
	}

	c.Stop()
	if c.GetLatestSnapshot() == nil {
		t.Errorf("GetLatestSnapshot() should return snapshot")
	}
}

func TestCollector_AdversarialInputs(t *testing.T) {
	mock := NewMockProcReader()
	target := TargetProcess{
		PID:  99999, // non-existent PID
		Kind: TargetKindGeneric,
		Name: "unknown",
	}

	c := NewCollector(target, mock)
	snap, err := c.Sample()
	if err != nil {
		t.Fatalf("Sample() on dead PID should not crash, err: %v", err)
	}
	if snap.Target.State != "Terminated" {
		t.Errorf("Target state for dead process should be 'Terminated', got %q", snap.Target.State)
	}
}
