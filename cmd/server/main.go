package main

import (
	"context"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/zhenya/copilot-visualizer/pkg/autodiscover"
	"github.com/zhenya/copilot-visualizer/pkg/hub"
	"github.com/zhenya/copilot-visualizer/pkg/intervention"
	"github.com/zhenya/copilot-visualizer/pkg/mcpproxy"
	"github.com/zhenya/copilot-visualizer/pkg/server"
	"github.com/zhenya/copilot-visualizer/pkg/simulator"
	"github.com/zhenya/copilot-visualizer/pkg/tailer"
	"github.com/zhenya/copilot-visualizer/web"
)

func main() {
	port := flag.Int("port", 9876, "HTTP and WebSocket server port")
	tailPath := flag.String("tail", "", "Optional log file to tail (JSONL)")
	runMCPProxy := flag.Bool("mcp-proxy", false, "Run as an MCP stdio proxy shim")
	autoDiscover := flag.Bool("auto-discover", true, "Auto-discover active Antigravity / Copilot / Claude sessions")
	demoMode := flag.Bool("demo", false, "Start simulated demo scenario loop (default: auto-discover live sessions)")
	customStaticDir := flag.String("static", "", "Optional custom static directory override (defaults to embedded UI)")
	flag.Parse()

	eventHub := hub.NewHub(500)
	sim := simulator.New(eventHub)
	intervMgr := intervention.NewManager(eventHub)

	// Initialize Auto-Discovery Engine
	engine := autodiscover.NewEngine(eventHub, nil)
	if *autoDiscover {
		ctx := context.Background()
		engine.StartWatcher(ctx)
		log.Println("🔍 Auto-Discovery engine started. Watching Antigravity, Claude Code & Copilot sessions...")
	}

	// If MCP proxy mode is requested via CLI stdin/stdout
	if *runMCPProxy {
		proxy := mcpproxy.New(eventHub, fmt.Sprintf("mcp-sess-%d", time.Now().Unix()))
		go func() {
			_ = proxy.PipeClientToServer(os.Stdin, os.Stdout)
		}()
	}

	// If a tail file is explicitly supplied
	if *tailPath != "" {
		t := tailer.New(eventHub, "tail-session")
		go func() {
			ctx := context.Background()
			log.Printf("Starting log tailer on %s...", *tailPath)
			if err := t.TailFile(ctx, *tailPath); err != nil {
				log.Printf("Tailer error: %v", err)
			}
		}()
	}

	if *demoMode {
		sim.Start(true) // loop demo scenarios
		log.Println("Demo scenario simulation started.")
	}

	// Static filesystem: use custom directory override or embedded web/dist
	var staticFS fs.FS
	if *customStaticDir != "" {
		staticFS = os.DirFS(*customStaticDir)
	} else {
		embeddedFS, err := web.DistFS()
		if err != nil {
			log.Fatalf("Failed to initialize embedded web filesystem: %v", err)
		}
		staticFS = embeddedFS
	}

	srvHandler := server.NewServer(eventHub, sim, engine, intervMgr, staticFS)
	httpServer := &http.Server{
		Addr:         fmt.Sprintf(":%d", *port),
		Handler:      srvHandler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
	}

	go func() {
		log.Printf("🏭 Copilot Visualizer running at http://localhost:%d", *port)
		log.Printf("🔌 WebSocket live stream at ws://localhost:%d/ws", *port)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Graceful shutdown handling
	stopChan := make(chan os.Signal, 1)
	signal.Notify(stopChan, os.Interrupt, syscall.SIGTERM)
	<-stopChan

	log.Println("Shutting down gracefully...")
	engine.StopWatcher()
	sim.Stop()
	eventHub.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
	log.Println("Shutdown complete.")
}
