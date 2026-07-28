using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("FPS Slot Lab")]
[assembly: System.Reflection.AssemblyDescription("LifeAfter NXPK frame-rate slot test tool")]
[assembly: System.Reflection.AssemblyCompany("Local research build")]
[assembly: System.Reflection.AssemblyProduct("FPS Slot Lab")]
[assembly: System.Reflection.AssemblyVersion("0.1.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("0.1.0.0")]

internal sealed class PatchInfo
{
    public int Fps;
    public string FileName;
    public string Sha256;
}

internal sealed class GameLocation
{
    public string Root;
    public string ArchivePath;
    public string LauncherPath;
}

internal sealed class NxpkInfo
{
    public long IndexOffset;
    public int RecordCount;
    public long DataOffset;
    public int CompressedSize;
    public int OriginalSize;
    public uint Checksum1;
    public uint Checksum2;
    public uint CompressionType;
}

internal class OperationResult
{
    public bool Success;
    public string Error;
    public string Message;
}

internal sealed class AnalysisResult : OperationResult
{
    public GameLocation Location;
    public int? CurrentFps;
    public string SlotHash;
    public NxpkInfo Nxpk;
    public bool GameRunning;
    public bool FirstBackupAvailable;
}

internal sealed class FpsEngine
{
    private const int SlotSize = 111676;
    private const int OriginalSize = 332550;
    private const uint TargetNameHash = 4238962030;
    private const uint TargetNameId = 3758457633;
    private const uint ExpectedChecksum1 = 2755559603;
    private const uint ExpectedChecksum2 = 618724858;
    private const uint ExpectedCompressionType = 2;

    private static readonly byte[] NxpkKey = new byte[]
    {
        96, 99, 8, 216, 163, 44, 120, 32, 19, 210, 108, 47, 34, 111, 104, 109
    };

    private readonly Dictionary<int, PatchInfo> patches = new Dictionary<int, PatchInfo>
    {
        { 120, new PatchInfo { Fps = 120, FileName = "patch_120.bin", Sha256 = "09ED5C1467290A57DFEE9FF2884D5E66039F84A0B7519BA9164E2BBD894B05C1" } },
        { 260, new PatchInfo { Fps = 260, FileName = "patch_260.bin", Sha256 = "31CCA23BC705D68FCA8E2F949770FD8CACF76F0E0F2F2A644CFFF7FDF0AE767A" } },
        { 280, new PatchInfo { Fps = 280, FileName = "patch_280.bin", Sha256 = "D9AD71BDBCFCB8C3E67539EF97697E7B6F7C51DB1BD35BFC0D9CF6A7BB7BB03E" } },
        { 300, new PatchInfo { Fps = 300, FileName = "patch_300.bin", Sha256 = "E0F11E6E4C82B328902654C58FC512EDF8881AB4ED2AE414964AB26B680FA2AB" } },
        { 360, new PatchInfo { Fps = 360, FileName = "patch_360.bin", Sha256 = "7C3A4F0DF6E6303EF66A0852345FF185E42BE43D277754BBBA1F85AF05BD405D" } }
    };

    public string PatchDirectory
    {
        get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "patches"); }
    }

    public string DataDirectory
    {
        get
        {
            string overridePath = Environment.GetEnvironmentVariable("FPS_SLOT_LAB_DATA_DIR");
            if (!String.IsNullOrWhiteSpace(overridePath)) return Path.GetFullPath(overridePath);
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FPS Slot Lab");
        }
    }

    public string SavedRootPath
    {
        get { return Path.Combine(DataDirectory, "game-root.txt"); }
    }

    public GameLocation NormalizeGameRoot(string candidate)
    {
        if (String.IsNullOrWhiteSpace(candidate)) return null;
        string current;
        try
        {
            current = Path.GetFullPath(candidate.Trim().Trim('"'));
            if (File.Exists(current)) current = Path.GetDirectoryName(current);
        }
        catch
        {
            return null;
        }

        for (int i = 0; i < 8 && !String.IsNullOrEmpty(current); i++)
        {
            string archive = Path.Combine(current, @"Documents\script.py314.lc.npk");
            string launcher = Path.Combine(current, "mingrizhihou.exe");
            bool hasGameExe =
                File.Exists(Path.Combine(current, "lifeafter.exe")) ||
                File.Exists(Path.Combine(current, @"Documents\bin\x64\lifeafter.exe")) ||
                File.Exists(Path.Combine(current, @"Documents\bin\x64-3\lifeafter.exe")) ||
                File.Exists(Path.Combine(current, @"Documents\bin\x64-win7\lifeafter.exe"));

            if (File.Exists(archive) && File.Exists(launcher) && hasGameExe)
            {
                return new GameLocation
                {
                    Root = current,
                    ArchivePath = archive,
                    LauncherPath = launcher
                };
            }

            DirectoryInfo parent;
            try { parent = Directory.GetParent(current); }
            catch { break; }
            if (parent == null || parent.FullName == current) break;
            current = parent.FullName;
        }

        return null;
    }

    public GameLocation FindGame()
    {
        try
        {
            if (File.Exists(SavedRootPath))
            {
                GameLocation saved = NormalizeGameRoot(File.ReadAllText(SavedRootPath, Encoding.UTF8));
                if (saved != null) return saved;
            }
        }
        catch { }

        string[] directNames = new string[] { "LifeAfter", "明日之后" };
        string[] parents = new string[] { "", "Games", "Game", "NetEase", "网易游戏" };
        foreach (DriveInfo drive in DriveInfo.GetDrives())
        {
            if (!drive.IsReady || drive.DriveType != DriveType.Fixed) continue;
            foreach (string parent in parents)
            {
                foreach (string name in directNames)
                {
                    string candidate = String.IsNullOrEmpty(parent)
                        ? Path.Combine(drive.RootDirectory.FullName, name)
                        : Path.Combine(drive.RootDirectory.FullName, parent, name);
                    GameLocation found = NormalizeGameRoot(candidate);
                    if (found != null) return found;
                }
            }
        }
        return null;
    }

    public void SaveGameRoot(string root)
    {
        Directory.CreateDirectory(DataDirectory);
        File.WriteAllText(SavedRootPath, root, new UTF8Encoding(false));
    }

    public bool IsGameRunning()
    {
        Process[] processes = new Process[0];
        try
        {
            processes = Process.GetProcessesByName("lifeafter");
            return processes.Length > 0;
        }
        finally
        {
            foreach (Process process in processes) process.Dispose();
        }
    }

    public AnalysisResult Analyze(string candidate)
    {
        AnalysisResult result = new AnalysisResult();
        try
        {
            GameLocation location = NormalizeGameRoot(candidate);
            if (location == null) throw new InvalidOperationException("所选目录不是受支持的《明日之后》PC 安装目录。");
            ValidateAllPatchFiles();

            using (FileStream stream = new FileStream(location.ArchivePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            {
                NxpkInfo info = ParseNxpk(stream);
                byte[] slot = ReadSlot(stream, info);
                string hash = Sha256(slot);
                result.CurrentFps = KnownFps(hash);
                result.SlotHash = hash;
                result.Nxpk = info;
            }

            result.Success = true;
            result.Location = location;
            result.GameRunning = IsGameRunning();
            result.FirstBackupAvailable = File.Exists(GetFirstBackupPath(location.ArchivePath));
            result.Message = result.CurrentFps.HasValue
                ? "已识别 " + result.CurrentFps.Value.ToString(CultureInfo.InvariantCulture) + " FPS 槽。"
                : "目标槽哈希不属于本工具的已知补丁，已锁定写入。";
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Error = ex.Message;
        }
        return result;
    }

    public OperationResult Apply(string candidate, int fps, IProgress<string> progress)
    {
        OperationResult result = new OperationResult();
        try
        {
            if (fps != 260 && fps != 280 && fps != 300 && fps != 360)
                throw new InvalidOperationException("只允许测试 260、280、300、360 FPS。");

            GameLocation location = NormalizeGameRoot(candidate);
            if (location == null) throw new InvalidOperationException("游戏目录无效。");
            if (IsGameRunning()) throw new InvalidOperationException("检测到 lifeafter.exe 正在运行。请完全退出游戏后重试。");

            Report(progress, "验证五份补丁的完整 SHA-256。");
            ValidateAllPatchFiles();
            byte[] targetPatch = LoadPatch(fps);
            byte[] reference120 = LoadPatch(120);
            Dictionary<string, string> configBefore = HashProtectedConfigs(location.Root);

            Report(progress, "以独占方式打开游戏 NPK。");
            using (FileStream stream = new FileStream(
                location.ArchivePath,
                FileMode.Open,
                FileAccess.ReadWrite,
                FileShare.None,
                1024 * 1024,
                FileOptions.RandomAccess))
            {
                NxpkInfo info = ParseNxpk(stream);
                byte[] current = ReadSlot(stream, info);
                string currentHash = Sha256(current);
                int? currentFps = KnownFps(currentHash);
                if (!currentFps.HasValue)
                    throw new InvalidOperationException("当前槽位不是已知状态。为避免破坏更新后的游戏包，拒绝写入。");
                if (currentFps.Value == fps)
                    throw new InvalidOperationException("当前已经是 " + fps.ToString(CultureInfo.InvariantCulture) + " FPS。");

                Report(progress, "当前状态：" + currentFps.Value.ToString(CultureInfo.InvariantCulture) + " FPS。");
                Report(progress, "计算目标槽外的归一化整包 SHA-256。");
                string baseline = ComputeNormalizedHash(stream, info, reference120);

                Report(progress, "保存首次观测槽和本次事务备份。");
                SaveBackups(location.ArchivePath, current, currentFps.Value);

                bool writeStarted = false;
                try
                {
                    Report(progress, "原位写入 " + fps.ToString(CultureInfo.InvariantCulture) + " FPS 槽。");
                    writeStarted = true;
                    WriteSlot(stream, info, targetPatch);

                    Report(progress, "回读并校验完整补丁 SHA-256。");
                    byte[] written = ReadSlot(stream, info);
                    if (!Sha256(written).Equals(patches[fps].Sha256, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("写后槽位 SHA-256 不匹配。");

                    Report(progress, "校验目标槽以外的整个 NPK 未发生变化。");
                    string afterBaseline = ComputeNormalizedHash(stream, info, reference120);
                    if (!baseline.Equals(afterBaseline, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("目标槽之外的 NPK 内容发生变化。");

                    Dictionary<string, string> configAfter = HashProtectedConfigs(location.Root);
                    EnsureConfigHashesUnchanged(configBefore, configAfter);
                    Report(progress, "三个画质配置均未被改写。");
                }
                catch
                {
                    if (writeStarted)
                    {
                        Report(progress, "发生错误，正在回滚写入前槽位。");
                        WriteSlot(stream, info, current);
                        byte[] rolledBack = ReadSlot(stream, info);
                        if (!Sha256(rolledBack).Equals(currentHash, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException("写入失败，并且自动回滚无法确认。请勿启动游戏。");
                        string rollbackBaseline = ComputeNormalizedHash(stream, info, reference120);
                        if (!baseline.Equals(rollbackBaseline, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException("槽位已回滚，但槽外整包校验失败。请勿启动游戏。");
                    }
                    throw;
                }
            }

            result.Success = true;
            result.Message = "已切换到 " + fps.ToString(CultureInfo.InvariantCulture) + " FPS，并通过全部写后校验。";
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Error = ex.Message;
        }
        return result;
    }

    public OperationResult RestoreFirstBackup(string candidate, IProgress<string> progress)
    {
        OperationResult result = new OperationResult();
        try
        {
            GameLocation location = NormalizeGameRoot(candidate);
            if (location == null) throw new InvalidOperationException("游戏目录无效。");
            if (IsGameRunning()) throw new InvalidOperationException("检测到 lifeafter.exe 正在运行。请完全退出游戏后重试。");

            string firstBackup = GetFirstBackupPath(location.ArchivePath);
            if (!File.Exists(firstBackup))
                throw new FileNotFoundException("没有首次观测备份，无法执行恢复。");

            byte[] restoreSlot = File.ReadAllBytes(firstBackup);
            if (restoreSlot.Length != SlotSize)
                throw new InvalidDataException("首次备份长度不正确。");

            ValidateAllPatchFiles();
            byte[] reference120 = LoadPatch(120);
            Dictionary<string, string> configBefore = HashProtectedConfigs(location.Root);

            using (FileStream stream = new FileStream(
                location.ArchivePath,
                FileMode.Open,
                FileAccess.ReadWrite,
                FileShare.None,
                1024 * 1024,
                FileOptions.RandomAccess))
            {
                NxpkInfo info = ParseNxpk(stream);
                byte[] current = ReadSlot(stream, info);
                string currentHash = Sha256(current);
                string restoreHash = Sha256(restoreSlot);
                if (currentHash.Equals(restoreHash, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("当前槽位已经与首次备份一致。");

                string baseline = ComputeNormalizedHash(stream, info, reference120);
                SaveTransactionBackup(location.ArchivePath, current, "before-restore");

                bool writeStarted = false;
                try
                {
                    Report(progress, "写入首次观测槽备份。");
                    writeStarted = true;
                    WriteSlot(stream, info, restoreSlot);
                    if (!Sha256(ReadSlot(stream, info)).Equals(restoreHash, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("恢复后的槽位哈希不匹配。");
                    if (!ComputeNormalizedHash(stream, info, reference120).Equals(baseline, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("恢复后的槽外整包哈希不匹配。");
                    EnsureConfigHashesUnchanged(configBefore, HashProtectedConfigs(location.Root));
                }
                catch
                {
                    if (writeStarted)
                    {
                        WriteSlot(stream, info, current);
                        if (!Sha256(ReadSlot(stream, info)).Equals(currentHash, StringComparison.OrdinalIgnoreCase))
                            throw new InvalidDataException("恢复失败，并且无法确认回滚。请勿启动游戏。");
                    }
                    throw;
                }
            }

            int? restoredFps = KnownFps(Sha256(restoreSlot));
            result.Success = true;
            result.Message = restoredFps.HasValue
                ? "已恢复首次观测备份：" + restoredFps.Value.ToString(CultureInfo.InvariantCulture) + " FPS。"
                : "已恢复首次观测备份。";
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Error = ex.Message;
        }
        return result;
    }

    public string GetBackupDirectoryForRoot(string candidate)
    {
        GameLocation location = NormalizeGameRoot(candidate);
        return location == null ? null : GetBackupDirectory(location.ArchivePath);
    }

    private void ValidateAllPatchFiles()
    {
        foreach (PatchInfo info in patches.Values) LoadPatch(info.Fps);
    }

    private byte[] LoadPatch(int fps)
    {
        PatchInfo info;
        if (!patches.TryGetValue(fps, out info))
            throw new InvalidOperationException("未知补丁档位。");
        string path = Path.Combine(PatchDirectory, info.FileName);
        if (!File.Exists(path)) throw new FileNotFoundException("缺少补丁文件：" + info.FileName);
        byte[] data = File.ReadAllBytes(path);
        if (data.Length != SlotSize) throw new InvalidDataException(info.FileName + " 长度不正确。");
        string actual = Sha256(data);
        if (!actual.Equals(info.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException(info.FileName + " SHA-256 不匹配。");
        return data;
    }

    private NxpkInfo ParseNxpk(FileStream stream)
    {
        if (stream.Length < 1024 * 1024 || stream.Length > UInt32.MaxValue)
            throw new InvalidDataException("NPK 文件大小不在受支持范围。");

        byte[] encryptedHeader = ReadAt(stream, 0, 32);
        byte[] header = DecryptAesEcb(encryptedHeader);
        if (Encoding.ASCII.GetString(header, 8, 4) != "NXPK")
            throw new InvalidDataException("文件不是受支持的 NXPK 包。");
        uint version = ReadUInt32(header, 12);
        if (version != 3) throw new InvalidDataException("只支持 NXPK v3，当前版本为 " + version + "。");

        long indexOffset = ReadUInt32(header, 16);
        uint recordCountRaw = ReadUInt32(header, 20);
        if (recordCountRaw == 0 || recordCountRaw > 500000)
            throw new InvalidDataException("NXPK 记录数异常。");
        int recordCount = checked((int)recordCountRaw);
        long indexSize = checked((long)recordCount * 48L);
        if (indexOffset < 32 || indexOffset + indexSize != stream.Length)
            throw new InvalidDataException("NXPK 索引边界与文件大小不匹配。");
        if (indexSize > Int32.MaxValue) throw new InvalidDataException("NXPK 索引过大。");

        byte[] encryptedIndex = ReadAt(stream, indexOffset, (int)indexSize);
        byte[] index = DecryptAesEcb(encryptedIndex);

        NxpkInfo target = null;
        for (int i = 0; i < recordCount; i++)
        {
            int offset = i * 48;
            uint nameHash = ReadUInt32(index, offset);
            uint nameId = ReadUInt32(index, offset + 4);
            if (nameHash != TargetNameHash || nameId != TargetNameId) continue;
            if (target != null) throw new InvalidDataException("索引中发现多个 SettingManager 目标记录。");

            uint reserved0 = ReadUInt32(index, offset + 32);
            uint reserved1 = ReadUInt32(index, offset + 36);
            uint reserved2 = ReadUInt32(index, offset + 40);
            uint reserved3 = ReadUInt32(index, offset + 44);
            target = new NxpkInfo
            {
                IndexOffset = indexOffset,
                RecordCount = recordCount,
                DataOffset = ReadUInt32(index, offset + 8),
                CompressedSize = checked((int)ReadUInt32(index, offset + 12)),
                OriginalSize = checked((int)ReadUInt32(index, offset + 16)),
                Checksum1 = ReadUInt32(index, offset + 20),
                Checksum2 = ReadUInt32(index, offset + 24),
                CompressionType = ReadUInt32(index, offset + 28)
            };

            if (reserved0 != 0 || reserved1 != 0 || reserved2 != 0 || reserved3 != 0)
                throw new InvalidDataException("目标记录保留字段已变化，拒绝写入。");
        }

        if (target == null) throw new InvalidDataException("NXPK 中未找到兼容的 SettingManager 记录。");
        if (target.CompressedSize != SlotSize ||
            target.OriginalSize != OriginalSize ||
            target.Checksum1 != ExpectedChecksum1 ||
            target.Checksum2 != ExpectedChecksum2 ||
            target.CompressionType != ExpectedCompressionType)
            throw new InvalidDataException("SettingManager 元数据与已审计版本不一致，拒绝写入。");
        if (target.DataOffset < 32 || target.DataOffset + target.CompressedSize > target.IndexOffset)
            throw new InvalidDataException("SettingManager 数据边界异常。");

        return target;
    }

    private byte[] ReadSlot(FileStream stream, NxpkInfo info)
    {
        return ReadAt(stream, info.DataOffset, info.CompressedSize);
    }

    private void WriteSlot(FileStream stream, NxpkInfo info, byte[] data)
    {
        if (data == null || data.Length != SlotSize)
            throw new InvalidDataException("槽位数据长度必须为 " + SlotSize + " 字节。");
        stream.Position = info.DataOffset;
        stream.Write(data, 0, data.Length);
        stream.Flush(true);
    }

    private string ComputeNormalizedHash(FileStream stream, NxpkInfo info, byte[] reference120)
    {
        if (reference120 == null || reference120.Length != SlotSize)
            throw new InvalidDataException("120 参考槽长度错误。");

        using (SHA256 sha = SHA256.Create())
        {
            byte[] buffer = new byte[4 * 1024 * 1024];
            stream.Position = 0;
            CopyIntoHash(stream, sha, buffer, info.DataOffset);
            sha.TransformBlock(reference120, 0, reference120.Length, null, 0);
            stream.Position = info.DataOffset + info.CompressedSize;
            CopyIntoHash(stream, sha, buffer, stream.Length - stream.Position);
            sha.TransformFinalBlock(new byte[0], 0, 0);
            return ToHex(sha.Hash);
        }
    }

    private static void CopyIntoHash(FileStream stream, HashAlgorithm hash, byte[] buffer, long count)
    {
        long remaining = count;
        while (remaining > 0)
        {
            int wanted = (int)Math.Min(buffer.Length, remaining);
            int read = stream.Read(buffer, 0, wanted);
            if (read <= 0) throw new EndOfStreamException("读取 NPK 时提前到达文件末尾。");
            hash.TransformBlock(buffer, 0, read, null, 0);
            remaining -= read;
        }
    }

    private Dictionary<string, string> HashProtectedConfigs(string root)
    {
        string configDir = Path.Combine(root, @"Documents\configs");
        string[] names = new string[] { "qualityconfig", "clientconfig", "pcconfig" };
        Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (string name in names)
        {
            string path = Path.Combine(configDir, name);
            result[name] = File.Exists(path) ? Sha256File(path) : "MISSING";
        }
        return result;
    }

    private static void EnsureConfigHashesUnchanged(
        Dictionary<string, string> before,
        Dictionary<string, string> after)
    {
        foreach (KeyValuePair<string, string> item in before)
        {
            string value;
            if (!after.TryGetValue(item.Key, out value) ||
                !item.Value.Equals(value, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("画质配置在操作期间发生变化：" + item.Key);
        }
    }

    private void SaveBackups(string archivePath, byte[] current, int currentFps)
    {
        string directory = GetBackupDirectory(archivePath);
        Directory.CreateDirectory(directory);
        string first = GetFirstBackupPath(archivePath);
        if (!File.Exists(first))
        {
            WriteFileAtomic(first, current);
            File.WriteAllText(
                first + ".txt",
                "CapturedUtc=" + DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) + Environment.NewLine +
                "ArchivePath=" + archivePath + Environment.NewLine +
                "ObservedFps=" + currentFps.ToString(CultureInfo.InvariantCulture) + Environment.NewLine +
                "SlotSha256=" + Sha256(current) + Environment.NewLine +
                "Note=First observed compatible slot; not an official provenance claim." + Environment.NewLine,
                new UTF8Encoding(false));
        }
        SaveTransactionBackup(archivePath, current, "before-" + currentFps.ToString(CultureInfo.InvariantCulture));
    }

    private void SaveTransactionBackup(string archivePath, byte[] data, string label)
    {
        string directory = GetBackupDirectory(archivePath);
        Directory.CreateDirectory(directory);
        string safeLabel = new string(label.Where(delegate(char c)
        {
            return Char.IsLetterOrDigit(c) || c == '-' || c == '_';
        }).ToArray());
        string name =
            DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fff", CultureInfo.InvariantCulture) +
            "-" + safeLabel + "-" + Sha256(data).Substring(0, 12) + ".bin";
        WriteFileAtomic(Path.Combine(directory, name), data);
    }

    private string GetBackupDirectory(string archivePath)
    {
        string key = Sha256(Encoding.UTF8.GetBytes(Path.GetFullPath(archivePath).ToUpperInvariant())).Substring(0, 16);
        return Path.Combine(DataDirectory, "backups", key);
    }

    private string GetFirstBackupPath(string archivePath)
    {
        return Path.Combine(GetBackupDirectory(archivePath), "first-observed-slot.bin");
    }

    private static void WriteFileAtomic(string path, byte[] data)
    {
        string directory = Path.GetDirectoryName(path);
        Directory.CreateDirectory(directory);
        string temporary = path + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                stream.Write(data, 0, data.Length);
                stream.Flush(true);
            }
            if (!Sha256File(temporary).Equals(Sha256(data), StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("备份临时文件 SHA-256 不匹配。");
            if (File.Exists(path)) throw new IOException("备份目标已存在，拒绝覆盖：" + path);
            File.Move(temporary, path);
        }
        finally
        {
            try { if (File.Exists(temporary)) File.Delete(temporary); }
            catch { }
        }
    }

    private int? KnownFps(string hash)
    {
        foreach (PatchInfo info in patches.Values)
            if (hash.Equals(info.Sha256, StringComparison.OrdinalIgnoreCase)) return info.Fps;
        return null;
    }

    private static byte[] ReadAt(FileStream stream, long offset, int count)
    {
        byte[] buffer = new byte[count];
        stream.Position = offset;
        int total = 0;
        while (total < count)
        {
            int read = stream.Read(buffer, total, count - total);
            if (read <= 0) throw new EndOfStreamException("读取二进制数据时提前到达文件末尾。");
            total += read;
        }
        return buffer;
    }

    private static byte[] DecryptAesEcb(byte[] encrypted)
    {
        if (encrypted.Length % 16 != 0)
            throw new InvalidDataException("AES-ECB 输入不是 16 字节对齐。");
        using (Aes aes = Aes.Create())
        {
            aes.Key = NxpkKey;
            aes.Mode = CipherMode.ECB;
            aes.Padding = PaddingMode.None;
            using (ICryptoTransform transform = aes.CreateDecryptor())
                return transform.TransformFinalBlock(encrypted, 0, encrypted.Length);
        }
    }

    private static uint ReadUInt32(byte[] data, int offset)
    {
        if (offset < 0 || offset + 4 > data.Length) throw new EndOfStreamException();
        return (uint)(data[offset] |
            (data[offset + 1] << 8) |
            (data[offset + 2] << 16) |
            (data[offset + 3] << 24));
    }

    private static string Sha256(byte[] data)
    {
        using (SHA256 sha = SHA256.Create()) return ToHex(sha.ComputeHash(data));
    }

    private static string Sha256File(string path)
    {
        using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
        using (SHA256 sha = SHA256.Create())
            return ToHex(sha.ComputeHash(stream));
    }

    private static string ToHex(byte[] data)
    {
        StringBuilder builder = new StringBuilder(data.Length * 2);
        foreach (byte value in data) builder.Append(value.ToString("X2", CultureInfo.InvariantCulture));
        return builder.ToString();
    }

    private static void Report(IProgress<string> progress, string message)
    {
        if (progress != null) progress.Report(message);
    }
}

internal sealed class MainForm : Form
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    private static readonly Color Background = Color.FromArgb(11, 15, 23);
    private static readonly Color Surface = Color.FromArgb(20, 27, 39);
    private static readonly Color SurfaceAlt = Color.FromArgb(27, 36, 51);
    private static readonly Color Border = Color.FromArgb(52, 65, 85);
    private static readonly Color Foreground = Color.FromArgb(235, 241, 250);
    private static readonly Color Muted = Color.FromArgb(157, 170, 189);
    private static readonly Color Accent = Color.FromArgb(59, 130, 246);
    private static readonly Color Safe = Color.FromArgb(52, 211, 153);
    private static readonly Color Warning = Color.FromArgb(245, 158, 11);
    private static readonly Color Danger = Color.FromArgb(239, 68, 68);

    private readonly FpsEngine engine = new FpsEngine();
    private readonly TextBox pathBox = new TextBox();
    private readonly Label statusLabel = new Label();
    private readonly Label detailLabel = new Label();
    private readonly CheckBox riskCheck = new CheckBox();
    private readonly TextBox logBox = new TextBox();
    private readonly List<Button> applyButtons = new List<Button>();
    private readonly Button analyzeButton = new Button();
    private readonly Button restoreButton = new Button();
    private readonly Button backupButton = new Button();
    private bool busy;
    private AnalysisResult lastAnalysis;

    public MainForm()
    {
        Text = "FPS Slot Lab";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(840, 680);
        Size = new Size(980, 760);
        BackColor = Background;
        ForeColor = Foreground;
        Font = new Font("Segoe UI", 10F);
        AutoScaleMode = AutoScaleMode.Dpi;

        Controls.Add(BuildLayout());
        if (!"1".Equals(Environment.GetEnvironmentVariable("FPS_SLOT_LAB_SKIP_AUTODETECT"), StringComparison.Ordinal))
            Shown += delegate { AutoDetect(); };
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        if (Environment.OSVersion.Version.Major < 10) return;
        try
        {
            int enabled = 1;
            int result = DwmSetWindowAttribute(Handle, 20, ref enabled, sizeof(int));
            if (result != 0) DwmSetWindowAttribute(Handle, 19, ref enabled, sizeof(int));
        }
        catch { }
    }

    private Control BuildLayout()
    {
        TableLayoutPanel outer = new TableLayoutPanel();
        outer.Dock = DockStyle.Fill;
        outer.Padding = new Padding(28, 24, 28, 24);
        outer.BackColor = Background;
        outer.ColumnCount = 1;
        outer.RowCount = 5;
        outer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        outer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        outer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        outer.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
        outer.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        Panel header = new Panel();
        header.Height = 92;
        header.Dock = DockStyle.Top;
        Label title = MakeLabel("FPS Slot Lab", 24F, FontStyle.Bold, Foreground);
        title.Location = new Point(0, 4);
        title.AutoSize = true;
        Label subtitle = MakeLabel("仅修改 SettingManager 帧率槽 · 独占写入 · 完整哈希校验 · 可恢复首次备份", 10.5F, FontStyle.Regular, Muted);
        subtitle.Location = new Point(2, 48);
        subtitle.AutoSize = true;
        header.Controls.Add(title);
        header.Controls.Add(subtitle);
        outer.Controls.Add(header, 0, 0);

        Panel locationCard = MakeCard(130);
        Label locationTitle = MakeLabel("游戏位置", 11F, FontStyle.Bold, Foreground);
        locationTitle.Location = new Point(18, 15);
        locationTitle.AutoSize = true;
        pathBox.Location = new Point(18, 48);
        pathBox.Width = 650;
        pathBox.Height = 34;
        pathBox.ReadOnly = true;
        pathBox.BackColor = SurfaceAlt;
        pathBox.ForeColor = Foreground;
        pathBox.BorderStyle = BorderStyle.FixedSingle;
        pathBox.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top;

        Button browse = MakeButton("选择目录", Accent, 112);
        browse.Location = new Point(686, 45);
        browse.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        browse.Click += BrowseClick;
        analyzeButton.Text = "重新检测";
        StyleButton(analyzeButton, SurfaceAlt, 112);
        analyzeButton.Location = new Point(806, 45);
        analyzeButton.Anchor = AnchorStyles.Top | AnchorStyles.Right;
        analyzeButton.Click += delegate { AnalyzeCurrent(); };

        locationCard.Controls.Add(locationTitle);
        locationCard.Controls.Add(pathBox);
        locationCard.Controls.Add(browse);
        locationCard.Controls.Add(analyzeButton);
        locationCard.Resize += delegate
        {
            pathBox.Width = Math.Max(280, locationCard.ClientSize.Width - 286);
            browse.Left = locationCard.ClientSize.Width - 250;
            analyzeButton.Left = locationCard.ClientSize.Width - 130;
        };
        outer.Controls.Add(locationCard, 0, 1);

        Panel actionCard = MakeCard(216);
        Label actionTitle = MakeLabel("帧率档位", 11F, FontStyle.Bold, Foreground);
        actionTitle.Location = new Point(18, 15);
        actionTitle.AutoSize = true;
        statusLabel.Text = "等待检测";
        statusLabel.Font = new Font("Segoe UI", 11F, FontStyle.Bold);
        statusLabel.ForeColor = Muted;
        statusLabel.Location = new Point(18, 45);
        statusLabel.AutoSize = true;
        detailLabel.Text = "工具只会对已知、兼容的 NXPK 目标槽执行写入。";
        detailLabel.ForeColor = Muted;
        detailLabel.Location = new Point(18, 73);
        detailLabel.AutoSize = true;

        FlowLayoutPanel fpsPanel = new FlowLayoutPanel();
        fpsPanel.Location = new Point(14, 105);
        fpsPanel.Height = 58;
        fpsPanel.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top;
        fpsPanel.WrapContents = false;
        foreach (int fps in new int[] { 260, 280, 300, 360 })
        {
            Button button = MakeButton(fps.ToString(CultureInfo.InvariantCulture) + " FPS", fps == 300 ? Warning : Accent, 142);
            button.Height = 48;
            int captured = fps;
            button.Click += delegate { ApplyFps(captured); };
            button.Enabled = false;
            applyButtons.Add(button);
            fpsPanel.Controls.Add(button);
        }

        riskCheck.Text = "我已了解：该操作会修改本地游戏包，可能违反游戏规则并产生账号风险。";
        riskCheck.ForeColor = Color.FromArgb(252, 190, 190);
        riskCheck.AutoSize = true;
        riskCheck.Location = new Point(18, 174);
        riskCheck.CheckedChanged += delegate { UpdateActionState(); };

        actionCard.Controls.Add(actionTitle);
        actionCard.Controls.Add(statusLabel);
        actionCard.Controls.Add(detailLabel);
        actionCard.Controls.Add(fpsPanel);
        actionCard.Controls.Add(riskCheck);
        actionCard.Resize += delegate { fpsPanel.Width = actionCard.ClientSize.Width - 28; };
        outer.Controls.Add(actionCard, 0, 2);

        Panel logCard = MakeCard(240);
        logCard.Dock = DockStyle.Fill;
        Label logTitle = MakeLabel("操作记录", 11F, FontStyle.Bold, Foreground);
        logTitle.Location = new Point(18, 15);
        logTitle.AutoSize = true;
        logBox.Location = new Point(18, 46);
        logBox.Multiline = true;
        logBox.ReadOnly = true;
        logBox.ScrollBars = ScrollBars.Vertical;
        logBox.BackColor = Color.FromArgb(8, 12, 19);
        logBox.ForeColor = Color.FromArgb(203, 213, 225);
        logBox.BorderStyle = BorderStyle.FixedSingle;
        logBox.Font = new Font("Consolas", 9.5F);
        logBox.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
        logCard.Controls.Add(logTitle);
        logCard.Controls.Add(logBox);
        logCard.Resize += delegate
        {
            logBox.Width = logCard.ClientSize.Width - 36;
            logBox.Height = Math.Max(100, logCard.ClientSize.Height - 64);
        };
        outer.Controls.Add(logCard, 0, 3);

        FlowLayoutPanel footer = new FlowLayoutPanel();
        footer.Height = 58;
        footer.Dock = DockStyle.Fill;
        footer.Padding = new Padding(0, 10, 0, 0);
        footer.FlowDirection = FlowDirection.LeftToRight;
        restoreButton.Text = "恢复首次备份";
        StyleButton(restoreButton, Danger, 150);
        restoreButton.Enabled = false;
        restoreButton.Click += RestoreClick;
        backupButton.Text = "打开备份目录";
        StyleButton(backupButton, SurfaceAlt, 150);
        backupButton.Enabled = false;
        backupButton.Click += OpenBackupClick;
        Label note = MakeLabel("不会把内置 120 补丁标记为官方原件。", 9.5F, FontStyle.Regular, Muted);
        note.Margin = new Padding(18, 13, 0, 0);
        note.AutoSize = true;
        footer.Controls.Add(restoreButton);
        footer.Controls.Add(backupButton);
        footer.Controls.Add(note);
        outer.Controls.Add(footer, 0, 4);
        return outer;
    }

    private Panel MakeCard(int height)
    {
        Panel panel = new Panel();
        panel.Height = height;
        panel.Dock = DockStyle.Fill;
        panel.Margin = new Padding(0, 0, 0, 14);
        panel.Padding = new Padding(1);
        panel.BackColor = Surface;
        panel.Paint += delegate(object sender, PaintEventArgs e)
        {
            Control control = (Control)sender;
            using (Pen pen = new Pen(Border))
                e.Graphics.DrawRectangle(pen, 0, 0, control.ClientSize.Width - 1, control.ClientSize.Height - 1);
        };
        return panel;
    }

    private static Label MakeLabel(string text, float size, FontStyle style, Color color)
    {
        return new Label
        {
            Text = text,
            Font = new Font("Segoe UI", size, style),
            ForeColor = color,
            BackColor = Color.Transparent
        };
    }

    private Button MakeButton(string text, Color color, int width)
    {
        Button button = new Button();
        button.Text = text;
        StyleButton(button, color, width);
        return button;
    }

    private void StyleButton(Button button, Color color, int width)
    {
        button.Tag = color;
        button.Width = width;
        button.Height = 38;
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 1;
        button.FlatAppearance.BorderColor = Color.FromArgb(
            Math.Min(255, color.R + 18),
            Math.Min(255, color.G + 18),
            Math.Min(255, color.B + 18));
        button.BackColor = color;
        button.ForeColor = Color.White;
        button.Font = new Font("Segoe UI", 10F, FontStyle.Bold);
        button.Cursor = Cursors.Hand;
        button.UseVisualStyleBackColor = false;
        button.EnabledChanged += delegate
        {
            Color baseColor = button.Tag is Color ? (Color)button.Tag : color;
            button.BackColor = button.Enabled ? baseColor : Color.FromArgb(39, 49, 65);
            button.ForeColor = button.Enabled ? Color.White : Color.FromArgb(112, 126, 146);
            button.Cursor = button.Enabled ? Cursors.Hand : Cursors.Default;
        };
    }

    private void AutoDetect()
    {
        SetBusy(true);
        AppendLog("正在查找保存路径和常见安装位置。");
        Task.Run(delegate { return engine.FindGame(); }).ContinueWith(delegate(Task<GameLocation> task)
        {
            BeginInvoke((Action)delegate
            {
                SetBusy(false);
                if (task.IsFaulted || task.Result == null)
                {
                    AppendLog("未自动找到游戏，请点击“选择目录”。");
                    return;
                }
                pathBox.Text = task.Result.Root;
                engine.SaveGameRoot(task.Result.Root);
                AnalyzeCurrent();
            });
        });
    }

    private void BrowseClick(object sender, EventArgs e)
    {
        using (FolderBrowserDialog dialog = new FolderBrowserDialog())
        {
            dialog.Description = "选择包含 mingrizhihou.exe 的游戏根目录";
            dialog.ShowNewFolderButton = false;
            if (dialog.ShowDialog(this) != DialogResult.OK) return;
            GameLocation location = engine.NormalizeGameRoot(dialog.SelectedPath);
            if (location == null)
            {
                MessageBox.Show(this, "所选位置没有找到兼容的游戏目录和 script.py314.lc.npk。", "目录无效", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            pathBox.Text = location.Root;
            engine.SaveGameRoot(location.Root);
            AnalyzeCurrent();
        }
    }

    private async void AnalyzeCurrent()
    {
        if (busy) return;
        if (String.IsNullOrWhiteSpace(pathBox.Text))
        {
            AppendLog("请先选择游戏目录。");
            return;
        }
        SetBusy(true);
        AppendLog("正在解析 NXPK v3 索引和目标槽。");
        AnalysisResult result = await Task.Run(delegate { return engine.Analyze(pathBox.Text); });
        lastAnalysis = result.Success ? result : null;
        if (!result.Success)
        {
            statusLabel.Text = "检测失败";
            statusLabel.ForeColor = Danger;
            detailLabel.Text = result.Error;
            AppendLog("检测失败：" + result.Error);
        }
        else
        {
            statusLabel.Text = result.CurrentFps.HasValue
                ? "当前：" + result.CurrentFps.Value.ToString(CultureInfo.InvariantCulture) + " FPS"
                : "当前槽未知，写入已锁定";
            statusLabel.ForeColor = result.CurrentFps.HasValue ? Safe : Danger;
            detailLabel.Text =
                "目标偏移 0x" + result.Nxpk.DataOffset.ToString("X", CultureInfo.InvariantCulture) +
                " · 记录数 " + result.Nxpk.RecordCount.ToString(CultureInfo.InvariantCulture) +
                " · 槽 SHA-256 " + result.SlotHash.Substring(0, 16) + "…";
            AppendLog(result.Message);
            if (result.GameRunning) AppendLog("检测到游戏正在运行；所有写入操作已禁用。");
        }
        SetBusy(false);
    }

    private async void ApplyFps(int fps)
    {
        if (busy || lastAnalysis == null || !lastAnalysis.CurrentFps.HasValue) return;
        if (!riskCheck.Checked)
        {
            MessageBox.Show(this, "请先阅读并勾选风险确认。", "需要确认", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (fps == 300)
        {
            DialogResult extra = MessageBox.Show(
                this,
                "300 FPS 补丁除帧率整数外，还有 1,047 个前导序列化字节与其他高帧率补丁不同。\n\n仍要继续测试吗？",
                "300 FPS 额外提示",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (extra != DialogResult.Yes) return;
        }
        DialogResult answer = MessageBox.Show(
            this,
            "即将修改：\n" + lastAnalysis.Location.ArchivePath +
            "\n\n当前：" + lastAnalysis.CurrentFps.Value + " FPS\n目标：" + fps +
            " FPS\n\n工具会先保存备份并在主进程重新检查游戏状态。继续吗？",
            "确认写入游戏包",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);
        if (answer != DialogResult.Yes) return;

        SetBusy(true);
        Progress<string> progress = new Progress<string>(AppendLog);
        OperationResult result = await Task.Run(delegate { return engine.Apply(pathBox.Text, fps, progress); });
        if (result.Success)
        {
            AppendLog(result.Message);
            MessageBox.Show(this, result.Message + "\n\n请先正常启动游戏验证；如异常，退出游戏后恢复首次备份。", "写入完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        else
        {
            AppendLog("写入失败：" + result.Error);
            MessageBox.Show(this, result.Error, "写入失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        SetBusy(false);
        AnalyzeCurrent();
    }

    private async void RestoreClick(object sender, EventArgs e)
    {
        if (busy || lastAnalysis == null) return;
        DialogResult answer = MessageBox.Show(
            this,
            "将恢复本工具首次写入前保存的槽位。\n\n该备份是“首次观测值”，不代表经过网易官方签名确认。继续吗？",
            "确认恢复",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Warning);
        if (answer != DialogResult.Yes) return;

        SetBusy(true);
        Progress<string> progress = new Progress<string>(AppendLog);
        OperationResult result = await Task.Run(delegate { return engine.RestoreFirstBackup(pathBox.Text, progress); });
        if (result.Success)
        {
            AppendLog(result.Message);
            MessageBox.Show(this, result.Message, "恢复完成", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        else
        {
            AppendLog("恢复失败：" + result.Error);
            MessageBox.Show(this, result.Error, "恢复失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        SetBusy(false);
        AnalyzeCurrent();
    }

    private void OpenBackupClick(object sender, EventArgs e)
    {
        try
        {
            string directory = engine.GetBackupDirectoryForRoot(pathBox.Text);
            if (String.IsNullOrEmpty(directory)) throw new InvalidOperationException("请先选择有效游戏目录。");
            Directory.CreateDirectory(directory);
            Process.Start("explorer.exe", "\"" + directory + "\"");
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "无法打开目录", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void SetBusy(bool value)
    {
        busy = value;
        Cursor = value ? Cursors.WaitCursor : Cursors.Default;
        analyzeButton.Enabled = !value;
        UpdateActionState();
    }

    private void UpdateActionState()
    {
        bool canWrite =
            !busy &&
            riskCheck.Checked &&
            lastAnalysis != null &&
            lastAnalysis.Success &&
            lastAnalysis.CurrentFps.HasValue &&
            !lastAnalysis.GameRunning;
        foreach (Button button in applyButtons) button.Enabled = canWrite;
        restoreButton.Enabled =
            !busy &&
            lastAnalysis != null &&
            lastAnalysis.Success &&
            lastAnalysis.FirstBackupAvailable &&
            !lastAnalysis.GameRunning;
        backupButton.Enabled = !busy && lastAnalysis != null && lastAnalysis.Success;
    }

    private void AppendLog(string message)
    {
        if (InvokeRequired)
        {
            BeginInvoke((Action<string>)AppendLog, message);
            return;
        }
        string line = "[" + DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + "] " + message;
        logBox.AppendText(line + Environment.NewLine);
        logBox.SelectionStart = logBox.TextLength;
        logBox.ScrollToCaret();
    }
}

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}
