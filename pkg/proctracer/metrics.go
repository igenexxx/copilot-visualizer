package proctracer

import (
	"sync"
	"time"
)

// ProcessStateTracker tracks process metrics over time to calculate deltas.
type ProcessStateTracker struct {
	mu           sync.Mutex
	reader       ProcReader
	prevUptime   float64
	prevUTime    uint64
	prevSTime    uint64
	prevIO       ProcessRawIO
	prevTime     time.Time
	peakRSSBytes uint64
	initialized  bool
}

// NewProcessStateTracker creates a new state tracker for a process.
func NewProcessStateTracker(reader ProcReader) *ProcessStateTracker {
	if reader == nil {
		reader = NewDefaultProcReader()
	}
	return &ProcessStateTracker{
		reader: reader,
	}
}

// Sample computes current ResourceMetrics for the given PID.
func (t *ProcessStateTracker) Sample(pid int) (ResourceMetrics, error) {
	t.mu.Lock()
	defer t.mu.Unlock()

	now := time.Now()
	pageSize := t.reader.GetPageSize()
	clockTicks := t.reader.GetClockTicks()

	stat, err := t.reader.ReadStat(pid)
	if err != nil {
		return ResourceMetrics{}, err
	}

	statm, err := t.reader.ReadStatm(pid)
	if err != nil {
		// Fallback to stat RSS if statm fails
		statm = &ProcessRawStatm{
			Resident: uint64(stat.RSSPages),
			Size:     stat.VSize / pageSize,
		}
	}

	ioStat, err := t.reader.ReadIO(pid)
	if err != nil {
		ioStat = &ProcessRawIO{}
	}

	fdCount, _ := t.reader.CountFDs(pid)
	uptime, _ := t.reader.GetSystemUptime()

	rssBytes := statm.Resident * pageSize
	vmsBytes := statm.Size * pageSize

	if rssBytes > t.peakRSSBytes {
		t.peakRSSBytes = rssBytes
	}

	var cpuPercent float64
	var readBytesSec, writeBytesSec float64
	var readSyscallsSec, writeSyscallsSec float64

	if t.initialized && !t.prevTime.IsZero() {
		elapsedSec := now.Sub(t.prevTime).Seconds()
		if elapsedSec > 0 {
			// CPU calculation using clock ticks delta
			procTicksDelta := float64((stat.UTime + stat.STime) - (t.prevUTime + t.prevSTime))
			if clockTicks > 0 {
				cpuPercent = (procTicksDelta / float64(clockTicks) / elapsedSec) * 100.0
				if cpuPercent < 0 {
					cpuPercent = 0
				}
			}

			// Disk I/O rate calculation
			if ioStat.ReadBytes >= t.prevIO.ReadBytes {
				readBytesSec = float64(ioStat.ReadBytes-t.prevIO.ReadBytes) / elapsedSec
			}
			if ioStat.WriteBytes >= t.prevIO.WriteBytes {
				writeBytesSec = float64(ioStat.WriteBytes-t.prevIO.WriteBytes) / elapsedSec
			}
			if ioStat.ReadCalls >= t.prevIO.ReadCalls {
				readSyscallsSec = float64(ioStat.ReadCalls-t.prevIO.ReadCalls) / elapsedSec
			}
			if ioStat.WriteCalls >= t.prevIO.WriteCalls {
				writeSyscallsSec = float64(ioStat.WriteCalls-t.prevIO.WriteCalls) / elapsedSec
			}
		}
	} else {
		t.initialized = true
	}

	t.prevUTime = stat.UTime
	t.prevSTime = stat.STime
	t.prevUptime = uptime
	t.prevIO = *ioStat
	t.prevTime = now

	return ResourceMetrics{
		Timestamp:        now,
		CPUPercent:       cpuPercent,
		RSSBytes:         rssBytes,
		VMSBytes:         vmsBytes,
		PeakRSSBytes:     t.peakRSSBytes,
		ReadBytesSec:     readBytesSec,
		WriteBytesSec:    writeBytesSec,
		ReadSyscallsSec:  readSyscallsSec,
		WriteSyscallsSec: writeSyscallsSec,
		TotalReadBytes:   ioStat.ReadBytes,
		TotalWriteBytes:  ioStat.WriteBytes,
		FDCount:          fdCount,
		ThreadCount:      stat.NumThreads,
	}, nil
}
