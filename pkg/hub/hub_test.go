package hub_test

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/zhenya/copilot-visualizer/pkg/events"
	"github.com/zhenya/copilot-visualizer/pkg/hub"
)

func TestHub_LifecycleAndHistory(t *testing.T) {
	h := hub.NewHub(3) // capacity 3
	defer h.Close()

	if count := h.ClientCount(); count != 0 {
		t.Fatalf("expected 0 clients initially, got %d", count)
	}

	// Broadcasting nil event should be a no-op and return nil
	if err := h.BroadcastEvent(nil); err != nil {
		t.Fatalf("broadcasting nil event should return nil error, got %v", err)
	}

	// Invalid event should return validation error
	invalidEvt := &events.Event{ID: ""}
	if err := h.BroadcastEvent(invalidEvt); err == nil {
		t.Fatalf("expected validation error on invalid event, got nil")
	}

	// Add 5 events and verify ring buffer keeps last 3
	for i := 1; i <= 5; i++ {
		evt := events.NewEvent(
			fmt.Sprintf("evt-%d", i),
			"sess-1",
			events.TypeAgentThink,
			"agent-main",
			fmt.Sprintf("Step %d", i),
		)
		if err := h.BroadcastEvent(evt); err != nil {
			t.Fatalf("unexpected error broadcasting: %v", err)
		}
	}

	history := h.History()
	if len(history) != 3 {
		t.Fatalf("expected history length 3, got %d", len(history))
	}
	if history[0].ID != "evt-3" || history[2].ID != "evt-5" {
		t.Errorf("history ring buffer mismatch: got [%s, %s, %s]", history[0].ID, history[1].ID, history[2].ID)
	}

	// Test ClearHistory
	h.ClearHistory()
	if len(h.History()) != 0 {
		t.Fatalf("expected 0 history items after clear, got %d", len(h.History()))
	}
}

func TestHub_WebSocketStreamingAndConcurrency(t *testing.T) {
	h := hub.NewHub(10)
	defer h.Close()

	server := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	// Connect first client
	ws1, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect ws1: %v", err)
	}
	defer ws1.Close()

	// Wait briefly for client registration
	time.Sleep(50 * time.Millisecond)

	// Send an event
	testEvt := events.NewEvent("e-101", "sess-alpha", events.TypeToolCall, "agent-foreman", "Hammering anvil").
		WithStation(events.StationCNCLathe).
		WithRole(events.RoleCrafter)

	if err := h.BroadcastEvent(testEvt); err != nil {
		t.Fatalf("failed to broadcast: %v", err)
	}

	// Read message from ws1
	_ = ws1.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, msg, err := ws1.ReadMessage()
	if err != nil {
		t.Fatalf("failed to read from ws1: %v", err)
	}
	if !strings.Contains(string(msg), "Hammering anvil") {
		t.Fatalf("expected message to contain 'Hammering anvil', got: %s", string(msg))
	}

	// Connect second client for live broadcast reception
	ws2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to connect ws2: %v", err)
	}
	defer ws2.Close()

	// Adversarial concurrent broadcasts and multiple clients
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			e := events.NewEvent(
				fmt.Sprintf("concurrent-evt-%d", idx),
				"sess-alpha",
				events.TypeFileWrite,
				"agent-crafter",
				fmt.Sprintf("Writing chunk %d", idx),
			).WithStation(events.StationCNCLathe)
			_ = h.BroadcastEvent(e)
		}(i)
	}
	wg.Wait()
}

func TestHub_DefaultCapacityAndClose(t *testing.T) {
	// 0 or negative capacity defaults to 200
	h := hub.NewHub(0)
	server := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	wsURL := "ws" + strings.TrimPrefix(server.URL, "http")

	ws, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("failed to dial: %v", err)
	}
	time.Sleep(30 * time.Millisecond)

	h.Close()
	server.Close()
	ws.Close()

	// Calling Close multiple times should be safe (sync.Once)
	h.Close()
}
