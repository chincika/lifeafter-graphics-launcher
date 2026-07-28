using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;

internal static class FpsSlotLabTests
{
    private static readonly byte[] Key = new byte[]
    {
        96, 99, 8, 216, 163, 44, 120, 32, 19, 210, 108, 47, 34, 111, 104, 109
    };

    private const int SlotSize = 111676;
    private const int DataOffset = 65536;

    [STAThread]
    public static int Main()
    {
        string testRoot = Path.Combine(Path.GetTempPath(), "fps-slot-lab-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(testRoot);
            Environment.SetEnvironmentVariable("FPS_SLOT_LAB_DATA_DIR", Path.Combine(testRoot, "tool-data"));
            string gameRoot = CreateSyntheticGame(testRoot);
            FpsEngine engine = new FpsEngine();

            AnalysisResult initial = engine.Analyze(gameRoot);
            Assert(initial.Success, "Initial analysis failed: " + initial.Error);
            Assert(initial.CurrentFps == 120, "Initial slot should be 120.");

            byte[] before = File.ReadAllBytes(initial.Location.ArchivePath);
            Dictionary<string, string> configBefore = ReadConfigHashes(gameRoot);
            OperationResult apply = engine.Apply(gameRoot, 260, null);
            Assert(apply.Success, "Apply failed: " + apply.Error);

            AnalysisResult applied = engine.Analyze(gameRoot);
            Assert(applied.Success && applied.CurrentFps == 260, "Applied slot should be 260.");
            Assert(applied.FirstBackupAvailable, "First backup was not created.");
            byte[] after = File.ReadAllBytes(applied.Location.ArchivePath);
            AssertOutsideSlotEqual(before, after);
            AssertConfigHashesEqual(configBefore, ReadConfigHashes(gameRoot));

            OperationResult restore = engine.RestoreFirstBackup(gameRoot, null);
            Assert(restore.Success, "Restore failed: " + restore.Error);
            AnalysisResult restored = engine.Analyze(gameRoot);
            Assert(restored.Success && restored.CurrentFps == 120, "Restored slot should be 120.");
            byte[] restoredBytes = File.ReadAllBytes(restored.Location.ArchivePath);
            Assert(ByteArraysEqual(before, restoredBytes), "Restored NPK differs from original synthetic NPK.");

            using (FileStream stream = new FileStream(restored.Location.ArchivePath, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                stream.Position = DataOffset + 100;
                int value = stream.ReadByte();
                stream.Position = DataOffset + 100;
                stream.WriteByte((byte)(value ^ 0x01));
                stream.Flush(true);
            }
            AnalysisResult unknown = engine.Analyze(gameRoot);
            Assert(unknown.Success && !unknown.CurrentFps.HasValue, "Mutated slot should be unknown.");
            OperationResult refused = engine.Apply(gameRoot, 280, null);
            Assert(!refused.Success, "Apply should refuse an unknown current slot.");

            CaptureUiSnapshot();
            Console.WriteLine("PASS: analyze, apply, outside-slot integrity, config integrity, restore, unknown-slot refusal");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("FAIL: " + ex);
            return 1;
        }
        finally
        {
            Environment.SetEnvironmentVariable("FPS_SLOT_LAB_DATA_DIR", null);
            try
            {
                string full = Path.GetFullPath(testRoot);
                string temp = Path.GetFullPath(Path.GetTempPath());
                if (full.StartsWith(temp, StringComparison.OrdinalIgnoreCase) &&
                    Path.GetFileName(full).StartsWith("fps-slot-lab-tests-", StringComparison.Ordinal))
                    Directory.Delete(full, true);
            }
            catch { }
        }
    }

    private static void CaptureUiSnapshot()
    {
        string output = Environment.GetEnvironmentVariable("FPS_SLOT_LAB_UI_SNAPSHOT");
        if (String.IsNullOrWhiteSpace(output)) return;
        string directory = Path.GetDirectoryName(output);
        Directory.CreateDirectory(directory);
        Environment.SetEnvironmentVariable("FPS_SLOT_LAB_SKIP_AUTODETECT", "1");
        try
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (MainForm form = new MainForm())
            {
                form.StartPosition = FormStartPosition.Manual;
                form.Location = new Point(-30000, -30000);
                form.ShowInTaskbar = false;
                form.Show();
                Application.DoEvents();
                using (Bitmap bitmap = new Bitmap(form.ClientSize.Width, form.ClientSize.Height))
                {
                    form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, bitmap.Size));
                    bitmap.Save(output, ImageFormat.Png);
                }
                form.Close();
            }
        }
        finally
        {
            Environment.SetEnvironmentVariable("FPS_SLOT_LAB_SKIP_AUTODETECT", null);
        }
    }

    private static string CreateSyntheticGame(string testRoot)
    {
        string gameRoot = Path.Combine(testRoot, "LifeAfter");
        string docs = Path.Combine(gameRoot, "Documents");
        string configs = Path.Combine(docs, "configs");
        string bin = Path.Combine(docs, @"bin\x64");
        Directory.CreateDirectory(configs);
        Directory.CreateDirectory(bin);
        File.WriteAllBytes(Path.Combine(gameRoot, "mingrizhihou.exe"), new byte[] { 0 });
        File.WriteAllBytes(Path.Combine(bin, "lifeafter.exe"), new byte[] { 0 });
        File.WriteAllText(Path.Combine(configs, "qualityconfig"), "quality-test", Encoding.UTF8);
        File.WriteAllText(Path.Combine(configs, "clientconfig"), "client-test", Encoding.UTF8);
        File.WriteAllText(Path.Combine(configs, "pcconfig"), "pc-test", Encoding.UTF8);

        string patchPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, @"patches\patch_120.bin");
        byte[] patch = File.ReadAllBytes(patchPath);
        Assert(patch.Length == SlotSize, "Test patch length is wrong.");

        int fileSize = 2 * 1024 * 1024;
        int indexOffset = fileSize - 48;
        byte[] file = new byte[fileSize];
        byte[] header = new byte[32];
        Encoding.ASCII.GetBytes("NXPK").CopyTo(header, 8);
        WriteUInt32(header, 12, 3);
        WriteUInt32(header, 16, (uint)indexOffset);
        WriteUInt32(header, 20, 1);
        Encrypt(header).CopyTo(file, 0);

        patch.CopyTo(file, DataOffset);
        byte[] index = new byte[48];
        WriteUInt32(index, 0, 4238962030);
        WriteUInt32(index, 4, 3758457633);
        WriteUInt32(index, 8, DataOffset);
        WriteUInt32(index, 12, SlotSize);
        WriteUInt32(index, 16, 332550);
        WriteUInt32(index, 20, 2755559603);
        WriteUInt32(index, 24, 618724858);
        WriteUInt32(index, 28, 2);
        Encrypt(index).CopyTo(file, indexOffset);

        File.WriteAllBytes(Path.Combine(docs, "script.py314.lc.npk"), file);
        return gameRoot;
    }

    private static byte[] Encrypt(byte[] data)
    {
        using (Aes aes = Aes.Create())
        {
            aes.Key = Key;
            aes.Mode = CipherMode.ECB;
            aes.Padding = PaddingMode.None;
            using (ICryptoTransform transform = aes.CreateEncryptor())
                return transform.TransformFinalBlock(data, 0, data.Length);
        }
    }

    private static void WriteUInt32(byte[] data, int offset, uint value)
    {
        data[offset] = (byte)(value & 0xFF);
        data[offset + 1] = (byte)((value >> 8) & 0xFF);
        data[offset + 2] = (byte)((value >> 16) & 0xFF);
        data[offset + 3] = (byte)((value >> 24) & 0xFF);
    }

    private static Dictionary<string, string> ReadConfigHashes(string gameRoot)
    {
        Dictionary<string, string> hashes = new Dictionary<string, string>();
        foreach (string name in new string[] { "qualityconfig", "clientconfig", "pcconfig" })
        {
            string path = Path.Combine(gameRoot, @"Documents\configs", name);
            hashes[name] = HashFile(path);
        }
        return hashes;
    }

    private static string HashFile(string path)
    {
        using (FileStream stream = File.OpenRead(path))
        using (SHA256 sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "");
    }

    private static void AssertConfigHashesEqual(
        Dictionary<string, string> expected,
        Dictionary<string, string> actual)
    {
        foreach (KeyValuePair<string, string> item in expected)
            Assert(actual[item.Key] == item.Value, "Config changed: " + item.Key);
    }

    private static void AssertOutsideSlotEqual(byte[] before, byte[] after)
    {
        Assert(before.Length == after.Length, "NPK size changed.");
        for (int i = 0; i < before.Length; i++)
        {
            if (i >= DataOffset && i < DataOffset + SlotSize) continue;
            if (before[i] != after[i]) throw new Exception("Byte outside target slot changed at " + i + ".");
        }
    }

    private static bool ByteArraysEqual(byte[] left, byte[] right)
    {
        if (left.Length != right.Length) return false;
        for (int i = 0; i < left.Length; i++) if (left[i] != right[i]) return false;
        return true;
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }
}
