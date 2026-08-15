package repotree

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// FolderNode represents a high-level repository directory shelf.
type FolderNode struct {
	Name      string   `json:"name"`
	RelPath   string   `json:"relPath"`
	FileCount int      `json:"fileCount"`
	SizeBytes int64    `json:"sizeBytes"`
	FileTypes []string `json:"fileTypes"`
}

// Scanner scans the current repository to identify project shelf compartments.
type Scanner struct {
	rootDir string
}

// NewScanner creates a new repo directory scanner.
func NewScanner(rootDir string) *Scanner {
	if rootDir == "" {
		rootDir = "."
	}
	return &Scanner{rootDir: rootDir}
}

var ignoredDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	".next":        true,
	"dist":         true,
	"build":        true,
	"vendor":       true,
	".gemini":      true,
	".claude":      true,
	".copilot":     true,
	".system_generated": true,
}

// ScanTopLevelFolders returns a list of active top-level directory compartments.
func (s *Scanner) ScanTopLevelFolders() ([]FolderNode, error) {
	entries, err := os.ReadDir(s.rootDir)
	if err != nil {
		return nil, err
	}

	var results []FolderNode

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if ignoredDirs[name] || strings.HasPrefix(name, ".") {
			continue
		}

		fullPath := filepath.Join(s.rootDir, name)
		node := s.analyzeDirectory(name, fullPath)
		if node.FileCount > 0 {
			results = append(results, node)
		}
	}

	// Sort alphabetically
	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})

	return results, nil
}

func (s *Scanner) analyzeDirectory(name, dirPath string) FolderNode {
	node := FolderNode{
		Name:      name,
		RelPath:   name,
		FileTypes: make([]string, 0),
	}

	typeMap := make(map[string]bool)

	_ = filepath.Walk(dirPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			base := filepath.Base(path)
			if ignoredDirs[base] && path != dirPath {
				return filepath.SkipDir
			}
			return nil
		}

		node.FileCount++
		node.SizeBytes += info.Size()

		ext := strings.TrimPrefix(filepath.Ext(path), ".")
		if ext != "" && !typeMap[ext] {
			typeMap[ext] = true
			node.FileTypes = append(node.FileTypes, ext)
		}
		return nil
	})

	sort.Strings(node.FileTypes)
	return node
}
