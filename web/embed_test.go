package web_test

import (
	"io/fs"
	"testing"

	"github.com/zhenya/copilot-visualizer/web"
)

func TestDistFS_EmbeddedAssets(t *testing.T) {
	dist, err := web.DistFS()
	if err != nil {
		t.Fatalf("failed to retrieve embedded dist FS: %v", err)
	}

	indexFile, err := dist.Open("index.html")
	if err != nil {
		t.Fatalf("expected index.html in embedded filesystem, got error: %v", err)
	}
	defer indexFile.Close()

	stat, err := indexFile.Stat()
	if err != nil {
		t.Fatalf("failed to stat embedded index.html: %v", err)
	}
	if stat.Size() == 0 {
		t.Errorf("expected non-empty index.html in embedded dist")
	}

	// Adversarial check: opening non-existent asset should return ErrNotExist
	_, err = dist.Open("non-existent-file-xyz.123")
	if err == nil {
		t.Errorf("expected error for non-existent embedded asset, got nil")
	}
	_ = fs.ErrNotExist
}
