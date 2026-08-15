package repotree_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/zhenya/copilot-visualizer/pkg/repotree"
)

func TestScanner_ScanTopLevelFolders(t *testing.T) {
	tmpDir := t.TempDir()

	// Create test folder structure
	pkgDir := filepath.Join(tmpDir, "pkg", "auth")
	cmdDir := filepath.Join(tmpDir, "cmd", "server")
	webDir := filepath.Join(tmpDir, "web", "src")
	gitDir := filepath.Join(tmpDir, ".git")
	emptyDir := filepath.Join(tmpDir, "empty_dir")

	for _, d := range []string{pkgDir, cmdDir, webDir, gitDir, emptyDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatalf("failed to mkdir: %v", err)
		}
	}

	_ = os.WriteFile(filepath.Join(pkgDir, "jwt.go"), []byte("package auth"), 0o644)
	_ = os.WriteFile(filepath.Join(cmdDir, "main.go"), []byte("package main"), 0o644)
	_ = os.WriteFile(filepath.Join(webDir, "app.ts"), []byte("console.log('hi');"), 0o644)
	_ = os.WriteFile(filepath.Join(gitDir, "config"), []byte("git config"), 0o644)

	scanner := repotree.NewScanner(tmpDir)
	folders, err := scanner.ScanTopLevelFolders()
	if err != nil {
		t.Fatalf("unexpected error scanning folders: %v", err)
	}

	if len(folders) != 3 { // pkg, cmd, web (git and empty_dir ignored)
		t.Fatalf("expected 3 folder nodes, got %d", len(folders))
	}

	names := []string{folders[0].Name, folders[1].Name, folders[2].Name}
	if names[0] != "cmd" || names[1] != "pkg" || names[2] != "web" {
		t.Errorf("unexpected folder names sorting: %v", names)
	}

	// Verify file counts
	for _, f := range folders {
		if f.FileCount != 1 {
			t.Errorf("folder %s: expected 1 file, got %d", f.Name, f.FileCount)
		}
		if len(f.FileTypes) == 0 {
			t.Errorf("folder %s: expected file types, got empty", f.Name)
		}
	}
}

func TestScanner_AdversarialInputs(t *testing.T) {
	// 1. Non-existent directory
	scanner := repotree.NewScanner("/non/existent/path/999")
	folders, err := scanner.ScanTopLevelFolders()
	if err == nil || folders != nil {
		t.Errorf("expected error on non-existent directory, got %v / %+v", err, folders)
	}

	// 2. Default scanner constructor with empty string
	sDefault := repotree.NewScanner("")
	if sDefault == nil {
		t.Fatalf("expected valid scanner instance")
	}
}
