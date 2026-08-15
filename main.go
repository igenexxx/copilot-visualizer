package main

import (
	"embed"
	"flag"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:web/dist
var assets embed.FS

func main() {
	demoFlag := flag.Bool("demo", false, "Run in simulated demo mode")
	flag.Parse()

	// Create an instance of the app structure
	app := NewApp(*demoFlag)

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "Copilot Visualizer — Cyberpunk Agent Observability",
		Width:     1440,
		Height:    900,
		MinWidth:  1024,
		MinHeight: 680,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 11, G: 15, B: 25, A: 255},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			BackdropType:         windows.Mica,
		},
		Linux: &linux.Options{
			ProgramName: "copilot-visualizer",
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
