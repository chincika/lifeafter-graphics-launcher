package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"embed"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	slotSize     = 110791
	originalSize = 328632
	nameHash     = uint32(4238962030)
	nameID       = uint32(3758457633)
	checksumOne  = uint32(3881385757)
	checksumTwo  = uint32(3180330809)
	compression  = uint32(2)
)

var (
	//go:embed assets/*.dat
	embeddedAssets embed.FS

	transactionName = regexp.MustCompile(`(?i)^script\.py314\.lc\.npk\.\d{8}-\d{6}-\d{3}\.[A-Za-z0-9_-]+\.[0-9A-F]{16}\.bak$`)

	assetKeyLeft = [32]byte{
		0x91, 0x2a, 0x65, 0xd3, 0x08, 0xfe, 0x49, 0x7c,
		0xbb, 0x14, 0x82, 0x5d, 0xe1, 0x37, 0x6a, 0xc0,
		0x73, 0x99, 0x0f, 0xb4, 0xd8, 0x21, 0x56, 0xea,
		0x3c, 0x8d, 0xf2, 0x47, 0xa5, 0x60, 0x1b, 0xce,
	}
	assetKeyRight = [32]byte{
		0x24, 0xf8, 0x91, 0x06, 0xae, 0x43, 0xdc, 0x19,
		0x70, 0xe5, 0x31, 0x8a, 0x4f, 0xcb, 0x12, 0x95,
		0xb7, 0x05, 0xe3, 0x62, 0x1d, 0xcf, 0x88, 0x34,
		0xda, 0x76, 0x09, 0xbe, 0x53, 0x27, 0xf1, 0x68,
	}

	nxpkKey = [16]byte{96, 99, 8, 216, 163, 44, 120, 32, 19, 210, 108, 47, 34, 111, 104, 109}

	assetFiles = map[string]string{
		"patch_original.bin": "a0.dat",
		"patch_180.bin":      "a1.dat",
		"patch_240.bin":      "a2.dat",
		"patch_300.bin":      "a3.dat",
	}
)

type patchDefinition struct {
	target int
	name   string
	hash   string
	label  string
}

var patches = map[int]patchDefinition{
	180: {180, "patch_180.bin", "04E2632BAC975036240B829A89B36D1FC5614D48F880E157C60B77985B5340A1", "120 → 180 FPS"},
	240: {240, "patch_240.bin", "A5B7382EE1C8CDBCA3D34ACD3BE8D93D8E0D588AD2EE7B3278D4E9D97342EEE1", "120 → 240 FPS"},
	300: {300, "patch_300.bin", "DB33FAF0F83F30D7675720F6BA77F4AE09B6E4E8FA460D8177CAB0ACE6F43DA6", "120 → 300 FPS"},
}

const (
	originalSlotHash = "6F9165B65B8E32391E32FBC5174B8CC680E90C33C5887B46999D087ACE8FE050"
	neteaseArchive   = "D28A80EE2F0A209BD24ADE0838848B49FE2D9816946C304D15E9A83FEA6D2738"
	feverArchive     = "BCACC8B1CFD4C4DB6F2B5633069EFDB39A1C8835A2436EAB338FB1B90BD69CC2"
	legacy180        = "4D0997446DBD08E7AF24C536AFA7D5055E29E8EBEEA07300B36CB95B9849B469"
	legacy240        = "15AAC9544494399DDDEF72E8278D00DF492D5D45EE29A1D5FE610AA1896943C4"
)

type archiveRecord struct {
	indexOffset    int64
	recordCount    int
	dataOffset     int64
	compressedSize int
	originalSize   int
	checksum1      uint32
	checksum2      uint32
	compression    uint32
}

type slotState struct {
	ID       string
	Label    string
	Target   int
	Writable bool
}

type compatibilityProfile struct {
	PlatformID    string
	PlatformLabel string
	GameVersion   string
	Normalized    string
	Mode          string
	ModeLabel     string
	ProfileID     string
	Known         bool
}

