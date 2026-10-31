using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

// Conditional adaptation for the two reviewed stock module families.  A
// function-level match alone does not establish the provenance of a module.
internal sealed partial class NativeFpsTool
{
    private const string AdaptiveTableHash = "A6B05CC791E7C27EA0267CF321D9AAA8E08294F15429DE8C79E75359F7E21CD1";
    private static readonly string[,] AdaptiveRawHashes = {
        {"D7A7C7A4DB42C83483C1D5B5D191C5D0D2F21C68E9A1EA7A7FB13175E7BFCCD5", "0512E447D80DEF34A1F5EF5BF92D8F52087989ED3B12BDFA4A64DCBF396D79EB"},
        {"77517C61E84E111642A3DB0B49DDD804B886F65E40F77A9DEC28250A8076DCFB", "F3518D8E068F6754A634D795A27FAFBA9BC0D9DC700D7A1B7DB1E005E524C243"},
        {"6A39CF2B3BA2AF42A9A6F65F7273AE3C1D2E08477B3B3342A263C7D88D997C65", "AC3B9B6991B9794A5258B10237FD41CDF865678015EACABCE5A4D27985C2D805"},
        {"FF8DBF3EF199293EEA064E7B573142E95D73B461963CB4E1407F14FD1F270F3A", "2DA2233EC6C1EEC86E1619628207BEC0894DB5894A3BEC35CFCFDE138D4CFCE7"}
    };

    private sealed class AdaptiveRecord
    {
        internal long Offset;
        internal int Length, RawLength;
        internal uint Checksum1, Checksum2, Compression;
    }
    private sealed class AdaptiveTemplate
    {
        internal string Name;
        internal byte[] Original, Patched;
        internal int OriginalLine, PatchedLine;
        internal bool Edited;
    }
    private sealed class AdaptiveModule
    {
        internal string Name;
        internal AdaptiveRecord Record;
        internal byte[] Slot, Raw, PatchedRaw;
        internal int Profile, State; // 0 original, 1 native, 2 legacy, 3 prototype, -1 unknown
    }
    private sealed class AdaptiveFiles : IDisposable
    {
        internal FileStream Lc;
        internal readonly List<FileStream> Tables = new List<FileStream>();
        internal string[] TablePaths;
        internal bool[] TableExists;
        internal DateTime LcWriteTime;
        internal FileStream Version;
        public void Dispose()
        {
            if (Version != null) Version.Dispose();
            foreach (FileStream f in Tables) f.Dispose();
            if (Lc != null) Lc.Dispose();
        }
    }
    private sealed class AdaptiveRecovery
    {
        internal string Directory, State;
        internal byte[][] Original;
    }
    private sealed class AdaptiveJournalCandidate
    {
        internal string Directory, Created, State, Operation;
    }

    private static uint AdaptiveUInt(byte[] b, int offset)
    {
        if (offset < 0 || offset > b.Length - 4) throw new InvalidDataException("NXPK 字段越界。");
        return BitConverter.ToUInt32(b, offset);
    }

    private static Dictionary<string, AdaptiveRecord> AdaptiveIndex(FileStream f, bool modules)
    {
        if (f.Length < 1024 * 1024 || f.Length > UInt32.MaxValue) throw new InvalidDataException("NPK 文件大小异常。");
        byte[] header = LifeAfterPresetLauncher.FpsDecryptAesEcb(ReadAt(f, 0, 32));
        if (Encoding.ASCII.GetString(header, 8, 4) != "NXPK" || AdaptiveUInt(header, 12) != 3)
            throw new InvalidDataException("只支持已审查的 NXPK v3 格式。");
        long indexOffset = AdaptiveUInt(header, 16);
        long count = AdaptiveUInt(header, 20);
        long size = checked(count * 48L);
        if (count < 1 || count > 500000 || indexOffset < 32 || indexOffset + size != f.Length || size > Int32.MaxValue)
            throw new InvalidDataException("NXPK 索引边界异常。");
        byte[] index = LifeAfterPresetLauncher.FpsDecryptAesEcb(ReadAt(f, indexOffset, (int)size));
        Dictionary<string, AdaptiveRecord> result = new Dictionary<string, AdaptiveRecord>();
        for (int pos = 0; pos < index.Length; pos += 48)
        {
            uint id = AdaptiveUInt(index, pos), sub = AdaptiveUInt(index, pos + 4);
            string name = modules && id == 4238962030U && sub == 3758457633U ? "manager" :
                modules && id == 3833001992U && sub == 1994708130U ? "panel" :
                !modules && id == 434151284U && sub == 1857827987U ? "table" : null;
            if (name == null) continue;
            if (result.ContainsKey(name)) throw new InvalidDataException("NXPK 中存在重复的 " + name + " 记录。");
            AdaptiveRecord rec = new AdaptiveRecord {
                Offset = AdaptiveUInt(index, pos + 8),
                Length = checked((int)AdaptiveUInt(index, pos + 12)),
                RawLength = checked((int)AdaptiveUInt(index, pos + 16)),
                Checksum1 = AdaptiveUInt(index, pos + 20), Checksum2 = AdaptiveUInt(index, pos + 24),
                Compression = AdaptiveUInt(index, pos + 28)
            };
            for (int i = 32; i < 48; i += 4)
                if (AdaptiveUInt(index, pos + i) != 0) throw new InvalidDataException("NXPK 目标记录保留字段发生变化。");
            if (rec.Offset < 32 || rec.Length <= 0 || rec.Offset + rec.Length > indexOffset)
                throw new InvalidDataException("NXPK 目标记录边界异常。");
            result.Add(name, rec);
        }
        if (modules && (!result.ContainsKey("manager") || !result.ContainsKey("panel")))
            throw new InvalidDataException("缺少帧率模块记录。");
        // No other indexed record may alias a target's writable byte range.
        foreach (AdaptiveRecord target in result.Values)
        {
            int overlaps = 0;
            for (int pos = 0; pos < index.Length; pos += 48)
            {
                long start = AdaptiveUInt(index, pos + 8), length = AdaptiveUInt(index, pos + 12);
                if (length > 0 && start < target.Offset + target.Length && target.Offset < start + length) overlaps++;
            }
            if (overlaps != 1) throw new InvalidDataException("NXPK 目标记录与其他记录重叠。");
        }
        return result;
    }

