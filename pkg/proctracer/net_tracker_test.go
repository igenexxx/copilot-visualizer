package proctracer

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCategorizeEndpoint(t *testing.T) {
	tests := []struct {
		name     string
		host     string
		ip       string
		port     int
		wantCat  string
	}{
		{
			name:    "GitHub Copilot API",
			host:    "api.githubcopilot.com",
			ip:      "140.82.112.21",
			port:    443,
			wantCat: "GitHub Copilot API",
		},
		{
			name:    "Anthropic Claude API",
			host:    "api.anthropic.com",
			ip:      "104.18.2.1",
			port:    443,
			wantCat: "Anthropic Claude API",
		},
		{
			name:    "Google Gemini API",
			host:    "generativelanguage.googleapis.com",
			ip:      "142.250.180.10",
			port:    443,
			wantCat: "Google Gemini API",
		},
		{
			name:    "OpenAI API",
			host:    "api.openai.com",
			ip:      "13.107.4.2",
			port:    443,
			wantCat: "OpenAI / Azure API",
		},
		{
			name:    "Local LSP Socket",
			host:    "localhost",
			ip:      "127.0.0.1",
			port:    9999,
			wantCat: "Local IPC / LSP Socket",
		},
		{
			name:    "Generic HTTPS",
			host:    "example.com",
			ip:      "93.184.216.34",
			port:    443,
			wantCat: "Secure HTTPS Endpoint",
		},
		{
			name:    "Other TCP Port",
			host:    "internal.net",
			ip:      "192.168.1.50",
			port:    8080,
			wantCat: "Network Socket",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := CategorizeEndpoint(tc.host, tc.ip, tc.port)
			if got != tc.wantCat {
				t.Errorf("CategorizeEndpoint(%q, %q, %d) = %q, want %q", tc.host, tc.ip, tc.port, got, tc.wantCat)
			}
		})
	}
}

func TestNetworkTracker_MockProc(t *testing.T) {
	tempDir := t.TempDir()
	pidDir := filepath.Join(tempDir, "42")
	fdDir := filepath.Join(pidDir, "fd")
	netDir := filepath.Join(pidDir, "net")
	if err := os.MkdirAll(fdDir, 0755); err != nil {
		t.Fatalf("failed to create fd dir: %v", err)
	}
	if err := os.MkdirAll(netDir, 0755); err != nil {
		t.Fatalf("failed to create net dir: %v", err)
	}

	// Create symlink in fd: "3" -> "socket:[987654]"
	// In temp directory we can create mock symlinks
	_ = os.Symlink("socket:[987654]", filepath.Join(fdDir, "3"))

	// Create /net/tcp content with inode 987654
	// 0100007F:1F90 = 127.0.0.1:8080, 0100007F:01BB = 127.0.0.1:443, state 01 (ESTABLISHED), inode 987654
	tcpContent := `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 0100007F:01BB 01 00000000:00000000 00:00000000 00000000  1000        0 987654 1 0000000000000000 100 0 0 10 0
`
	_ = os.WriteFile(filepath.Join(netDir, "tcp"), []byte(tcpContent), 0644)

	tracker := NewNetworkTracker(tempDir)
	conns, err := tracker.GetProcessConnections(42)
	if err != nil {
		t.Fatalf("GetProcessConnections(42) error: %v", err)
	}

	if len(conns) != 1 {
		t.Fatalf("conns count = %d, want 1", len(conns))
	}

	conn := conns[0]
	if conn.State != "ESTABLISHED" {
		t.Errorf("conn.State = %q, want 'ESTABLISHED'", conn.State)
	}
	if conn.RemotePort != 443 {
		t.Errorf("conn.RemotePort = %d, want 443", conn.RemotePort)
	}
	if conn.ServiceCategory != "Local IPC / LSP Socket" {
		t.Errorf("conn.ServiceCategory = %q, want 'Local IPC / LSP Socket'", conn.ServiceCategory)
	}
}

func TestParseHexAddr(t *testing.T) {
	// IPv4 127.0.0.1:8080 -> 0100007F:1F90
	ip, port := parseHexAddr("0100007F:1F90")
	if ip != "127.0.0.1" || port != 8080 {
		t.Errorf("parseHexAddr(0100007F:1F90) = (%s, %d), want (127.0.0.1, 8080)", ip, port)
	}

	// Invalid format
	ipBad, portBad := parseHexAddr("invalid")
	if ipBad != "unknown" || portBad != 0 {
		t.Errorf("parseHexAddr(invalid) = (%s, %d), want (unknown, 0)", ipBad, portBad)
	}
}

func TestParseTCPState(t *testing.T) {
	states := map[string]string{
		"01": "ESTABLISHED",
		"02": "SYN_SENT",
		"03": "SYN_RECV",
		"04": "FIN_WAIT1",
		"05": "FIN_WAIT2",
		"06": "TIME_WAIT",
		"07": "CLOSE",
		"08": "CLOSE_WAIT",
		"09": "LAST_ACK",
		"0A": "LISTEN",
		"0B": "CLOSING",
		"FF": "UNKNOWN",
	}

	for hexCode, want := range states {
		got := parseTCPState(hexCode)
		if got != want {
			t.Errorf("parseTCPState(%q) = %q, want %q", hexCode, got, want)
		}
	}
}

func TestNetworkTracker_ResolveHost(t *testing.T) {
	tracker := NewNetworkTracker()
	if host := tracker.resolveHost("127.0.0.1"); host != "localhost" {
		t.Errorf("resolveHost(127.0.0.1) = %q, want 'localhost'", host)
	}
	if host := tracker.resolveHost("0.0.0.0"); host != "localhost" {
		t.Errorf("resolveHost(0.0.0.0) = %q, want 'localhost'", host)
	}
}