type statusPayload struct {
	OK                     bool   `json:"ok"`
	Error                  string `json:"error,omitempty"`
	Compatible             bool   `json:"compatible"`
	Writable               bool   `json:"writable"`
	GameRunning            bool   `json:"gameRunning"`
	State                  string `json:"state,omitempty"`
	StateLabel             string `json:"stateLabel,omitempty"`
	Target                 int    `json:"target"`
	PlatformID             string `json:"platformId,omitempty"`
	PlatformLabel          string `json:"platformLabel,omitempty"`
	GameVersion            string `json:"gameVersion,omitempty"`
	CompatibilityMode      string `json:"compatibilityMode,omitempty"`
	CompatibilityLabel     string `json:"compatibilityLabel,omitempty"`
	ProfileID              string `json:"profileId,omitempty"`
	KnownProfile           bool   `json:"knownProfile"`
	PackagePath            string `json:"packagePath,omitempty"`
	PackageRole            string `json:"packageRole,omitempty"`
	PackageHash            string `json:"packageHash,omitempty"`
	NormalizedHash         string `json:"normalizedHash,omitempty"`
	SlotHash               string `json:"slotHash,omitempty"`
	RootPackagePath        string `json:"rootPackagePath,omitempty"`
	RootPackagePresent     bool   `json:"rootPackagePresent"`
	RootPackageReadOnly    bool   `json:"rootPackageReadOnly"`
	RootPackageSize        int64  `json:"rootPackageSize"`
	BackupDir              string `json:"backupDir,omitempty"`
	ProtectedBackupDir     string `json:"protectedBackupDir,omitempty"`
	BaselinePath           string `json:"baselinePath,omitempty"`
	BackupCount            int    `json:"backupCount"`
	TransactionBackupCount int    `json:"transactionBackupCount"`
	BaselineReady          bool   `json:"baselineReady"`
	PackageSize            int64  `json:"packageSize"`
}

func main() {
	if len(os.Args) < 2 {
		fail(errors.New("缺少操作命令"))
	}
	command := strings.ToLower(os.Args[1])
	options, err := parseOptions(os.Args[2:])
	if err != nil {
		fail(err)
	}
	root := strings.TrimSpace(options["root"])
	switch command {
	case "status":
		payload := getStatus(root)
		data, _ := json.Marshal(payload)
		fmt.Println(string(data))
	case "apply":
		target, err := strconv.Atoi(options["target"])
		if err != nil {
			fail(errors.New("帧率目标格式不正确"))
		}
		message, err := apply(root, target)
		if err != nil {
			fail(err)
		}
		fmt.Println(message)
	case "restore":
		message, err := restore(root)
		if err != nil {
			fail(err)
		}
		fmt.Println(message)
	case "clean":
		message, err := cleanBackups(root)
		if err != nil {
			fail(err)
		}
		fmt.Println(message)
	default:
		fail(errors.New("不支持的操作命令"))
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err.Error())
	os.Exit(1)
}

func parseOptions(args []string) (map[string]string, error) {
	result := make(map[string]string)
	for i := 0; i < len(args); i += 2 {
		if i+1 >= len(args) || !strings.HasPrefix(args[i], "--") {
			return nil, errors.New("命令参数不完整")
		}
		result[strings.TrimPrefix(strings.ToLower(args[i]), "--")] = args[i+1]
	}
	return result, nil
}

func validRoot(root string) bool {
	if root == "" {
		return false
	}
	info, err := os.Stat(filepath.Join(root, "Documents"))
	if err != nil || !info.IsDir() {
		return false
	}
	return fileExists(filepath.Join(root, "lifeafter.exe")) ||
		fileExists(filepath.Join(root, "mingrizhihou.exe"))
}

func packagePath(root string) string {
	return filepath.Join(root, "Documents", "script.py314.lc.npk")
}

func backupDirectory(root string) string {
	return filepath.Join(root, "Documents", "fps_unlock_backups")
}

func rootPackagePath(root string) string {
	return filepath.Join(root, "script.py314.lc.npk")
}