    private static AdaptiveFiles AdaptiveOpen(string root, bool write)
    {
        AdaptiveFiles files = new AdaptiveFiles();
        try
        {
            FileShare share = write ? FileShare.None : FileShare.ReadWrite;
            string docs = Path.Combine(root, "Documents");
            files.Lc = new FileStream(Path.Combine(docs, FileNames[1]), FileMode.Open,
                write ? FileAccess.ReadWrite : FileAccess.Read, share);
            files.LcWriteTime = File.GetLastWriteTimeUtc(files.Lc.Name);
            files.TablePaths = new[] {Path.Combine(docs, FileNames[0]), Path.Combine(root, FileNames[0])};
            files.TableExists = files.TablePaths.Select(File.Exists).ToArray();
            foreach (string p in files.TablePaths)
                if (File.Exists(p)) files.Tables.Add(new FileStream(p, FileMode.Open, FileAccess.Read, share));
            string version = Path.Combine(docs, "update.ini");
            if (File.Exists(version)) files.Version = new FileStream(version, FileMode.Open, FileAccess.Read, share);
            if (files.Tables.Count == 0) throw new FileNotFoundException("未找到帧率数据表所在的游戏包体。");
            return files;
        }
        catch { files.Dispose(); throw; }
    }

    private static void AdaptiveVerifyTable(AdaptiveFiles files)
    {
        int matches = 0;
        foreach (FileStream f in files.Tables)
        {
            Dictionary<string, AdaptiveRecord> records = AdaptiveIndex(f, false);
            AdaptiveRecord r;
            if (!records.TryGetValue("table", out r)) continue;
            matches++;
            if (r.Compression != 0 || r.Length != 640 || r.RawLength != 640 ||
                Hash(ReadAt(f, r.Offset, r.Length)) != AdaptiveTableHash)
                throw new InvalidDataException("帧率表内容或索引已变化，无法确认新增索引 7–10 未被占用。");
        }
        if (matches == 0) throw new InvalidDataException("未找到已审查的帧率表，无法确认游戏实际加载路径。");
    }

    private static List<AdaptiveTemplate> AdaptiveTemplates(string module)
    {
        object document = Json.DeserializeObject(Encoding.UTF8.GetString(Resource("adaptive-contract.json")));
        Dictionary<string, object> root = (Dictionary<string, object>)document;
        if (Convert.ToInt32(root["version"], CultureInfo.InvariantCulture) != 1)
            throw new InvalidDataException("适配契约版本异常。");
        Dictionary<string, object> modules = (Dictionary<string, object>)root["modules"];
        object[] values = (object[])modules[module];
        List<AdaptiveTemplate> result = new List<AdaptiveTemplate>();
        foreach (object value in values)
        {
            Dictionary<string, object> item = (Dictionary<string, object>)value;
            AdaptiveTemplate template = new AdaptiveTemplate {
                Name = (string)item["name"], Original = Convert.FromBase64String((string)item["original"]),
                Patched = Convert.FromBase64String((string)item["patched"]),
                OriginalLine = Convert.ToInt32(item["originalLineOffset"], CultureInfo.InvariantCulture),
                PatchedLine = Convert.ToInt32(item["patchedLineOffset"], CultureInfo.InvariantCulture),
                Edited = (bool)item["edited"]
            };
            if (template.Original.Length != template.Patched.Length || template.OriginalLine < 0 ||
                template.OriginalLine > template.Original.Length - 4 || template.PatchedLine < 0 ||
                template.PatchedLine > template.Patched.Length - 4)
                throw new InvalidDataException("适配契约记录异常：" + template.Name);
            result.Add(template);
        }
        if (result.Count != (module == "manager" ? 6 : 3)) throw new InvalidDataException("适配契约不完整。");
        return result;
    }

