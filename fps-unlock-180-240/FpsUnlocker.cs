using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

[assembly: System.Reflection.AssemblyTitle("LifeAfter FPS Unlock 180-240")]
[assembly: System.Reflection.AssemblyDescription("Version-locked NXPK frame-rate patch and restore tool")]
[assembly: System.Reflection.AssemblyCompany("Local research build")]
[assembly: System.Reflection.AssemblyProduct("LifeAfter FPS Unlock 180-240")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

internal sealed class PatchDefinition
{
    public string Label;
    public string FileName;
    public string Sha256;
}

internal sealed class NxpkRecord
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

internal sealed class FpsUnlocker
{
    private const int SlotSize = 110791;
    private const int OriginalSize = 328632;
    private const uint TargetNameHash = 4238962030;
    private const uint TargetNameId = 3758457633;
    private const uint ExpectedChecksum1 = 3881385757;
    private const uint ExpectedChecksum2 = 3180330809;
    private const uint ExpectedCompressionType = 2;
    private const string ExpectedOriginalArchiveSha256 =
        "D28A80EE2F0A209BD24ADE0838848B49FE2D9816946C304D15E9A83FEA6D2738";

    private static readonly byte[] NxpkKey = new byte[]
    {
        96, 99, 8, 216, 163, 44, 120, 32, 19, 210, 108, 47, 34, 111, 104, 109
    };

    private readonly Dictionary<string, PatchDefinition> patches =
        new Dictionary<string, PatchDefinition>(StringComparer.OrdinalIgnoreCase)
    {
        {
            "original",
            new PatchDefinition
            {
                Label = "官方原始槽位",
                FileName = "patch_original.bin",
                Sha256 = "6F9165B65B8E32391E32FBC5174B8CC680E90C33C5887B46999D087ACE8FE050"
            }
        },
        {
            "180",
            new PatchDefinition
            {
                Label = "180 FPS",
                FileName = "patch_180.bin",
                Sha256 = "4D0997446DBD08E7AF24C536AFA7D5055E29E8EBEEA07300B36CB95B9849B469"
            }
        },
        {
            "240",
            new PatchDefinition
            {
                Label = "240 FPS",
                FileName = "patch_240.bin",
                Sha256 = "15AAC9544494399DDDEF72E8278D00DF492D5D45EE29A1D5FE610AA1896943C4"
            }
        }
    };

    public string PatchDirectory
    {
        get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "patches"); }
    }

    public string BackupDirectory
    {
        get
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "LifeAfter FPS Unlock 180-240",
                "Backups");
        }
    }

    public string ResolveArchive(string candidate)
    {
        if (String.IsNullOrWhiteSpace(candidate))
        {
            string known = @"D:\Program Files (x86)\LifeAfter\Documents\script.py314.lc.npk";
            if (File.Exists(known)) return known;
            throw new FileNotFoundException("未指定 NPK，且没有找到当前机器上的默认安装路径。");
        }

        string path = Path.GetFullPath(candidate.Trim().Trim('"'));
        if (File.Exists(path)) return path;
        if (Directory.Exists(path))
        {
            string direct = Path.Combine(path, "script.py314.lc.npk");
            if (File.Exists(direct)) return direct;
            string nested = Path.Combine(path, @"Documents\script.py314.lc.npk");
            if (File.Exists(nested)) return nested;
        }
        throw new FileNotFoundException("没有找到 script.py314.lc.npk：" + path);
    }

    public void Status(string archivePath)
    {
        ValidatePatchFiles();
        using (FileStream stream = OpenArchive(archivePath, FileAccess.Read, FileShare.Read))
        {
            NxpkRecord record = ParseNxpk(stream);
            byte[] slot = ReadAt(stream, record.DataOffset, record.CompressedSize);
            string slotHash = Sha256(slot);
            string state = IdentifyState(slotHash);
            string normalized = ComputeNormalizedArchiveHash(stream, record, LoadPatch("original"));
            Console.WriteLine("NPK: " + archivePath);
            Console.WriteLine("状态: " + state);
            Console.WriteLine("槽位 SHA-256: " + slotHash);
            Console.WriteLine("槽外/原版归一化校验: " +
                (normalized.Equals(ExpectedOriginalArchiveSha256, StringComparison.OrdinalIgnoreCase)
                    ? "通过"
                    : "失败"));
            Console.WriteLine("目标偏移: 0x" + record.DataOffset.ToString("X", CultureInfo.InvariantCulture));
            Console.WriteLine("备份目录: " + BackupDirectory);
        }
    }

    public void EnsureOriginalBackup(string archivePath)
    {
        ValidatePatchFiles();
        EnsureGameStopped();
        Directory.CreateDirectory(BackupDirectory);
        string finalPath = Path.Combine(
            BackupDirectory,
            "script.py314.lc.npk.original-" + ExpectedOriginalArchiveSha256.Substring(0, 16) + ".bak");

        if (File.Exists(finalPath))
        {
            string existingHash = Sha256File(finalPath);
            if (!existingHash.Equals(ExpectedOriginalArchiveSha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("已有完整备份的哈希异常，拒绝覆盖：" + finalPath);
            Console.WriteLine("完整原包备份已存在且校验通过：");
            Console.WriteLine(finalPath);
            return;
        }

        string tempPath = finalPath + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            using (FileStream source = OpenArchive(archivePath, FileAccess.Read, FileShare.None))
            {
                NxpkRecord record = ParseNxpk(source);
                byte[] current = ReadAt(source, record.DataOffset, record.CompressedSize);
                IdentifyState(Sha256(current));
                string normalized = ComputeNormalizedArchiveHash(source, record, LoadPatch("original"));
                if (!normalized.Equals(ExpectedOriginalArchiveSha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("当前 NPK 的目标槽外内容与已审查版本不一致，拒绝生成备份。");
                WriteReconstructedOriginalBackup(source, record, LoadPatch("original"), tempPath);
            }

            string tempHash = Sha256File(tempPath);
            if (!tempHash.Equals(ExpectedOriginalArchiveSha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("新建完整备份的 SHA-256 校验失败。");
            File.Move(tempPath, finalPath);
            Console.WriteLine("已创建并验证完整原包备份：");
            Console.WriteLine(finalPath);
        }
        finally
        {
            if (File.Exists(tempPath)) File.Delete(tempPath);
        }
    }

    public void Apply(string archivePath, string target)
    {
        if (!target.Equals("180") && !target.Equals("240"))
            throw new ArgumentException("目标只能是 180 或 240。");
        ValidatePatchFiles();
        EnsureGameStopped();
        EnsureOriginalBackup(archivePath);
        byte[] originalPatch = LoadPatch("original");
        byte[] targetPatch = LoadPatch(target);

        using (FileStream stream = OpenArchive(archivePath, FileAccess.ReadWrite, FileShare.None))
        {
            NxpkRecord record = ParseNxpk(stream);
            byte[] current = ReadAt(stream, record.DataOffset, record.CompressedSize);
            string currentHash = Sha256(current);
            string currentState = IdentifyState(currentHash);
            if (currentHash.Equals(patches[target].Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("当前已经是 " + patches[target].Label + "。");

            string normalized = ComputeNormalizedArchiveHash(stream, record, originalPatch);
            if (!normalized.Equals(ExpectedOriginalArchiveSha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("当前 NPK 的目标槽外内容发生变化，拒绝写入。");

            SaveTransactionSlot(current, currentState);
            bool writeStarted = false;
            try
            {
                Console.WriteLine("写入前状态: " + currentState);
                writeStarted = true;
                WriteAt(stream, record.DataOffset, targetPatch);
                byte[] written = ReadAt(stream, record.DataOffset, record.CompressedSize);
                if (!Sha256(written).Equals(patches[target].Sha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("写后槽位 SHA-256 校验失败。");
                string afterNormalized = ComputeNormalizedArchiveHash(stream, record, originalPatch);
                if (!afterNormalized.Equals(ExpectedOriginalArchiveSha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("写后槽外归一化校验失败。");
            }
            catch
            {
                if (writeStarted)
                {
                    WriteAt(stream, record.DataOffset, current);
                    if (!Sha256(ReadAt(stream, record.DataOffset, record.CompressedSize))
                        .Equals(currentHash, StringComparison.OrdinalIgnoreCase))
                        throw new InvalidDataException("写入失败，且自动回滚无法确认。请勿启动游戏。");
                }
                throw;
            }
        }
        Console.WriteLine("完成：已切换到 " + patches[target].Label + "，写后校验通过。");
    }

    public void Restore(string archivePath)
    {
        ValidatePatchFiles();
        EnsureGameStopped();
        byte[] originalPatch = LoadPatch("original");
        using (FileStream stream = OpenArchive(archivePath, FileAccess.ReadWrite, FileShare.None))
        {
            NxpkRecord record = ParseNxpk(stream);
            byte[] current = ReadAt(stream, record.DataOffset, record.CompressedSize);
            string currentHash = Sha256(current);
            string currentState = IdentifyState(currentHash);
            if (currentHash.Equals(patches["original"].Sha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("当前已经是官方原始槽位。");
            string normalized = ComputeNormalizedArchiveHash(stream, record, originalPatch);
            if (!normalized.Equals(ExpectedOriginalArchiveSha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("当前 NPK 的目标槽外内容发生变化，拒绝恢复。");

            SaveTransactionSlot(current, "before-restore-" + currentState);
            WriteAt(stream, record.DataOffset, originalPatch);
            if (!Sha256(ReadAt(stream, record.DataOffset, record.CompressedSize))
                .Equals(patches["original"].Sha256, StringComparison.OrdinalIgnoreCase))
            {
                WriteAt(stream, record.DataOffset, current);
                throw new InvalidDataException("恢复写入校验失败，已回滚到恢复前槽位。");
            }
        }

        string archiveHash = Sha256File(archivePath);
        if (!archiveHash.Equals(ExpectedOriginalArchiveSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("槽位已恢复，但完整 NPK 哈希不是已审查原版。请使用完整备份核查。");
        Console.WriteLine("完成：已恢复官方原始槽位，完整 NPK SHA-256 校验通过。");
    }

    private void ValidatePatchFiles()
    {
        foreach (KeyValuePair<string, PatchDefinition> item in patches)
            LoadPatch(item.Key);
    }

    private byte[] LoadPatch(string key)
    {
        PatchDefinition definition = patches[key];
        string path = Path.Combine(PatchDirectory, definition.FileName);
        if (!File.Exists(path)) throw new FileNotFoundException("缺少补丁文件：" + path);
        byte[] data = File.ReadAllBytes(path);
        if (data.Length != SlotSize)
            throw new InvalidDataException(definition.FileName + " 长度不正确。");
        if (!Sha256(data).Equals(definition.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException(definition.FileName + " SHA-256 不匹配。");
        return data;
    }

    private string IdentifyState(string hash)
    {
        foreach (KeyValuePair<string, PatchDefinition> item in patches)
            if (hash.Equals(item.Value.Sha256, StringComparison.OrdinalIgnoreCase))
                return item.Value.Label;
        throw new InvalidDataException("目标槽位不是已知的原版、180 或 240 状态，拒绝继续。");
    }

    private NxpkRecord ParseNxpk(FileStream stream)
    {
        if (stream.Length < 1024 * 1024 || stream.Length > UInt32.MaxValue)
            throw new InvalidDataException("NPK 文件大小不在受支持范围。");

        byte[] header = DecryptAesEcb(ReadAt(stream, 0, 32));
        if (Encoding.ASCII.GetString(header, 8, 4) != "NXPK")
            throw new InvalidDataException("不是 NXPK 文件。");
        if (ReadUInt32(header, 12) != 3)
            throw new InvalidDataException("只支持 NXPK v3。");

        long indexOffset = ReadUInt32(header, 16);
        int recordCount = checked((int)ReadUInt32(header, 20));
        long indexSize = checked((long)recordCount * 48L);
        if (recordCount <= 0 || recordCount > 500000 ||
            indexOffset < 32 || indexOffset + indexSize != stream.Length ||
            indexSize > Int32.MaxValue)
            throw new InvalidDataException("NXPK 索引边界异常。");

        byte[] index = DecryptAesEcb(ReadAt(stream, indexOffset, (int)indexSize));
        NxpkRecord found = null;
        for (int i = 0; i < recordCount; i++)
        {
            int offset = i * 48;
            if (ReadUInt32(index, offset) != TargetNameHash ||
                ReadUInt32(index, offset + 4) != TargetNameId)
                continue;
            if (found != null) throw new InvalidDataException("发现多个 SettingManager 记录。");
            found = new NxpkRecord
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
            for (int r = 0; r < 4; r++)
                if (ReadUInt32(index, offset + 32 + r * 4) != 0)
                    throw new InvalidDataException("目标记录保留字段发生变化。");
        }

        if (found == null) throw new InvalidDataException("未找到 SettingManager 目标记录。");
        if (found.CompressedSize != SlotSize ||
            found.OriginalSize != OriginalSize ||
            found.Checksum1 != ExpectedChecksum1 ||
            found.Checksum2 != ExpectedChecksum2 ||
            found.CompressionType != ExpectedCompressionType ||
            found.DataOffset < 32 ||
            found.DataOffset + found.CompressedSize > found.IndexOffset)
            throw new InvalidDataException("SettingManager 元数据与已审查的当前版本不一致，拒绝写入。");
        return found;
    }

    private string ComputeNormalizedArchiveHash(FileStream stream, NxpkRecord record, byte[] originalPatch)
    {
        stream.Position = 0;
        using (SHA256 sha = SHA256.Create())
        {
            byte[] buffer = new byte[4 * 1024 * 1024];
            HashRange(stream, sha, record.DataOffset, buffer);
            sha.TransformBlock(originalPatch, 0, originalPatch.Length, null, 0);
            stream.Position = record.DataOffset + record.CompressedSize;
            HashRange(stream, sha, stream.Length - stream.Position, buffer);
            sha.TransformFinalBlock(new byte[0], 0, 0);
            return Hex(sha.Hash);
        }
    }

    private static void HashRange(FileStream stream, HashAlgorithm hash, long count, byte[] buffer)
    {
        long remaining = count;
        while (remaining > 0)
        {
            int wanted = (int)Math.Min(buffer.Length, remaining);
            int read = stream.Read(buffer, 0, wanted);
            if (read <= 0) throw new EndOfStreamException();
            hash.TransformBlock(buffer, 0, read, null, 0);
            remaining -= read;
        }
    }

    private void WriteReconstructedOriginalBackup(
        FileStream source, NxpkRecord record, byte[] originalPatch, string destination)
    {
        source.Position = 0;
        using (FileStream output = new FileStream(
            destination, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4 * 1024 * 1024))
        {
            CopyRange(source, output, record.DataOffset);
            output.Write(originalPatch, 0, originalPatch.Length);
            source.Position = record.DataOffset + record.CompressedSize;
            CopyRange(source, output, source.Length - source.Position);
            output.Flush(true);
        }
    }

    private static void CopyRange(FileStream source, FileStream destination, long count)
    {
        byte[] buffer = new byte[4 * 1024 * 1024];
        long remaining = count;
        while (remaining > 0)
        {
            int wanted = (int)Math.Min(buffer.Length, remaining);
            int read = source.Read(buffer, 0, wanted);
            if (read <= 0) throw new EndOfStreamException();
            destination.Write(buffer, 0, read);
            remaining -= read;
        }
    }

    private void SaveTransactionSlot(byte[] slot, string label)
    {
        string directory = Path.Combine(BackupDirectory, "Transactions");
        Directory.CreateDirectory(directory);
        string safeLabel = label.Replace(' ', '-').Replace('/', '-');
        string name = DateTime.Now.ToString("yyyyMMdd-HHmmss-fff", CultureInfo.InvariantCulture) +
            "-" + safeLabel + "-" + Sha256(slot).Substring(0, 16) + ".bin";
        File.WriteAllBytes(Path.Combine(directory, name), slot);
    }

    private static FileStream OpenArchive(string path, FileAccess access, FileShare share)
    {
        IOException lastError = null;
        int attempts = share == FileShare.None ? 10 : 1;
        for (int attempt = 0; attempt < attempts; attempt++)
        {
            try
            {
                return new FileStream(
                    path,
                    FileMode.Open,
                    access,
                    share,
                    4 * 1024 * 1024,
                    FileOptions.RandomAccess);
            }
            catch (IOException ex)
            {
                lastError = ex;
                if (attempt + 1 < attempts) Thread.Sleep(200);
            }
        }
        throw lastError;
    }

    private static byte[] ReadAt(FileStream stream, long offset, int count)
    {
        byte[] result = new byte[count];
        stream.Position = offset;
        int total = 0;
        while (total < count)
        {
            int read = stream.Read(result, total, count - total);
            if (read <= 0) throw new EndOfStreamException();
            total += read;
        }
        return result;
    }

    private static void WriteAt(FileStream stream, long offset, byte[] data)
    {
        stream.Position = offset;
        stream.Write(data, 0, data.Length);
        stream.Flush(true);
    }

    private static uint ReadUInt32(byte[] data, int offset)
    {
        return (uint)(data[offset] |
            (data[offset + 1] << 8) |
            (data[offset + 2] << 16) |
            (data[offset + 3] << 24));
    }

    private static byte[] DecryptAesEcb(byte[] encrypted)
    {
        if (encrypted.Length % 16 != 0)
            throw new InvalidDataException("AES 输入未按 16 字节对齐。");
        using (Aes aes = Aes.Create())
        {
            aes.Key = NxpkKey;
            aes.Mode = CipherMode.ECB;
            aes.Padding = PaddingMode.None;
            using (ICryptoTransform transform = aes.CreateDecryptor())
                return transform.TransformFinalBlock(encrypted, 0, encrypted.Length);
        }
    }

    private static string Sha256(byte[] data)
    {
        using (SHA256 sha = SHA256.Create()) return Hex(sha.ComputeHash(data));
    }

    private static string Sha256File(string path)
    {
        using (FileStream stream = File.OpenRead(path))
        using (SHA256 sha = SHA256.Create())
            return Hex(sha.ComputeHash(stream));
    }

    private static string Hex(byte[] data)
    {
        StringBuilder text = new StringBuilder(data.Length * 2);
        foreach (byte value in data) text.Append(value.ToString("X2", CultureInfo.InvariantCulture));
        return text.ToString();
    }

    private static void EnsureGameStopped()
    {
        Process[] processes = Process.GetProcessesByName("lifeafter");
        try
        {
            if (processes.Length > 0)
                throw new InvalidOperationException("检测到 lifeafter.exe 正在运行，请完全退出游戏后再操作。");
        }
        finally
        {
            foreach (Process process in processes) process.Dispose();
        }
    }
}

internal static class Program
{
    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Console.Title = "明日之后 FPS 解锁 180 / 240";
        try
        {
            FpsUnlocker tool = new FpsUnlocker();
            if (args.Length > 0)
                return RunCommand(tool, args);
            return RunInteractive(tool);
        }
        catch (Exception ex)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine("失败：" + ex.Message);
            if (Environment.GetEnvironmentVariable("FPS_UNLOCK_DEBUG") == "1")
                Console.WriteLine(ex.ToString());
            Console.ResetColor();
            return 1;
        }
    }

    private static int RunCommand(FpsUnlocker tool, string[] args)
    {
        string command = args[0].ToLowerInvariant();
        string archiveArg = null;
        if (command == "apply")
        {
            if (args.Length < 2) throw new ArgumentException("用法：apply 180|240 [NPK路径]");
            if (args.Length >= 3) archiveArg = args[2];
            string archive = tool.ResolveArchive(archiveArg);
            tool.Apply(archive, args[1]);
            return 0;
        }

        if (args.Length >= 2) archiveArg = args[1];
        string resolved = tool.ResolveArchive(archiveArg);
        if (command == "status") tool.Status(resolved);
        else if (command == "backup") tool.EnsureOriginalBackup(resolved);
        else if (command == "restore") tool.Restore(resolved);
        else throw new ArgumentException("命令只能是 status、backup、apply 或 restore。");
        return 0;
    }

    private static int RunInteractive(FpsUnlocker tool)
    {
        Console.WriteLine("明日之后 FPS 解锁补丁（当前包体专用）");
        Console.WriteLine("仅支持已审查版本；写入范围固定为 SettingManager 的 110,791 字节槽位。");
        Console.WriteLine("不包含反作弊绕过，使用前请自行评估游戏规则和账号风险。");
        Console.WriteLine();
        Console.Write("NPK 或游戏目录（直接回车自动识别）：");
        string archive = tool.ResolveArchive(Console.ReadLine());
        Console.WriteLine();
        tool.Status(archive);

        while (true)
        {
            Console.WriteLine();
            Console.WriteLine("[1] 应用 180 FPS");
            Console.WriteLine("[2] 应用 240 FPS");
            Console.WriteLine("[3] 恢复官方原始槽位");
            Console.WriteLine("[4] 创建/验证完整原包备份");
            Console.WriteLine("[5] 重新检测");
            Console.WriteLine("[Q] 退出");
            Console.Write("请选择：");
            string choice = (Console.ReadLine() ?? "").Trim();
            if (choice.Equals("q", StringComparison.OrdinalIgnoreCase)) return 0;

            try
            {
                if (choice == "1" || choice == "2")
                {
                    string fps = choice == "1" ? "180" : "240";
                    Console.Write("确认修改本地游戏包。请输入 APPLY " + fps + "：");
                    if (!String.Equals(Console.ReadLine(), "APPLY " + fps, StringComparison.Ordinal))
                    {
                        Console.WriteLine("已取消。");
                        continue;
                    }
                    tool.Apply(archive, fps);
                }
                else if (choice == "3")
                {
                    Console.Write("确认恢复。请输入 RESTORE：");
                    if (!String.Equals(Console.ReadLine(), "RESTORE", StringComparison.Ordinal))
                    {
                        Console.WriteLine("已取消。");
                        continue;
                    }
                    tool.Restore(archive);
                }
                else if (choice == "4") tool.EnsureOriginalBackup(archive);
                else if (choice == "5") tool.Status(archive);
                else Console.WriteLine("无效选择。");
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("操作失败：" + ex.Message);
                Console.ResetColor();
            }
        }
    }
}