func detectPlatform(root string) (string, string) {
	base := strings.ToLower(filepath.Base(filepath.Clean(root)))
	feverMarker := fileExists(filepath.Join(root, "FeverGamesLauncher.exe"))
	if fileExists(filepath.Join(root, "mingrizhihou.exe")) &&
		(base == "mrzh" || feverMarker || !fileExists(filepath.Join(root, "lifeafter.exe"))) {
		return "fever", "发烧平台包体"
	}
	return "netease", "老PC包体"
}

func readGameVersion(root string) string {
	data, err := os.ReadFile(filepath.Join(root, "Documents", "configs", "release_version_config"))
	if err != nil {
		return ""
	}
	value := strings.TrimSpace(string(data))
	runes := []rune(value)
	if len(runes) > 64 {
		value = string(runes[:64])
	}
	return value
}

func buildProfile(root, normalized string) compatibilityProfile {
	platformID, platformLabel := detectPlatform(root)
	normalized = strings.ToUpper(normalized)
	known := (platformID == "fever" && normalized == feverArchive) ||
		(platformID == "netease" && normalized == neteaseArchive)
	mode, label := "auto-compatible", "结构一致 · 自动兼容"
	if known {
		mode, label = "known-profile", "已验证档案"
	}
	return compatibilityProfile{
		PlatformID: platformID, PlatformLabel: platformLabel,
		GameVersion: readGameVersion(root), Normalized: normalized,
		Mode: mode, ModeLabel: label,
		ProfileID: platformID + "-" + normalized[:16], Known: known,
	}
}

func protectedBackupRoot() string {
	if configured := strings.TrimSpace(os.Getenv("LIFEAFTER_PROTECTED_BACKUP_ROOT")); configured != "" {
		if absolute, err := filepath.Abs(configured); err == nil {
			return absolute
		}
	}
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		local = os.TempDir()
	}
	return filepath.Join(local, "LifeAfterGraphicsLauncher", "protected-backups")
}

func installID(root string) string {
	absolute, _ := filepath.Abs(root)
	normalized := strings.ToUpper(strings.TrimRight(absolute, `\/`))
	return shaBytes([]byte(normalized))[:16]
}

func protectedBackupDirectory(root string, profile compatibilityProfile) string {
	return filepath.Join(protectedBackupRoot(), installID(root), profile.ProfileID)
}

func baselinePath(root string, profile compatibilityProfile) string {
	return filepath.Join(
		protectedBackupDirectory(root, profile),
		"script.py314.lc.npk.official-original-"+profile.Normalized[:16]+".bak",
	)
}

func identifyState(hash string) slotState {
	hash = strings.ToUpper(hash)
	if hash == originalSlotHash {
		return slotState{"original", "官方原始 120 FPS", 120, true}
	}
	for _, item := range patches {
		if hash == item.hash {
			return slotState{fmt.Sprintf("conditional-%d", item.target), item.label, item.target, true}
		}
	}
	if hash == legacy180 {
		return slotState{"legacy-180", "旧版全局强制 180 FPS", 180, true}
	}
	if hash == legacy240 {
		return slotState{"legacy-240", "旧版全局强制 240 FPS", 240, true}
	}
	return slotState{"unknown", "未知或其他补丁", 0, false}
}