    private static bool AdaptiveFunctionMatches(byte[] raw, int start, int size, byte[] reference, int line)
    {
        if (size != reference.Length) return false;
        for (int i = 0; i < size; i++)
            if ((i < line || i >= line + 4) && raw[start + i] != reference[i]) return false;
        return true;
    }

    private static byte[] AdaptiveEditModule(string module, byte[] raw, bool alreadyPatched)
    {
        string expectedName = module == "manager" ? "SettingManager" : "ui.PanelSetting";
        int nameSize = checked((int)AdaptiveUInt(raw, 0));
        if (nameSize <= 0 || nameSize > 256 || 4 + nameSize > raw.Length ||
            Encoding.UTF8.GetString(raw, 4, nameSize) != expectedName)
            throw new InvalidDataException("模块名称不匹配：" + module);
        List<AdaptiveTemplate> templates = AdaptiveTemplates(module);
        int[] counts = new int[templates.Count];
        byte[] result = (byte[])raw.Clone();
        int pos = 4 + nameSize;
        while (pos < raw.Length)
        {
            int size = checked((int)AdaptiveUInt(raw, pos));
            int start = checked(pos + 4);
            if (size <= 0 || start > raw.Length - size) throw new InvalidDataException("模块函数记录边界异常。");
            for (int i = 0; i < templates.Count; i++)
            {
                AdaptiveTemplate t = templates[i];
                byte[] pattern = alreadyPatched ? t.Patched : t.Original;
                int patternLine = alreadyPatched ? t.PatchedLine : t.OriginalLine;
                if (!AdaptiveFunctionMatches(raw, start, size, pattern, patternLine)) continue;
                counts[i]++;
                if (!alreadyPatched && t.Edited)
                {
                    byte[] line = new byte[4];
                    Buffer.BlockCopy(raw, start + t.OriginalLine, line, 0, 4);
                    Buffer.BlockCopy(t.Patched, 0, result, start, size);
                    Buffer.BlockCopy(line, 0, result, start + t.PatchedLine, 4);
                }
            }
            pos = checked(start + size);
        }
        if (pos != raw.Length) throw new InvalidDataException("模块记录长度异常。");
        for (int i = 0; i < counts.Length; i++)
            if (counts[i] != 1) throw new InvalidDataException("帧率相关函数缺失、重复或语义发生变化：" + templates[i].Name);
        return result;
    }

    private static AdaptiveModule[] AdaptiveModules(FileStream lc)
    {
        Dictionary<string, AdaptiveRecord> index = AdaptiveIndex(lc, true);
        string[] names = {"manager", "panel"};
        AdaptiveModule[] result = new AdaptiveModule[2];
        for (int i = 0; i < result.Length; i++)
        {
            AdaptiveRecord r = index[names[i]];
            if (r.Compression != 2 || r.Length < 4096 || r.Length > 8 * 1024 * 1024 ||
                r.RawLength < r.Length || r.RawLength > 16 * 1024 * 1024)
                throw new InvalidDataException("目标记录压缩方式或大小不受支持：" + names[i]);
            AdaptiveModule m = new AdaptiveModule {Name = names[i], Record = r, Slot = ReadAt(lc, r.Offset, r.Length), State = -1, Profile = -1};
            try { m.Raw = LifeAfterPresetLauncher.FpsDecodeLz4Exact(m.Slot, r.RawLength); }
            catch (Exception) { m.Raw = null; }
            if (m.Raw != null)
            {
                string rawHash = Hash(m.Raw);
                for (int profile = 0; profile < 2; profile++)
                    for (int state = 0; state < 2; state++)
                        if (rawHash == AdaptiveRawHashes[profile * 2 + i, state]) {m.Profile = profile; m.State = state;}
                if (m.State >= 0)
                {
                    m.PatchedRaw = AdaptiveEditModule(m.Name, m.Raw, m.State == 1);
                    if (Hash(m.PatchedRaw) != AdaptiveRawHashes[m.Profile * 2 + i, 1])
                        throw new InvalidDataException("生成结果与已审查语义不一致。");
                }
            }
            string slotHash = Hash(m.Slot);
            if (m.State < 0 && i == 0 && slotHash == "A95BC03189E73E96EDB4E8DD3739C9E4EDD5547273154811F7136B204E5FCAE9") {m.State = 2; m.Profile = 0;}
            if (m.State < 0 && i == 0 && slotHash == "99851F4D8D60B7D633CD316536708B62988CF612233FC95A8A49A500C56C14CD") {m.State = 2; m.Profile = 1;}
            if (m.State < 0 && slotHash == (i == 0 ? "FC953B5733F582011C358967DA2F841C0A5D7E38133E9B413BC11237FCBE8C1B" : "F4DE5E7747E70E1DB640933D5BA71EBB99C055FDB2E400B6D67CFA9B059F60E2")) {m.State = 3; m.Profile = 1;}
            result[i] = m;
        }
        return result;
    }

