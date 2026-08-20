package proctracer

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// NetworkTracker tracks active sockets and endpoints for a process.
type NetworkTracker struct {
	mu       sync.RWMutex
	dnsCache map[string]string
	procRoot string
}

// NewNetworkTracker creates a new tracker for network activity.
func NewNetworkTracker(procRoot ...string) *NetworkTracker {
	root := "/proc"
	if len(procRoot) > 0 && procRoot[0] != "" {
		root = procRoot[0]
	}
	return &NetworkTracker{
		dnsCache: make(map[string]string),
		procRoot: root,
	}
}

// GetProcessConnections returns active TCP connections for the target PID.
func (nt *NetworkTracker) GetProcessConnections(pid int) ([]NetworkEndpoint, error) {
	socketInodes, err := nt.getProcessSocketInodes(pid)
	if err != nil {
		return nil, err
	}
	if len(socketInodes) == 0 {
		return nil, nil
	}

	var endpoints []NetworkEndpoint

	// Read /proc/<pid>/net/tcp and /proc/<pid>/net/tcp6
	tcpPaths := []string{
		filepath.Join(nt.procRoot, strconv.Itoa(pid), "net", "tcp"),
		filepath.Join(nt.procRoot, strconv.Itoa(pid), "net", "tcp6"),
	}

	for _, p := range tcpPaths {
		eps, err := nt.parseTCPFile(p, socketInodes)
		if err == nil {
			endpoints = append(endpoints, eps...)
		}
	}

	// Fallback to /proc/net/tcp if per-pid net is not available
	if len(endpoints) == 0 {
		fallbackPaths := []string{
			filepath.Join(nt.procRoot, "net", "tcp"),
			filepath.Join(nt.procRoot, "net", "tcp6"),
		}
		for _, p := range fallbackPaths {
			eps, err := nt.parseTCPFile(p, socketInodes)
			if err == nil {
				endpoints = append(endpoints, eps...)
			}
		}
	}

	return endpoints, nil
}

func (nt *NetworkTracker) getProcessSocketInodes(pid int) (map[uint64]bool, error) {
	fdDir := filepath.Join(nt.procRoot, strconv.Itoa(pid), "fd")
	entries, err := os.ReadDir(fdDir)
	if err != nil {
		return nil, err
	}

	inodes := make(map[uint64]bool)
	for _, entry := range entries {
		link, err := os.Readlink(filepath.Join(fdDir, entry.Name()))
		if err != nil {
			continue
		}
		// Format: "socket:[123456]"
		if strings.HasPrefix(link, "socket:[") && strings.HasSuffix(link, "]") {
			inodeStr := link[len("socket:[") : len(link)-1]
			inode, err := strconv.ParseUint(inodeStr, 10, 64)
			if err == nil {
				inodes[inode] = true
			}
		}
	}
	return inodes, nil
}

func (nt *NetworkTracker) parseTCPFile(filePath string, socketInodes map[uint64]bool) ([]NetworkEndpoint, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var endpoints []NetworkEndpoint
	scanner := bufio.NewScanner(bytes.NewReader(data))
	// Skip header line
	if !scanner.Scan() {
		return nil, nil
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		fields := strings.Fields(line)
		if len(fields) < 10 {
			continue
		}

		// Field index 9 is the inode
		inode, err := strconv.ParseUint(fields[9], 10, 64)
		if err != nil || !socketInodes[inode] {
			continue
		}

		localAddr, localPort := parseHexAddr(fields[1])
		remoteAddr, remotePort := parseHexAddr(fields[2])
		state := parseTCPState(fields[3])

		// Parse tx_queue:rx_queue (field 4)
		var txQueue, rxQueue int
		qParts := strings.Split(fields[4], ":")
		if len(qParts) == 2 {
			txHex, _ := strconv.ParseInt(qParts[0], 16, 32)
			rxHex, _ := strconv.ParseInt(qParts[1], 16, 32)
			txQueue = int(txHex)
			rxQueue = int(rxHex)
		}

		host := nt.resolveHost(remoteAddr)
		category := CategorizeEndpoint(host, remoteAddr, remotePort)

		endpoints = append(endpoints, NetworkEndpoint{
			LocalAddr:       fmt.Sprintf("%s:%d", localAddr, localPort),
			RemoteAddr:      fmt.Sprintf("%s:%d", remoteAddr, remotePort),
			RemoteHost:      host,
			RemotePort:      remotePort,
			Protocol:        "TCP",
			State:           state,
			ServiceCategory: category,
			TxQueue:         txQueue,
			RxQueue:         rxQueue,
		})
	}

	return endpoints, nil
}