func getStatus(root string) (payload statusPayload) {
	payload.OK = false
	defer func() {
		if recovered := recover(); recovered != nil {
			payload = statusPayload{OK: false, Error: fmt.Sprint(recovered)}
		}
	}()
	if !validRoot(root) {
		payload.Error = "请先选择有效的游戏目录。"
		return
	}
	targetPath := packagePath(root)
	if !fileExists(targetPath) {
		payload.Error = "未找到 Documents\\script.py314.lc.npk。"
		return
	}
	original, err := loadPatch("patch_original.bin", originalSlotHash)
	if err != nil {
		payload.Error = err.Error()
		return
	}
	stream, err := os.Open(targetPath)
	if err != nil {
		payload.Error = err.Error()
		return
	}
	defer stream.Close()
	record, err := parseArchive(stream)
	if err != nil {
		payload.Error = err.Error()
		return
	}
	current, err := readAt(stream, record.dataOffset, record.compressedSize)
	if err != nil {
		payload.Error = err.Error()
		return
	}
	packageHash, normalized, err := computeArchiveHashes(stream, record, current, original)
	if err != nil {
		payload.Error = err.Error()
		return
	}
	state := identifyState(shaBytes(current))
	profile := buildProfile(root, normalized)
	backups := transactionBackups(root)
	baseline := baselinePath(root, profile)
	info, _ := os.Stat(targetPath)
	baselineReady := fileSize(baseline) == info.Size() && shaFileOrEmpty(baseline) == profile.Normalized
	rootPackage := rootPackagePath(root)
	rootPresent := fileExists(rootPackage)
	gameRunning := isGameRunning()
	extraBackup := 0
	if fileExists(baseline) {
		extraBackup = 1
	}
	payload = statusPayload{
		OK: true, Compatible: state.Writable,
		Writable: state.Writable && !gameRunning, GameRunning: gameRunning,
		State: state.ID, StateLabel: state.Label, Target: state.Target,
		PlatformID: profile.PlatformID, PlatformLabel: profile.PlatformLabel,
		GameVersion: profile.GameVersion, CompatibilityMode: profile.Mode,
		CompatibilityLabel: profile.ModeLabel, ProfileID: profile.ProfileID,
		KnownProfile: profile.Known, PackagePath: targetPath,
		PackageRole: "write-target", PackageHash: packageHash,
		NormalizedHash: normalized, SlotHash: shaBytes(current),
		RootPackagePath: rootPackage, RootPackagePresent: rootPresent,
		RootPackageReadOnly: true, RootPackageSize: fileSize(rootPackage),
		BackupDir:          backupDirectory(root),
		ProtectedBackupDir: protectedBackupDirectory(root, profile),
		BaselinePath:       baseline, BackupCount: len(backups) + extraBackup,
		TransactionBackupCount: len(backups), BaselineReady: baselineReady,
		PackageSize: info.Size(),
	}
	return
}

func apply(root string, target int) (string, error) {
	definition, ok := patches[target]
	if !ok {
		return "", errors.New("仅支持 180、240、300 FPS")
	}
	if err := ensureStopped(); err != nil {
		return "", err
	}
	if !validRoot(root) || !fileExists(packagePath(root)) {
		return "", errors.New("未找到兼容的游戏 NPK 包")
	}
	original, err := loadPatch("patch_original.bin", originalSlotHash)
	if err != nil {
		return "", err
	}
	replacement, err := loadPatch(definition.name, definition.hash)
	if err != nil {
		return "", err
	}
	backup, changed, err := mutate(root, replacement, definition.hash, original, false)
	if err != nil {
		return "", err
	}
	if !changed {
		return "当前已是 " + definition.label + "；永久还原点已校验，无需重复写入。", nil
	}
	cleanup := autoPrune(root)
	return fmt.Sprintf(
		"已启用 %s。游戏内“120 FPS”将实际对应 %d FPS；其他帧率档保持原样。\n写入前完整备份：%s\n%s",
		definition.label, target, backup, cleanup,
	), nil
}

func restore(root string) (string, error) {
	if err := ensureStopped(); err != nil {
		return "", err
	}
	if !validRoot(root) || !fileExists(packagePath(root)) {
		return "", errors.New("未找到兼容的游戏 NPK 包")
	}
	original, err := loadPatch("patch_original.bin", originalSlotHash)
	if err != nil {
		return "", err
	}
	backup, changed, err := mutate(root, original, originalSlotHash, original, true)
	if err != nil {
		return "", err
	}
	if !changed {
		return "当前已经是官方原始 120 FPS 状态；永久还原点已校验。", nil
	}
	return "已恢复官方原始 120 FPS 槽位。\n恢复前完整备份：" + backup + "\n" + autoPrune(root), nil
}

