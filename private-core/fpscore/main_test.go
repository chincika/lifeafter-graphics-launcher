//go:build windows

package main

import (
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestEmbeddedPatchIntegrity(t *testing.T) {
	cases := []struct {
		name string
		hash string
	}{
		{"patch_original.bin", originalSlotHash},
		{"patch_180.bin", patches[180].hash},
		{"patch_240.bin", patches[240].hash},
		{"patch_300.bin", patches[300].hash},
	}
	for _, item := range cases {
		data, err := loadPatch(item.name, item.hash)
		if err != nil {
			t.Fatalf("%s: %v", item.name, err)
		}
		if len(data) != slotSize {
			t.Fatalf("%s: got %d bytes", item.name, len(data))
		}
	}
}

func TestArchiveMutationRoundTrip(t *testing.T) {
	source := os.Getenv("LIFEAFTER_TEST_NPK")
	if source == "" {
		t.Skip("LIFEAFTER_TEST_NPK not set")
	}
	root := t.TempDir()
	documents := filepath.Join(root, "Documents")
	if err := os.MkdirAll(documents, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "mingrizhihou.exe"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(documents, "script.py314.lc.npk")
	copyFile(t, source, target)
	t.Setenv("LIFEAFTER_PROTECTED_BACKUP_ROOT", filepath.Join(root, "protected"))

	original, err := loadPatch("patch_original.bin", originalSlotHash)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []int{240, 300, 180} {
		definition := patches[value]
		replacement, err := loadPatch(definition.name, definition.hash)
		if err != nil {
			t.Fatal(err)
		}
		if _, changed, err := mutate(root, replacement, definition.hash, original, false); err != nil || !changed {
			t.Fatalf("apply %d: changed=%v err=%v", value, changed, err)
		}
		if notice := autoPrune(root); notice == "" {
			t.Fatal("empty pruning notice")
		}
		assertCurrentSlot(t, target, definition.hash)
	}
	if _, changed, err := mutate(root, original, originalSlotHash, original, true); err != nil || !changed {
		t.Fatalf("restore: changed=%v err=%v", changed, err)
	}
	autoPrune(root)
	assertCurrentSlot(t, target, originalSlotHash)

	status := getStatus(root)
	if !status.OK || !status.BaselineReady || status.State != "original" {
		t.Fatalf("unexpected final status: %+v", status)
	}
	if len(transactionBackups(root)) != 1 {
		t.Fatalf("expected one retained transaction backup")
	}
	if _, err := cleanBackups(root); err != nil {
		t.Fatal(err)
	}
	if len(transactionBackups(root)) != 0 {
		t.Fatalf("manual cleanup retained transaction backups")
	}
	if !fileExists(status.BaselinePath) {
		t.Fatalf("manual cleanup removed permanent baseline")
	}
}

func copyFile(t *testing.T, source, target string) {
	t.Helper()
	input, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.Copy(output, input); err != nil {
		output.Close()
		t.Fatal(err)
	}
	if err = output.Close(); err != nil {
		t.Fatal(err)
	}
}

func assertCurrentSlot(t *testing.T, path, expected string) {
	t.Helper()
	stream, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	record, err := parseArchive(stream)
	if err != nil {
		t.Fatal(err)
	}
	data, err := readAt(stream, record.dataOffset, record.compressedSize)
	if err != nil {
		t.Fatal(err)
	}
	if actual := shaBytes(data); actual != expected {
		t.Fatalf("slot hash %s, expected %s", actual, expected)
	}
}
