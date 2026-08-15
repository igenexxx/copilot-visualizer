package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// DistFS returns an fs.FS sub-filesystem pointing to the built dist/ web assets.
func DistFS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