func mutate(root string, replacement []byte, expected string, original []byte, restoring bool) (string, bool, error) {
	targetPath := packagePath(root)
	stream, err := os.OpenFile(targetPath, os.O_RDWR, 0)
	if err != nil {
		return "", false, err
	}
	defer stream.Close()
	record, err := parseArchive(stream)
	if err != nil {
		return "", false, err
	}
	current, err := readAt(stream, record.dataOffset, record.compressedSize)
	if err != nil {
		return "", false, err
	}
	currentHash := shaBytes(current)
	state := identifyState(currentHash)
	if !state.Writable {
		return "", false, errors.New("目标槽位不是已知原版或已审查补丁，拒绝覆盖")
	}
	normalized, err := computeNormalizedHash(stream, record, original)
	if err != nil {
		return "", false, err
	}
	profile := buildProfile(root, normalized)
	baseline := baselinePath(root, profile)
	writeNeeded := currentHash != expected
	if err := ensureCapacity(targetPath, baseline, !fileExists(baseline), writeNeeded); err != nil {
		return "", false, err
	}
	if err := ensureBaseline(stream, record, original, root, profile); err != nil {
		return "", false, err
	}
	if !writeNeeded {
		return "", false, nil
	}
	backup, err := createTransactionBackup(root, state.ID, stream)
	if err != nil {
		return "", false, err
	}
	if err := writeAt(stream, record.dataOffset, replacement); err != nil {
		return "", false, err
	}
	verifyErr := func() error {
		written, err := readAt(stream, record.dataOffset, record.compressedSize)
		if err != nil {
			return err
		}
		if shaBytes(written) != expected {
			return errors.New("写入后槽位哈希校验失败")
		}
		if restoring {
			if shaFileHandle(stream) != profile.Normalized {
				return errors.New("恢复后的完整包体不是官方原始哈希")
			}
		} else {
			verified, err := computeNormalizedHash(stream, record, original)
			if err != nil || verified != profile.Normalized {
				return errors.New("写入后包体一致性校验失败")
			}
		}
		return nil
	}()
	if verifyErr != nil {
		rollbackErr := writeAt(stream, record.dataOffset, current)
		if rollbackErr != nil {
			return "", false, errors.New("写入失败且自动回滚失败，请使用完整 NPK 备份恢复")
		}
		rolledBack, _ := readAt(stream, record.dataOffset, record.compressedSize)
		if shaBytes(rolledBack) != currentHash {
			return "", false, errors.New("写入失败且自动回滚校验失败，请使用完整 NPK 备份恢复")
		}
		return "", false, verifyErr
	}
	return backup, true, nil
}

func cleanBackups(root string) (string, error) {
	if !validRoot(root) {
		return "", errors.New("请先选择有效的游戏目录")
	}
	targetPath := packagePath(root)
	original, err := loadPatch("patch_original.bin", originalSlotHash)
	if err != nil {
		return "", err
	}
	stream, err := os.Open(targetPath)
	if err != nil {
		return "", err
	}
	record, err := parseArchive(stream)
	if err != nil {
		stream.Close()
		return "", err
	}
	current, err := readAt(stream, record.dataOffset, record.compressedSize)
	if err != nil {
		stream.Close()
		return "", err
	}
	if !identifyState(shaBytes(current)).Writable {
		stream.Close()
		return "", errors.New("当前目标槽位未知，拒绝清理事务备份")
	}
	normalized, err := computeNormalizedHash(stream, record, original)
	stream.Close()
	if err != nil {
		return "", err
	}
	profile := buildProfile(root, normalized)
	baseline := baselinePath(root, profile)
	if !fileExists(baseline) {
		return "", errors.New("尚未建立官方初始还原点，拒绝清理事务备份")
	}
	if shaFileOrEmpty(baseline) != profile.Normalized {
		return "", errors.New("官方初始还原点哈希异常，拒绝清理其他备份")
	}
	removed, err := pruneBackups(root, 0)
	if err != nil {
		return "", err
	}
	if removed == 0 {
		return "没有可清理的事务备份；官方初始还原点保持不变。", nil
	}
	return fmt.Sprintf("已清理 %d 份事务备份；官方初始还原点已永久保留。", removed), nil
}