    private static string AdaptiveNormalizedHash(FileStream f, AdaptiveModule[] modules)
    {
        using (SHA256 h = SHA256.Create())
        {
            long pos = 0;
            foreach (AdaptiveModule m in modules.OrderBy(x => x.Record.Offset))
            {
                if (m.Record.Offset < pos || m.Record.Offset + m.Record.Length > f.Length)
                    throw new InvalidDataException("目标记录边界重叠。");
                HashRange(f, h, pos, m.Record.Offset - pos);
                byte[] zeros = new byte[m.Record.Length];
                h.TransformBlock(zeros, 0, zeros.Length, null, 0);
                pos = m.Record.Offset + m.Record.Length;
            }
            HashRange(f, h, pos, f.Length - pos);
            h.TransformFinalBlock(new byte[0], 0, 0);
            return BitConverter.ToString(h.Hash).Replace("-", "");
        }
    }

    private static bool AdaptiveHasNativeSlots(string root)
    {
        try
        {
            using (FileStream lc = new FileStream(Path.Combine(root, "Documents", FileNames[1]), FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                AdaptiveModule[] modules = AdaptiveModules(lc);
                // The legacy mode may recognize an older manager of its own,
                // but must not overwrite a package with an unknown panel.
                return modules.Any(x => x.State == 1 || x.State == 3) || modules[1].State != 0;
            }
        }
        catch (Exception) { return false; }
    }

    private static void AdaptiveWriteFile(string path, byte[] data)
    {
        using (FileStream f = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        { f.Write(data, 0, data.Length); f.Flush(true); }
        if (FileHash(path) != Hash(data)) throw new IOException("事务记录写入校验失败。");
    }

    private static bool AdaptiveSameLayout(AdaptiveModule[] left, AdaptiveModule[] right)
    {
        for (int i = 0; i < 2; i++)
            if (left[i].Record.Offset != right[i].Record.Offset || left[i].Record.Length != right[i].Record.Length ||
                left[i].Record.RawLength != right[i].Record.RawLength || left[i].Record.Checksum1 != right[i].Record.Checksum1 ||
                left[i].Record.Checksum2 != right[i].Record.Checksum2 || left[i].Record.Compression != right[i].Record.Compression)
                return false;
        return true;
    }

    private AdaptiveRecovery AdaptiveRecoveryFromJournal(string dir, FileStream lc, AdaptiveModule[] current, string normalized)
    {
        string path = Path.Combine(dir, "adaptive-journal.json");
        if (!File.Exists(path)) return null;
        Dictionary<string, object> j = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path, Encoding.UTF8));
        if ((string)j["schema"] != "native-adaptive-v1" || (string)j["normalized"] != normalized ||
            Convert.ToInt64(j["length"], CultureInfo.InvariantCulture) != lc.Length) return null;
        string state = (string)j["state"];
        if (state != "prepared" && state != "installed") return null;
        string fullBackup = Path.Combine(dir, "script.py314.lc.npk.before");
        if (!File.Exists(fullBackup) || FileHash(fullBackup) != (string)j["beforeSha256"]) return null;
        using (FileStream backup = new FileStream(fullBackup, FileMode.Open, FileAccess.Read, FileShare.Read))
        {
            AdaptiveModule[] backupModules = AdaptiveModules(backup);
            if (!AdaptiveSameLayout(current, backupModules) || AdaptiveNormalizedHash(backup, backupModules) != normalized) return null;
        }
        System.Collections.IList hashes = (System.Collections.IList)j["originalSha256"];
        if (hashes.Count != 2) return null;
        byte[][] original = new byte[2][];
        int profile = -1;
        for (int i = 0; i < 2; i++)
        {
            original[i] = File.ReadAllBytes(Path.Combine(dir, "original-" + i + ".bin"));
            if (original[i].Length != current[i].Record.Length || Hash(original[i]) != (string)hashes[i]) return null;
            byte[] raw = LifeAfterPresetLauncher.FpsDecodeLz4Exact(original[i], current[i].Record.RawLength);
            int found = -1;
            for (int p = 0; p < 2; p++) if (Hash(raw) == AdaptiveRawHashes[p * 2 + i, 0]) found = p;
            if (found < 0 || (profile >= 0 && profile != found)) return null;
            profile = found;
            byte[] patched = AdaptiveEditModule(current[i].Name, raw, false);
            if (Hash(patched) != AdaptiveRawHashes[profile * 2 + i, 1]) return null;
            if (state != "prepared" && (current[i].State < 0 || current[i].State > 1 || current[i].Profile != profile)) return null;
        }
        return new AdaptiveRecovery {Directory = dir, State = state, Original = original};
    }

