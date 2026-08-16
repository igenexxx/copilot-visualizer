package hub

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/zhenya/copilot-visualizer/pkg/events"
)

var defaultUpgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for local visualizer dev
	},
}

// Client represents an active WebSocket listener connection.
type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

// Hub maintains the set of active clients and broadcasts events.
type Hub struct {
	mu           sync.RWMutex
	clients      map[*Client]bool
	broadcast    chan []byte
	register     chan *Client
	unregister   chan *Client
	history      []*events.Event
	maxHistory   int
	done         chan struct{}
	closeOnce    sync.Once
	websocketMgr *websocket.Upgrader
}

// NewHub creates a new Hub instance with specified history capacity.
func NewHub(maxHistory int) *Hub {
	if maxHistory <= 0 {
		maxHistory = 200
	}
	h := &Hub{
		clients:      make(map[*Client]bool),
		broadcast:    make(chan []byte, 256),
		register:     make(chan *Client, 32),
		unregister:   make(chan *Client, 32),
		history:      make([]*events.Event, 0, maxHistory),
		maxHistory:   maxHistory,
		done:         make(chan struct{}),
		websocketMgr: &defaultUpgrader,
	}
	go h.run()
	return h
}

// Run loop processes registrations, unregistrations and broadcasts.
func (h *Hub) run() {
	for {
		select {
		case <-h.done:
			h.mu.Lock()
			for client := range h.clients {
				close(client.send)
				if client.conn != nil {
					_ = client.conn.Close()
				}
				delete(h.clients, client)
			}
			h.mu.Unlock()
			return

		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				if client.conn != nil {
					_ = client.conn.Close()
				}
			}
			h.mu.Unlock()

		case message := <-h.broadcast:
			h.mu.Lock()
			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					if client.conn != nil {
						_ = client.conn.Close()
					}
					delete(h.clients, client)
				}
			}
			h.mu.Unlock()
		}
	}
}

// BroadcastEvent publishes an event to all connected clients and appends to history.
func (h *Hub) BroadcastEvent(evt *events.Event) error {
	if evt == nil {
		return nil
	}
	if err := evt.Validate(); err != nil {
		return err
	}

	data, err := json.Marshal(evt)
	if err != nil {
		return err
	}

	h.mu.Lock()
	if len(h.history) >= h.maxHistory {
		h.history = append(h.history[1:], evt)
	} else {
		h.history = append(h.history, evt)
	}
	h.mu.Unlock()

	select {
	case <-h.done:
		return nil
	case h.broadcast <- data:
	}

	return nil
}

// ClientCount returns the current number of active connected clients.
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

// History returns a copy of the event history.
func (h *Hub) History() []*events.Event {
	h.mu.RLock()
	defer h.mu.RUnlock()
	copied := make([]*events.Event, len(h.history))
	copy(copied, h.history)
	return copied
}

// HistoryForSession returns event history filtered for a specific session ID.
func (h *Hub) HistoryForSession(sessionID string) []*events.Event {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if sessionID == "" || sessionID == "global" {
		copied := make([]*events.Event, len(h.history))
		copy(copied, h.history)
		return copied
	}
	var filtered []*events.Event
	for _, evt := range h.history {
		if evt != nil && evt.SessionID == sessionID {
			filtered = append(filtered, evt)
		}
	}
	return filtered
}

// ClearHistory resets the recorded events.
func (h *Hub) ClearHistory() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.history = h.history[:0]
}

// HandleWebSocket upgrades HTTP requests to WebSocket and registers the client.
func (h *Hub) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := h.websocketMgr.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	client := &Client{
		hub:  h,
		conn: conn,
		send: make(chan []byte, 128),
	}

	select {
	case <-h.done:
		_ = conn.Close()
		return
	case h.register <- client:
	}

	go client.writePump()
	go client.readPump()
}

func (c *Client) readPump() {
	defer func() {
		select {
		case <-c.hub.done:
		case c.hub.unregister <- c:
		}
	}()

	c.conn.SetReadLimit(4096)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, _, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(25 * time.Second)
	defer func() {
		ticker.Stop()
		if c.conn != nil {
			_ = c.conn.Close()
		}
	}()

	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// Close gracefully closes the Hub and disconnects all clients.
func (h *Hub) Close() {
	h.closeOnce.Do(func() {
		close(h.done)
	})
}