func parseArchive(stream *os.File) (archiveRecord, error) {
	info, err := stream.Stat()
	if err != nil {
		return archiveRecord{}, err
	}
	if info.Size() < 1024*1024 || info.Size() > int64(^uint32(0)) {
		return archiveRecord{}, errors.New("NPK 文件大小不在支持范围")
	}
	encryptedHeader, err := readAt(stream, 0, 32)
	if err != nil {
		return archiveRecord{}, err
	}
	header, err := decryptECB(encryptedHeader)
	if err != nil {
		return archiveRecord{}, err
	}
	if string(header[8:12]) != "NXPK" || readU32(header, 12) != 3 {
		return archiveRecord{}, errors.New("仅支持 NXPK v3 包")
	}
	indexOffset := int64(readU32(header, 16))
	recordCount := int(readU32(header, 20))
	indexSize := int64(recordCount) * 48
	if recordCount <= 0 || recordCount > 500000 || indexOffset < 32 ||
		indexOffset+indexSize != info.Size() || indexSize > int64(^uint(0)>>1) {
		return archiveRecord{}, errors.New("NXPK 索引边界异常")
	}
	encryptedIndex, err := readAt(stream, indexOffset, int(indexSize))
	if err != nil {
		return archiveRecord{}, err
	}
	index, err := decryptECB(encryptedIndex)
	if err != nil {
		return archiveRecord{}, err
	}
	found := archiveRecord{}
	foundCount := 0
	for number := 0; number < recordCount; number++ {
		offset := number * 48
		if readU32(index, offset) != nameHash || readU32(index, offset+4) != nameID {
			continue
		}
		foundCount++
		found = archiveRecord{
			indexOffset: indexOffset, recordCount: recordCount,
			dataOffset:     int64(readU32(index, offset+8)),
			compressedSize: int(readU32(index, offset+12)),
			originalSize:   int(readU32(index, offset+16)),
			checksum1:      readU32(index, offset+20),
			checksum2:      readU32(index, offset+24),
			compression:    readU32(index, offset+28),
		}
		for reserved := 0; reserved < 4; reserved++ {
			if readU32(index, offset+32+reserved*4) != 0 {
				return archiveRecord{}, errors.New("目标记录保留字段发生变化")
			}
		}
	}
	if foundCount != 1 {
		return archiveRecord{}, errors.New("未找到唯一兼容的目标记录")
	}
	if found.compressedSize != slotSize || found.originalSize != originalSize ||
		found.checksum1 != checksumOne || found.checksum2 != checksumTwo ||
		found.compression != compression || found.dataOffset < 32 ||
		found.dataOffset+int64(found.compressedSize) > found.indexOffset {
		return archiveRecord{}, errors.New("目标元数据与已审查版本不一致")
	}
	return found, nil
}

func decryptECB(encrypted []byte) ([]byte, error) {
	if len(encrypted)%aes.BlockSize != 0 {
		return nil, errors.New("NXPK AES 数据未按块对齐")
	}
	block, err := aes.NewCipher(nxpkKey[:])
	if err != nil {
		return nil, err
	}
	output := make([]byte, len(encrypted))
	for offset := 0; offset < len(encrypted); offset += aes.BlockSize {
		block.Decrypt(output[offset:offset+aes.BlockSize], encrypted[offset:offset+aes.BlockSize])
	}
	return output, nil
}

func loadPatch(name, expectedHash string) ([]byte, error) {
	opaqueName, ok := assetFiles[name]
	if !ok {
		return nil, errors.New("内置帧率资源索引异常")
	}
	blob, err := embeddedAssets.ReadFile("assets/" + opaqueName)
	if err != nil {
		return nil, errors.New("内置帧率资源不可用")
	}
	if len(blob) != 4+16+slotSize || string(blob[:4]) != "LAF1" {
		return nil, errors.New("内置帧率资源格式异常")
	}
	key := make([]byte, 32)
	for i := range key {
		key[i] = assetKeyLeft[i] ^ assetKeyRight[i]
	}
	defer bytesFill(key, 0)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	output := make([]byte, slotSize)
	cipher.NewCTR(block, blob[4:20]).XORKeyStream(output, blob[20:])
	if shaBytes(output) != expectedHash {
		return nil, errors.New("内置帧率资源完整性校验失败")
	}
	return output, nil
}