    private AdaptiveRecovery AdaptiveFindRecovery(string root, FileStream lc, AdaptiveModule[] modules)
    {
        string directory = BackupDirectory(root);
        if (Directory.Exists(directory))
        {
            string normalized = AdaptiveNormalizedHash(lc, modules);
            List<AdaptiveJournalCandidate> candidates = new List<AdaptiveJournalCandidate>();
            foreach (string dir in Directory.GetDirectories(directory))
            {
                try
                {
                    if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0) continue;
                    string path = Path.Combine(dir, "adaptive-journal.json");
                    if (!File.Exists(path)) continue;
                    Dictionary<string, object> j = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path, Encoding.UTF8));
                    if ((string)j["schema"] != "native-adaptive-v1" || (string)j["normalized"] != normalized ||
                        Convert.ToInt64(j["length"], CultureInfo.InvariantCulture) != lc.Length) continue;
                    candidates.Add(new AdaptiveJournalCandidate {Directory = dir, Created = (string)j["createdUtc"],
                        State = (string)j["state"], Operation = (string)j["operation"]});
                }
                catch (Exception) { /* A damaged or unrelated backup is never used as evidence. */ }
            }
            foreach (AdaptiveJournalCandidate candidate in candidates.OrderByDescending(x => x.Created, StringComparer.Ordinal).Take(200))
            {
                // A later completed restoration retires older prepared writes.
                // A failed restore, however, leaves the prior install in place.
                if (candidate.State == "restored" || (candidate.State == "rolled-back" && candidate.Operation == "apply")) break;
                if (candidate.State == "rolled-back") continue;
                if (candidate.State != "prepared" && candidate.State != "installed") break;
                try
                {
                    AdaptiveRecovery point = AdaptiveRecoveryFromJournal(candidate.Directory, lc, modules, normalized);
                    if (point != null) return point;
                }
                catch (Exception) { }
                // Do not fall back to an older transaction if the latest one
                // for these exact outside-slot bytes is damaged or stale.
                break;
            }
        }
        // v2.7.0's reviewed fever slots predate adaptive journals.  Only its
        // exact index metadata and its embedded official slots are accepted.
        if (modules.All(m => m.Profile == 1 && (m.State == 0 || m.State == 1 || m.State == 3)) &&
            (!modules.Any(m => m.State == 3) || modules.All(m => m.State == 3)) &&
            modules[0].Record.Length == 108926 && modules[0].Record.RawLength == 321019 &&
            modules[0].Record.Checksum1 == 1234500733U && modules[0].Record.Checksum2 == 3541560087U &&
            modules[1].Record.Length == 162653 && modules[1].Record.RawLength == 502316 &&
            modules[1].Record.Checksum1 == 1680435086U && modules[1].Record.Checksum2 == 3439556961U)
        {
            byte[][] originals = {Resource("manager.original.bin"), Resource("panel.original.bin")};
            if (Hash(originals[0]) == slots[1].OldHash && Hash(originals[1]) == slots[0].OldHash)
                return new AdaptiveRecovery {Directory = "内置的已审查发烧平台原始槽", State = "reviewed", Original = originals};
        }
        return null;
    }

    private Dictionary<string, object> AdaptiveResult(string root, string state, string message, string backup, bool restoreAvailable)
    {
        Dictionary<string, object> result = Result(root, state, message, backup);
        result["adaptation"] = "reviewed-modules";
        result["restoreAvailable"] = restoreAvailable;
        return result;
    }

    private Dictionary<string, object> AdaptiveStatus(string root)
    {
        using (AdaptiveFiles files = AdaptiveOpen(root, false))
        {
            AdaptiveVerifyTable(files);
            AdaptiveModule[] modules = AdaptiveModules(files.Lc);
            if (modules[0].State == 2 && modules[1].State == 0 && modules[0].Profile == modules[1].Profile)
                return AdaptiveResult(root, "legacy", "检测到旧版 120 帧接管；请先在工具的开发者选项中恢复，再启用游戏内四档。", null, false);
            if (modules.All(x => x.State == 3 && x.Profile == 1))
            {
                AdaptiveRecovery oldPrototype = AdaptiveFindRecovery(root, files.Lc, modules);
                Dictionary<string, object> result = AdaptiveResult(root, "prototype", "检测到旧版 240 帧实验版；请先恢复原始帧率，再重新适配。", null, oldPrototype != null);
                result["applyAvailable"] = false;
                return result;
            }
            bool known = modules.All(x => x.State >= 0) && modules[0].Profile == modules[1].Profile;
            if (known && modules.All(x => x.State == 0))
                return AdaptiveResult(root, "official", "原始帧率模块已通过审查；启用时将按当前包体位置自动生成。", null, false);
            AdaptiveRecovery recovery = AdaptiveFindRecovery(root, files.Lc, modules);
            if (!known)
            {
                if (recovery != null && recovery.State == "prepared")
                    return AdaptiveResult(root, "partial", "检测到上次操作中断；可使用同版本事务备份恢复。", null, true);
                throw new InvalidDataException("帧率模块来源未知、存在其他补丁或内容已经改变；仅函数相似不足以确认原始包体，已停止写入。");
            }
            if (modules.All(x => x.State == 1))
                return AdaptiveResult(root, "native", "游戏内四档已启用。" + (recovery == null ? "未找到同版本恢复依据。" : ""), null, recovery != null);
            return AdaptiveResult(root, "partial", recovery == null ? "检测到不完整的帧率修改，未找到同版本恢复依据。" : "检测到不完整的帧率修改，可从同版本备份恢复。", null, recovery != null);
        }
    }

    private static void AdaptiveEnsureUpdateFinished(string root, AdaptiveFiles files)
    {
        EnsureStopped();
        AdaptiveCheckNoNewerPart(root);
        string part = Path.Combine(root, "Documents", FileNames[1] + ".part");
        if (File.Exists(part) && File.GetLastWriteTimeUtc(part) > files.LcWriteTime)
            throw new IOException("检测到比操作前包体更新的未完成更新文件，请完成更新后重试。");
        if (!files.TableExists.SequenceEqual(files.TablePaths.Select(File.Exists)) ||
            (files.Version != null) != File.Exists(Path.Combine(root, "Documents", "update.ini")))
            throw new IOException("游戏包或版本记录在操作期间发生变化，请完成更新后重试。");
    }

    private static void AdaptiveCheckNoNewerPart(string root)
    {
        if (AdaptiveHasNewerPart(root))
            throw new IOException("检测到比当前包体更新的未完成更新文件；请先完成官方更新并退出更新器。");
    }

    private static bool AdaptiveHasNewerPart(string root)
    {
        string part = Path.Combine(root, "Documents", FileNames[1] + ".part");
        string lc = Path.Combine(root, "Documents", FileNames[1]);
        return File.Exists(part) && File.GetLastWriteTimeUtc(part) > File.GetLastWriteTimeUtc(lc);
    }

    private static string AdaptiveStreamHash(FileStream f)
    {
        f.Position = 0;
        using (SHA256 h = SHA256.Create()) return BitConverter.ToString(h.ComputeHash(f)).Replace("-", "");
    }

    private static string AdaptiveHashWithSlots(FileStream f, AdaptiveModule[] modules, byte[][] replacement)
    {
        using (SHA256 h = SHA256.Create())
        {
            long pos = 0;
            foreach (int i in Enumerable.Range(0, 2).OrderBy(i => modules[i].Record.Offset))
            {
                AdaptiveRecord r = modules[i].Record;
                if (r.Offset < pos || replacement[i].Length != r.Length) throw new InvalidDataException("替换槽位边界异常。");
                HashRange(f, h, pos, r.Offset - pos);
                h.TransformBlock(replacement[i], 0, replacement[i].Length, null, 0);
                pos = r.Offset + r.Length;
            }
            HashRange(f, h, pos, f.Length - pos);
            h.TransformFinalBlock(new byte[0], 0, 0);
            return BitConverter.ToString(h.Hash).Replace("-", "");
        }
    }

    private static Dictionary<string, object> AdaptiveMakeJournal(string root, FileStream lc, AdaptiveModule[] modules,
        string directory, byte[][] originals, string operation)
    {
        string normalized = AdaptiveNormalizedHash(lc, modules);
        string beforeHash = AdaptiveStreamHash(lc);
        Backup(lc, Path.Combine(directory, "script.py314.lc.npk.before"), beforeHash);
        for (int i = 0; i < 2; i++) AdaptiveWriteFile(Path.Combine(directory, "original-" + i + ".bin"), originals[i]);
        Dictionary<string, object> journal = new Dictionary<string, object> {
            {"schema", "native-adaptive-v1"}, {"operation", operation}, {"root", root},
            {"state", "prepared"}, {"length", lc.Length}, {"normalized", normalized},
            {"beforeSha256", beforeHash}, {"originalSha256", originals.Select(Hash).ToArray()},
            {"createdUtc", DateTime.UtcNow.ToString("O")}
        };
        SaveJournal(Path.Combine(directory, "adaptive-journal.json"), journal);
        return journal;
    }

    private static void AdaptiveCheckSpace(string directory, long bytes)
    {
        if (new DriveInfo(Path.GetPathRoot(directory)).AvailableFreeSpace < bytes + 64L * 1024 * 1024)
            throw new IOException("游戏目录所在磁盘空间不足，无法创建同版本完整备份。");
    }

    private Dictionary<string, object> AdaptiveApply(string root)
    {
        using (Mutex mutex = new Mutex(false, "Local\\Native240OptionV03-" + Hash(Encoding.UTF8.GetBytes(root.ToUpperInvariant())).Substring(0, 20)))
        {
            if (!mutex.WaitOne(0)) throw new IOException("另一个工具正在操作此包体。");
            try
            {
                using (AdaptiveFiles files = AdaptiveOpen(root, true))
                {
                    AdaptiveEnsureUpdateFinished(root, files);
                    AdaptiveVerifyTable(files);
                    AdaptiveModule[] modules = AdaptiveModules(files.Lc);
                    if (modules.Any(x => x.State == 2))
                        throw new InvalidDataException("检测到旧版接管模式；请先在开发者选项中恢复官方帧率。");
                    if (modules.Any(x => x.State == 3))
                        throw new InvalidDataException("检测到旧版实验档位；请先恢复原始帧率再重新适配。");
                    if (modules.Any(x => x.State < 0) || modules[0].Profile != modules[1].Profile)
                        throw new InvalidDataException("帧率模块来源未知、存在其他补丁或内容已经改变；已停止自动适配。");
                    if (modules.All(x => x.State == 1))
                        return AdaptiveResult(root, "native", "游戏内四档已经安装，无需重复写入。", null, AdaptiveFindRecovery(root, files.Lc, modules) != null);
                    if (modules.Any(x => x.State != 0)) throw new InvalidDataException("包体处于部分修改状态，请先恢复。");
                    List<FileStream> configs = new List<FileStream>();
                    try
                    {
                        string configDir = Path.Combine(root, "Documents", "configs");
                        string[] configPaths = new[] {"pcconfig", "qualityconfig", "optconfig"}.Select(name => Path.Combine(configDir, name)).ToArray();
                        bool[] configExists = configPaths.Select(File.Exists).ToArray();
                        foreach (string path in configPaths)
                        {
                            if (File.Exists(path)) configs.Add(new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None));
                        }
                        FileStream quality = configs.FirstOrDefault(f => String.Equals(f.Name, configPaths[1], StringComparison.OrdinalIgnoreCase));
                        if (quality != null)
                        {
                            if (quality.Length > 8 * 1024 * 1024) throw new InvalidDataException("qualityconfig 尺寸异常。");
                            string text; int bom, start, end;
                            ParseNativeQuality(ReadAt(quality, 0, (int)quality.Length), out text, out bom, out start, out end);
                        }
                        string[] configHashes = configs.Select(AdaptiveStreamHash).ToArray();
                        byte[][] generated = modules.Select(m => LifeAfterPresetLauncher.FpsCompressLz4Fixed(m.PatchedRaw, m.Record.Length)).ToArray();
                        for (int i = 0; i < 2; i++)
                            if (Hash(LifeAfterPresetLauncher.FpsDecodeLz4Exact(generated[i], modules[i].Record.RawLength)) != AdaptiveRawHashes[modules[i].Profile * 2 + i, 1])
                                throw new InvalidDataException("生成槽位的反解校验失败。");
                        string dir = Path.Combine(BackupDirectory(root), DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-adaptive-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                        Directory.CreateDirectory(dir);
                        AdaptiveCheckSpace(dir, files.Lc.Length);
                        byte[][] originals = modules.Select(x => x.Slot).ToArray();
                        Dictionary<string, object> journal = AdaptiveMakeJournal(root, files.Lc, modules, dir, originals, "apply");
                        string expectedAfter = AdaptiveHashWithSlots(files.Lc, modules, generated);
                        AdaptiveEnsureUpdateFinished(root, files);
                        try
                        {
                            for (int i = 0; i < 2; i++) WriteAt(files.Lc, modules[i].Record.Offset, generated[i]);
                            files.Lc.Flush(true);
                            AdaptiveEnsureUpdateFinished(root, files);
                            AdaptiveModule[] after = AdaptiveModules(files.Lc);
                            if (!after.All(x => x.State == 1) || after[0].Profile != after[1].Profile ||
                                AdaptiveNormalizedHash(files.Lc, after) != (string)journal["normalized"] ||
                                AdaptiveStreamHash(files.Lc) != expectedAfter ||
                                !configExists.SequenceEqual(configPaths.Select(File.Exists)) ||
                                !configHashes.SequenceEqual(configs.Select(AdaptiveStreamHash), StringComparer.Ordinal))
                                throw new IOException("写入后校验失败。");
                            for (int i = 0; i < 2; i++) if (Hash(after[i].Slot) != Hash(generated[i])) throw new IOException("写入槽位校验失败。");
                            journal["state"] = "installed"; SaveJournal(Path.Combine(dir, "adaptive-journal.json"), journal);
                            return AdaptiveResult(root, "native", "自动适配完成；原有配置已保留。请在游戏内选择所需帧率。", dir, true);
                        }
                        catch
                        {
                            for (int i = 0; i < 2; i++) WriteAt(files.Lc, modules[i].Record.Offset, originals[i]);
                            files.Lc.Flush(true);
                            if (AdaptiveStreamHash(files.Lc) != (string)journal["beforeSha256"])
                                throw new IOException("自动回滚校验失败，请勿启动游戏；完整备份：" + dir);
                            journal["state"] = "rolled-back"; SaveJournal(Path.Combine(dir, "adaptive-journal.json"), journal);
                            throw;
                        }
                    }
                    finally { foreach (FileStream f in configs) f.Dispose(); }
                }
            }
            finally { mutex.ReleaseMutex(); }
        }
    }

    private Dictionary<string, object> AdaptiveRestore(string root)
    {
        using (Mutex mutex = new Mutex(false, "Local\\Native240OptionV03-" + Hash(Encoding.UTF8.GetBytes(root.ToUpperInvariant())).Substring(0, 20)))
        {
            if (!mutex.WaitOne(0)) throw new IOException("另一个工具正在操作此包体。");
            try
            {
                using (AdaptiveFiles files = AdaptiveOpen(root, true))
                {
                    AdaptiveEnsureUpdateFinished(root, files);
                    AdaptiveVerifyTable(files);
                    AdaptiveModule[] modules = AdaptiveModules(files.Lc);
                    AdaptiveRecovery recovery = AdaptiveFindRecovery(root, files.Lc, modules);
                    if (recovery == null)
                        throw new InvalidDataException("没有找到与当前包体一致的原始槽和同版本事务备份，拒绝跨版本恢复。");
                    string dir = Path.Combine(BackupDirectory(root), DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-adaptive-restore-" + Guid.NewGuid().ToString("N").Substring(0, 8));
                    Directory.CreateDirectory(dir);
                    AdaptiveCheckSpace(dir, files.Lc.Length);
                    byte[][] before = modules.Select(x => x.Slot).ToArray();
                    Dictionary<string, object> journal = AdaptiveMakeJournal(root, files.Lc, modules, dir, recovery.Original, "restore");
                    string expectedAfter = AdaptiveHashWithSlots(files.Lc, modules, recovery.Original);
                    NativeFpsConfigEdit config = null;
                    bool wroteConfig = false, wroteSlots = false;
                    try
                    {
                        config = PrepareConfig(root, dir);
                        if (config != null)
                        {
                            journal["configBackup"] = Path.GetFileName(config.Backup);
                            journal["configBeforeSha256"] = Hash(config.Before);
                            SaveJournal(Path.Combine(dir, "adaptive-journal.json"), journal);
                        }
                        AdaptiveEnsureUpdateFinished(root, files);
                        // Reset an added index before returning the modules to stock;
                        // a crash cannot leave stock code with a newly written index.
                        if (config != null)
                        {
                            wroteConfig = true;
                            WriteAt(config.Stream, 0, config.After); config.Stream.SetLength(config.After.Length); config.Stream.Flush(true);
                            if (Hash(ReadAt(config.Stream, 0, config.After.Length)) != Hash(config.After)) throw new IOException("帧率配置恢复校验失败。");
                        }
                        for (int i = 0; i < 2; i++) {wroteSlots = true; WriteAt(files.Lc, modules[i].Record.Offset, recovery.Original[i]);}
                        files.Lc.Flush(true);
                        AdaptiveEnsureUpdateFinished(root, files);
                        AdaptiveModule[] after = AdaptiveModules(files.Lc);
                        if (!after.All(x => x.State == 0) || after[0].Profile != after[1].Profile ||
                            AdaptiveStreamHash(files.Lc) != expectedAfter || AdaptiveNormalizedHash(files.Lc, after) != (string)journal["normalized"])
                            throw new IOException("恢复后整包校验失败。");
                        journal["state"] = "restored"; SaveJournal(Path.Combine(dir, "adaptive-journal.json"), journal);
                        return AdaptiveResult(root, "official", "已恢复同版本原始帧率模块。" + (config != null ? "新增帧率选择已回退到 120 帧。" : ""), dir, false);
                    }
                    catch
                    {
                        if (wroteSlots)
                        {
                            for (int i = 0; i < 2; i++) WriteAt(files.Lc, modules[i].Record.Offset, before[i]);
                            files.Lc.Flush(true);
                        }
                        if (config != null && wroteConfig)
                        {
                            WriteAt(config.Stream, 0, config.Before); config.Stream.SetLength(config.Before.Length); config.Stream.Flush(true);
                            if (Hash(ReadAt(config.Stream, 0, config.Before.Length)) != Hash(config.Before))
                                throw new IOException("配置回滚校验失败，请勿启动游戏；备份：" + dir);
                        }
                        if (AdaptiveStreamHash(files.Lc) != (string)journal["beforeSha256"])
                            throw new IOException("恢复失败且回滚校验失败，请勿启动游戏；备份：" + dir);
                        journal["state"] = "rolled-back"; SaveJournal(Path.Combine(dir, "adaptive-journal.json"), journal);
                        throw;
                    }
                    finally { if (config != null) config.Stream.Dispose(); }
                }
            }
            finally { mutex.ReleaseMutex(); }
        }
    }
}
