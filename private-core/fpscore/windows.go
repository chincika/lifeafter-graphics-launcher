//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

var (
	kernel32                   = syscall.NewLazyDLL("kernel32.dll")
	procCreateToolhelpSnapshot = kernel32.NewProc("CreateToolhelp32Snapshot")
	procProcess32FirstW        = kernel32.NewProc("Process32FirstW")
	procProcess32NextW         = kernel32.NewProc("Process32NextW")
	procCloseHandle            = kernel32.NewProc("CloseHandle")
	procGetDiskFreeSpaceExW    = kernel32.NewProc("GetDiskFreeSpaceExW")
)

const snapshotProcesses = 0x00000002

type processEntry32 struct {
	Size              uint32
	Usage             uint32
	ProcessID         uint32
	DefaultHeapID     uintptr
	ModuleID          uint32
	Threads           uint32
	ParentProcessID   uint32
	PriorityClassBase int32
	Flags             uint32
	ExeFile           [260]uint16
}

func runningProcessNames() map[string]bool {
	result := make(map[string]bool)
	handle, _, _ := procCreateToolhelpSnapshot.Call(snapshotProcesses, 0)
	if handle == uintptr(syscall.InvalidHandle) {
		return result
	}
	defer procCloseHandle.Call(handle)

	var entry processEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	ok, _, _ := procProcess32FirstW.Call(handle, uintptr(unsafe.Pointer(&entry)))
	for ok != 0 {
		result[syscall.UTF16ToString(entry.ExeFile[:])] = true
		entry.Size = uint32(unsafe.Sizeof(entry))
		ok, _, _ = procProcess32NextW.Call(handle, uintptr(unsafe.Pointer(&entry)))
	}
	return result
}

func availableDiskBytes(path string) (uint64, error) {
	ptr, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return 0, err
	}
	var free uint64
	ok, _, callErr := procGetDiskFreeSpaceExW.Call(
		uintptr(unsafe.Pointer(ptr)),
		uintptr(unsafe.Pointer(&free)),
		0,
		0,
	)
	if ok == 0 {
		return 0, callErr
	}
	return free, nil
}