func ensureBaseline(stream *os.File, record archiveRecord, original []byte, root string, profile compatibilityProfile) error {
	directory := protectedBackupDirectory(root, profile)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return err
	}
	baseline := baselinePath(root, profile)
	if fileExists(baseline) {
		if shaFileOrEmpty(baseline) != profile.Normalized {
			return errors.New("官方初始还原点已存在但哈希异常，请先人工检查")
		}
		return nil
	}
	partial := baseline + ".partial"
	_ = os.Remove(partial)
	if err := copyOpenStream(stream, partial); err != nil {
		return err
	}
	backup, err := os.OpenFile(partial, os.O_RDWR, 0)
	if err != nil {
		_ = os.Remove(partial)
		return err
	}
	err = writeAt(backup, record.dataOffset, original)
	if err == nil && shaFileHandle(backup) != profile.Normalized {
		err = errors.New("无法重建经哈希验证的官方初始还原点")
	}
	backup.Close()
	if err != nil {
		_ = os.Remove(partial)
		return err
	}
	if err = os.Rename(partial, baseline); err != nil {
		_ = os.Remove(partial)
		return err
	}
	return nil
}

func createTransactionBackup(root, stateID string, source *os.File) (string, error) {
	directory := backupDirectory(root)
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	sourceHash := shaFileHandle(source)
	safeState := regexp.MustCompile(`[^A-Za-z0-9-]`).ReplaceAllString(stateID, "_")
	now := time.Now()
	timestamp := now.Format("20060102-150405-") + fmt.Sprintf("%03d", now.Nanosecond()/int(time.Millisecond))
	name := fmt.Sprintf(
		"script.py314.lc.npk.%s.%s.%s.bak",
		timestamp, safeState, sourceHash[:16],
	)
	target := filepath.Join(directory, name)
	partial := target + ".partial"
	if err := copyOpenStream(source, partial); err != nil {
		return "", err
	}
	if shaFileOrEmpty(partial) != sourceHash {
		_ = os.Remove(partial)
		return "", errors.New("完整 NPK 备份复制后哈希不一致")
	}
	if err := os.Rename(partial, target); err != nil {
		_ = os.Remove(partial)
		return "", err
	}
	return target, nil
}

func transactionBackups(root string) []string {
	entries, err := os.ReadDir(backupDirectory(root))
	if err != nil {
		return nil
	}
	result := make([]string, 0)
	for _, entry := range entries {
		if !entry.IsDir() && transactionName.MatchString(entry.Name()) {
			result = append(result, filepath.Join(backupDirectory(root), entry.Name()))
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(result)))
	return result
}

func pruneBackups(root string, keep int) (int, error) {
	backups := transactionBackups(root)
	removed := 0
	for index := keep; index < len(backups); index++ {
		if err := os.Remove(backups[index]); err != nil {
			return removed, err
		}
		removed++
	}
	return removed, nil
}

func autoPrune(root string) string {
	removed, err := pruneBackups(root, 1)
	if err != nil {
		return "帧率修改已完成，但自动清理旧备份失败：" + err.Error()
	}
	if removed > 0 {
		return fmt.Sprintf("自动清理了 %d 份旧事务备份；官方初始还原点与最新 1 份备份已保留。", removed)
	}
	return "备份保留策略已确认：官方初始还原点 + 最新 1 份事务备份。"
}