func parseHexAddr(s string) (string, int) {
	parts := strings.Split(s, ":")
	if len(parts) != 2 {
		return "unknown", 0
	}

	hexIP := parts[0]
	portHex, _ := strconv.ParseInt(parts[1], 16, 32)
	port := int(portHex)

	ipBytes, err := hex.DecodeString(hexIP)
	if err != nil {
		return "unknown", port
	}

	if len(ipBytes) == 4 {
		// IPv4 in little-endian order
		ip := net.IPv4(ipBytes[3], ipBytes[2], ipBytes[1], ipBytes[0])
		return ip.String(), port
	} else if len(ipBytes) == 16 {
		// IPv6 formatted as 4 32-bit words in little-endian
		var words [4]uint32
		for i := 0; i < 4; i++ {
			words[i] = binary.LittleEndian.Uint32(ipBytes[i*4 : (i+1)*4])
		}
		var out [16]byte
		for i := 0; i < 4; i++ {
			binary.BigEndian.PutUint32(out[i*4:(i+1)*4], words[i])
		}
		ip := net.IP(out[:])
		return ip.String(), port
	}

	return "unknown", port
}

func parseTCPState(hexState string) string {
	stateVal, _ := strconv.ParseInt(hexState, 16, 32)
	switch stateVal {
	case 1:
		return "ESTABLISHED"
	case 2:
		return "SYN_SENT"
	case 3:
		return "SYN_RECV"
	case 4:
		return "FIN_WAIT1"
	case 5:
		return "FIN_WAIT2"
	case 6:
		return "TIME_WAIT"
	case 7:
		return "CLOSE"
	case 8:
		return "CLOSE_WAIT"
	case 9:
		return "LAST_ACK"
	case 10:
		return "LISTEN"
	case 11:
		return "CLOSING"
	default:
		return "UNKNOWN"
	}
}

func (nt *NetworkTracker) resolveHost(ipStr string) string {
	if ipStr == "0.0.0.0" || ipStr == "127.0.0.1" || ipStr == "::1" || ipStr == "::" {
		return "localhost"
	}

	nt.mu.RLock()
	if cached, ok := nt.dnsCache[ipStr]; ok {
		nt.mu.RUnlock()
		return cached
	}
	nt.mu.RUnlock()

	// Asynchronous reverse lookup with quick fallback
	go func(ip string) {
		names, err := net.LookupAddr(ip)
		resolved := ip
		if err == nil && len(names) > 0 {
			resolved = strings.TrimSuffix(names[0], ".")
		}
		nt.mu.Lock()
		nt.dnsCache[ip] = resolved
		nt.mu.Unlock()
	}(ipStr)

	return ipStr
}

// CategorizeEndpoint classifies an endpoint into known AI service categories.
func CategorizeEndpoint(host, ip string, port int) string {
	combined := strings.ToLower(host + " " + ip)

	switch {
	case strings.Contains(combined, "githubcopilot") || strings.Contains(combined, "copilot-proxy") || strings.Contains(combined, "github.com"):
		return "GitHub Copilot API"
	case strings.Contains(combined, "anthropic.com") || strings.Contains(combined, "claude"):
		return "Anthropic Claude API"
	case strings.Contains(combined, "googleapis.com") || strings.Contains(combined, "1e100.net") || strings.Contains(combined, "google"):
		return "Google Gemini API"
	case strings.Contains(combined, "openai.com") || strings.Contains(combined, "azure.com"):
		return "OpenAI / Azure API"
	case ip == "127.0.0.1" || ip == "::1" || host == "localhost":
		return "Local IPC / LSP Socket"
	case port == 443:
		return "Secure HTTPS Endpoint"
	default:
		return "Network Socket"
	}
}