func ensureCapacity(packageFile, baseline string, baselineMissing, transactionNeeded bool) error {
	info, err := os.Stat(packageFile)
	if err != nil {
		return err
	}
	safety := int64(128 * 1024 * 1024)
	gameVolume := filepath.VolumeName(packageFile)
	protectedVolume := filepath.VolumeName(baseline)
	gameRequired := int64(0)
	if transactionNeeded {
		gameRequired = info.Size() + safety
	}
	if baselineMissing && strings.EqualFold(gameVolume, protectedVolume) {
		gameRequired += info.Size()
		if !transactionNeeded {
			gameRequired += safety
		}
	}
	if gameRequired > 0 {
		if err := ensureFree(gameVolume+`\`, uint64(gameRequired), "帧率安全备份"); err != nil {
			return err
		}
	}
	if baselineMissing && !strings.EqualFold(gameVolume, protectedVolume) {
		return ensureFree(protectedVolume+`\`, uint64(info.Size()+safety), "永久还原点")
	}
	return nil
}

func ensureFree(root string, required uint64, purpose string) error {
	free, err := availableDiskBytes(root)
	if err != nil {
		return err
	}
	if free < required {
		return fmt.Errorf("%s空间不足：%s 至少需要 %d MB 可用空间", purpose, root, required/1024/1024)
	}
	return nil
}

func isGameRunning() bool {
	for name := range runningProcessNames() {
		lower := strings.ToLower(name)
		if lower == "lifeafter.exe" || lower == "mingrizhihou.exe" {
			return true
		}
	}
	return false
}

func ensureStopped() error {
	if isGameRunning() {
		return errors.New("请先完全退出游戏，再修改或恢复帧率")
	}
	return nil
}

func computeNormalizedHash(stream *os.File, record archiveRecord, original []byte) (string, error) {
	if _, err := stream.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	hash := sha256.New()
	if _, err := io.CopyN(hash, stream, record.dataOffset); err != nil {
		return "", err
	}
	hash.Write(original)
	if _, err := stream.Seek(record.dataOffset+int64(record.compressedSize), io.SeekStart); err != nil {
		return "", err
	}
	if _, err := io.Copy(hash, stream); err != nil {
		return "", err
	}
	return strings.ToUpper(hex.EncodeToString(hash.Sum(nil))), nil
}

func computeArchiveHashes(stream *os.File, record archiveRecord, current, original []byte) (string, string, error) {
	if len(current) != record.compressedSize || len(original) != record.compressedSize {
		return "", "", errors.New("帧率槽位长度不匹配")
	}
	if _, err := stream.Seek(0, io.SeekStart); err != nil {
		return "", "", err
	}
	actual, normalized := sha256.New(), sha256.New()
	writer := io.MultiWriter(actual, normalized)
	if _, err := io.CopyN(writer, stream, record.dataOffset); err != nil {
		return "", "", err
	}
	actual.Write(current)
	normalized.Write(original)
	if _, err := stream.Seek(record.dataOffset+int64(record.compressedSize), io.SeekStart); err != nil {
		return "", "", err
	}
	if _, err := io.Copy(io.MultiWriter(actual, normalized), stream); err != nil {
		return "", "", err
	}
	return upperHash(actual.Sum(nil)), upperHash(normalized.Sum(nil)), nil
}

func copyOpenStream(source *os.File, target string) error {
	position, _ := source.Seek(0, io.SeekCurrent)
	defer source.Seek(position, io.SeekStart)
	if _, err := source.Seek(0, io.SeekStart); err != nil {
		return err
	}
	output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, source)
	syncErr := output.Sync()
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	if syncErr != nil {
		return syncErr
	}
	return closeErr
}

func readAt(stream *os.File, offset int64, count int) ([]byte, error) {
	data := make([]byte, count)
	_, err := stream.ReadAt(data, offset)
	return data, err
}

func writeAt(stream *os.File, offset int64, data []byte) error {
	if _, err := stream.WriteAt(data, offset); err != nil {
		return err
	}
	return stream.Sync()
}

func readU32(data []byte, offset int) uint32 {
	return binary.LittleEndian.Uint32(data[offset : offset+4])
}

func shaBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return upperHash(sum[:])
}

func shaFileOrEmpty(path string) string {
	stream, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer stream.Close()
	return shaFileHandle(stream)
}

func shaFileHandle(stream *os.File) string {
	position, _ := stream.Seek(0, io.SeekCurrent)
	defer stream.Seek(position, io.SeekStart)
	stream.Seek(0, io.SeekStart)
	hash := sha256.New()
	if _, err := io.Copy(hash, stream); err != nil {
		return ""
	}
	return upperHash(hash.Sum(nil))
}

func upperHash(data []byte) string {
	return strings.ToUpper(hex.EncodeToString(data))
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return info.Size()
}

func bytesFill(data []byte, value byte) {
	for index := range data {
		data[index] = value
	}
}
