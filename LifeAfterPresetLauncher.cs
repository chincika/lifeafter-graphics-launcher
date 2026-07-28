using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

internal static class LifeAfterPresetLauncher
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr hWnd, out NativeRect rect);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(
        IntPtr hwnd,
        int attribute,
        ref int attributeValue,
        int attributeSize);

    [DllImport("dwmapi.dll")]
    private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref DwmMargins margins);

    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DwmMargins
    {
        public int Left;
        public int Right;
        public int Top;
        public int Bottom;
    }

    private sealed class FpsPatchDefinition
    {
        public int Target;
        public string FileName;
        public string SlotSha256;
        public string Label;
    }

    private sealed class FpsNxpkRecord
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

    private sealed class FpsSlotState
    {
        public string Id;
        public string Label;
        public int Target;
        public bool Writable;
    }

    private sealed class FpsCompatibilityProfile
    {
        public string PlatformId;
        public string PlatformLabel;
        public string GameVersion;
        public string NormalizedSha256;
        public string Mode;
        public string ModeLabel;
        public string ProfileId;
        public bool KnownProfile;
    }

    private const int FpsSlotSize = 110791;
    private const int FpsOriginalSize = 328632;
    private const uint FpsTargetNameHash = 4238962030;
    private const uint FpsTargetNameId = 3758457633;
    private const uint FpsChecksum1 = 3881385757;
    private const uint FpsChecksum2 = 3180330809;
    private const uint FpsCompressionType = 2;
    private const string FpsNeteaseOriginalArchiveSha256 =
        "D28A80EE2F0A209BD24ADE0838848B49FE2D9816946C304D15E9A83FEA6D2738";
    private const string FpsFeverOriginalArchiveSha256 =
        "BCACC8B1CFD4C4DB6F2B5633069EFDB39A1C8835A2436EAB338FB1B90BD69CC2";
    private const string FpsOriginalSlotSha256 =
        "6F9165B65B8E32391E32FBC5174B8CC680E90C33C5887B46999D087ACE8FE050";
    private static readonly Regex FpsTransactionBackupNamePattern = new Regex(
        @"^script\.py314\.lc\.npk\.\d{8}-\d{6}-\d{3}\.[A-Za-z0-9_-]+\.[0-9A-F]{16}\.bak$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly byte[] FpsNxpkKey = new byte[]
    {
        96, 99, 8, 216, 163, 44, 120, 32, 19, 210, 108, 47, 34, 111, 104, 109
    };
    private static readonly Dictionary<int, FpsPatchDefinition> FpsPatches =
        new Dictionary<int, FpsPatchDefinition>
    {
        {
            180,
            new FpsPatchDefinition
            {
                Target = 180,
                FileName = "patch_180.bin",
                SlotSha256 = "04E2632BAC975036240B829A89B36D1FC5614D48F880E157C60B77985B5340A1",
                Label = "120 → 180 FPS"
            }
        },
        {
            240,
            new FpsPatchDefinition
            {
                Target = 240,
                FileName = "patch_240.bin",
                SlotSha256 = "A5B7382EE1C8CDBCA3D34ACD3BE8D93D8E0D588AD2EE7B3278D4E9D97342EEE1",
                Label = "120 → 240 FPS"
            }
        },
        {
            300,
            new FpsPatchDefinition
            {
                Target = 300,
                FileName = "patch_300.bin",
                SlotSha256 = "DB33FAF0F83F30D7675720F6BA77F4AE09B6E4E8FA460D8177CAB0ACE6F43DA6",
                Label = "120 → 300 FPS"
            }
        }
    };


    private static string gameRoot;
    private static string configDir;
    private static string pcConfigPath;
    private static string qualityConfigPath;
    private static string gameExe;
    private static string performanceGameExe;

    private static readonly string SavedPathFile = Path.Combine(
        AppDomain.CurrentDomain.BaseDirectory,
        "LifeAfterLauncher.path");
    private const string AppVersion = "v1.8.0";
    private const string ProjectUrl = "https://github.com/chincika/lifeafter-graphics-launcher";

    private const string Pc540p =
@"{""resolution"": [960, 540], ""ignore_hint"": true, ""half_infected_keymap"": {""HANDBRAKE"": [0, 0], ""DRONE_CAST_SKILL"": [88, 0], ""SPORE_SKILL"": [74, 0], ""TOGGLE_WEAPONS"": [90, 0], ""DRONE_CONTROL_SKILL_1"": [0, 0], ""AIR_UP"": [0, 0], ""WHISTLE"": [0, 0], ""WEAPON_SKILL"": [81, 0], ""OPEN_FASHION"": [81, 1], ""ARTIFACT_STUNT"": [72, 0], ""CHANGE_POS"": [0, 0], ""AIR_DOWN"": [0, 0], ""SPORE_USE"": [16, 0], ""FAST_COLD_WEAPON"": [71, 0], ""TOGGLE_MEDICINE"": [66, 0], ""MOVE_RUN"": [87, 1], ""SWITCH_WEAPON"": [69, 0], ""PLAYER_SKILL7"": [-1, 0], ""AUTO_MOVE"": [0, 0], ""NITROGEN"": [0, 0], ""SWITCH_THROWABLE"": [188, 0]}, ""hide_tag"": false, ""pc_tutorial_showed"": true, ""full_screen"": false, ""hint_occurred"": 4, ""hint_close_PanelBulletBox"": true, ""dpi_resize_policy"": 0}";

    private const string Quality540p =
@"{""jijian_engine"": 1, ""render_2020"": 2, ""player_num"": 0.9, ""enemy_limit_num"": 35, ""friend_limit_num"": 20, ""hidden_tatic_sfx"": 0, ""hidden_flamethrower_sfx"": 0, ""hidden_diffuser_sfx"": 0, ""bloom_enhance"": 1, ""render"": 0, ""last_quality_level"": 4, ""light"": 0, ""shadow"": 0, ""plant"": 0, ""frame"": 0, ""frame_prediction"": 0, ""dynamic_shadow"": false, ""preset_mode"": -1, ""shadow_distance_scale"": 0.0, ""transparent_shadow"": false, ""lighting_rendering"": 1, ""quality"": -1, ""contrast_enhancement"": 1, ""color_grading"": 2, ""home_render_budget"": 1, ""scene_sfx_performance"": 2, ""main_player_sfx_performance"": 1, ""other_player_sfx_performance"": 2, ""fsr_postprocess"": 0, ""hidden_specific_shrub"": 0, ""dynamic_hide_bobj"": false, ""same_appear_hint"": 0, ""hide_building"": 0, ""enable_low_fps_mode"": 1, ""plant_distance_scale"": 0.0, ""volumetric_cloud"": 3, ""ambient_occlusion"": 0, ""yingguang_sen"": 1.0, ""illum_auto_switch"": 0, ""blurred_distant_view"": 0, ""surface_reflection"": 0, ""z_far"": 1.0, ""anisotropic_filter"": 2, ""global_illumination"": 1, ""self_home_bobj_show_range"": 100, ""other_home_bobj_show_range"": 30, ""anti_alias_pc"": 1, ""dynamic_pvp_rule"": 1, ""long_shadow"": 0, ""shadow_distance"": 0, ""ocean_depth"": 0, ""monster_quality_upgrade_hit_sfx"": 0, ""player_super_low"": 0}";

    private const string Quality2K120 =
@"{""jijian_engine"": 1, ""render_2020"": 2, ""player_num"": 0.9, ""enemy_limit_num"": 35, ""friend_limit_num"": 35, ""hidden_tatic_sfx"": 0, ""hidden_flamethrower_sfx"": 0, ""hidden_diffuser_sfx"": 0, ""bloom_enhance"": 1, ""render"": 4, ""last_quality_level"": 4, ""light"": 1, ""shadow"": 1, ""plant"": 1, ""frame"": 4, ""frame_prediction"": 1, ""dynamic_shadow"": false, ""preset_mode"": -1, ""shadow_distance_scale"": 0.0, ""transparent_shadow"": true, ""lighting_rendering"": 1, ""quality"": -1, ""contrast_enhancement"": 1, ""color_grading"": 2, ""home_render_budget"": 1, ""scene_sfx_performance"": 0, ""main_player_sfx_performance"": 0, ""other_player_sfx_performance"": 0, ""fsr_postprocess"": 0, ""hidden_specific_shrub"": 0, ""dynamic_hide_bobj"": false, ""same_appear_hint"": 0, ""hide_building"": 0, ""enable_low_fps_mode"": 1, ""plant_distance_scale"": 0.0, ""volumetric_cloud"": 3, ""ambient_occlusion"": 0, ""yingguang_sen"": 1.0, ""illum_auto_switch"": 0, ""blurred_distant_view"": 0, ""surface_reflection"": 0, ""z_far"": 1.0, ""anisotropic_filter"": 2, ""global_illumination"": 1, ""self_home_bobj_show_range"": 100, ""other_home_bobj_show_range"": 30, ""anti_alias_pc"": 1, ""dynamic_pvp_rule"": 1, ""long_shadow"": 0, ""shadow_distance"": 0, ""ocean_depth"": 0, ""monster_quality_upgrade_hit_sfx"": 0, ""player_super_low"": 0}";

    [STAThread]
    private static void Main(string[] args)
    {
        try { Console.OutputEncoding = new UTF8Encoding(false); } catch { }
        SetGameRoot(FindGameRoot());

        if (args.Length >= 2 && args[0].Equals("--apply", StringComparison.OrdinalIgnoreCase))
        {
            bool launch = false;
            bool performanceMode = false;
            for (int i = 2; i < args.Length; i++)
            {
                if (args[i].Equals("--launch", StringComparison.OrdinalIgnoreCase)) launch = true;
                if (args[i].Equals("--performance", StringComparison.OrdinalIgnoreCase)) performanceMode = true;
            }
            Console.WriteLine(ApplyPreset(args[1], launch, performanceMode));
            return;
        }

        if (args.Length >= 1 && args[0].Equals("--clean-backups", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine(CleanAutoBackups());
            return;
        }

        if (args.Length >= 1 && args[0].Equals("--restore-factory", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine(RestoreFactoryDefault());
            return;
        }

        if (args.Length >= 1 && args[0].Equals("--instances-json", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine(CaptureInstancesJson());
            return;
        }

        if (args.Length >= 1 && args[0].Equals("--read-summary", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine(ReadCurrentConfigSummary());
            return;
        }

        if (args.Length >= 1 && args[0].Equals("--get-root", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine(IsValidGameRoot(gameRoot) ? gameRoot : "");
            return;
        }

        if (args.Length >= 2 && args[0].Equals("--set-root", StringComparison.OrdinalIgnoreCase))
        {
            if (!IsValidGameRoot(args[1]))
            {
                throw new InvalidOperationException("\u6240\u9009\u76ee\u5f55\u4e0d\u662f\u6709\u6548\u7684 LifeAfter \u5b89\u88c5\u76ee\u5f55\u3002");
            }
            SetGameRoot(args[1]);
            SaveGameRoot(args[1]);
            Console.WriteLine(args[1]);
            return;
        }

        if (args.Length >= 1 && args[0].Equals("--restore-latest", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine(RestoreLatestBackup());
            return;
        }

        if (args.Length >= 2 && args[0].Equals("--set-tiaozi", StringComparison.OrdinalIgnoreCase))
        {
            decimal scale;
            if (!Decimal.TryParse(args[1], NumberStyles.Float, CultureInfo.InvariantCulture, out scale))
            {
                throw new InvalidOperationException("\u8df3\u5b57\u7f29\u653e\u6bd4\u4f8b\u683c\u5f0f\u4e0d\u6b63\u786e\u3002");
            }
            Console.WriteLine(SetTiaoziScale(scale));
            return;
        }

        if (args.Length >= 1 && args[0].Equals("--fps-status", StringComparison.OrdinalIgnoreCase))
        {
            Console.WriteLine(GetFpsUnlockStatusJson());
            return;
        }

        if (args.Length >= 2 && args[0].Equals("--fps-status-root", StringComparison.OrdinalIgnoreCase))
        {
            if (!IsValidGameRoot(args[1]))
                throw new InvalidOperationException("所选目录不是有效的 LifeAfter 安装目录。");
            SetGameRoot(args[1]);
            Console.WriteLine(GetFpsUnlockStatusJson());
            return;
        }

        if (args.Length >= 2 && args[0].Equals("--fps-apply", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                int target;
                if (!Int32.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out target))
                    throw new InvalidOperationException("帧率目标格式不正确。");
                Console.WriteLine(ApplyFpsUnlock(target));
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.GetType().Name + "：" + ex.Message);
                Environment.ExitCode = 1;
            }
            return;
        }

        if (args.Length >= 1 && args[0].Equals("--fps-restore", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                Console.WriteLine(RestoreFpsUnlock());
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.GetType().Name + "：" + ex.Message);
                Environment.ExitCode = 1;
            }
            return;
        }

        if (args.Length >= 1 && args[0].Equals("--fps-clean-backups", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                Console.WriteLine(CleanFpsTransactionBackups());
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.GetType().Name + "：" + ex.Message);
                Environment.ExitCode = 1;
            }
            return;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new LauncherForm());
    }

    private static void SetGameRoot(string root)
    {
        gameRoot = root;
        if (String.IsNullOrEmpty(root))
        {
            configDir = pcConfigPath = qualityConfigPath = gameExe = performanceGameExe = null;
            return;
        }

        configDir = Path.Combine(root, @"Documents\configs");
        pcConfigPath = Path.Combine(configDir, "pcconfig");
        qualityConfigPath = Path.Combine(configDir, "qualityconfig");
        gameExe = DetectGamePlatformId(root) == "fever"
            ? Path.Combine(root, "mingrizhihou.exe")
            : Path.Combine(root, "lifeafter.exe");
        performanceGameExe = Path.Combine(root, @"Documents\bin\x64-3\lifeafter.exe");
    }

    private static bool IsValidGameRoot(string root)
    {
        if (String.IsNullOrEmpty(root)) return false;
        bool standardExecutable =
            File.Exists(Path.Combine(root, "lifeafter.exe")) ||
            IsFeverGameRoot(root);
        return standardExecutable &&
               File.Exists(Path.Combine(root, @"Documents\configs\pcconfig")) &&
               File.Exists(Path.Combine(root, @"Documents\configs\qualityconfig"));
    }

    private static bool IsFeverGameRoot(string root)
    {
        if (String.IsNullOrEmpty(root) ||
            !File.Exists(Path.Combine(root, "mingrizhihou.exe")))
            return false;
        string folderName = null;
        try { folderName = new DirectoryInfo(root).Name; } catch { }
        return String.Equals(folderName, "mrzh", StringComparison.OrdinalIgnoreCase) ||
               File.Exists(Path.Combine(root, "FeverGamesLauncher.exe")) ||
               !File.Exists(Path.Combine(root, "lifeafter.exe"));
    }

    private static string DetectGamePlatformId(string root)
    {
        if (IsFeverGameRoot(root))
            return "fever";
        return "netease";
    }

    private static string GetGamePlatformLabel(string platformId)
    {
        return platformId == "fever" ? "发烧平台包体" : "老PC包体";
    }

    private static string FindGameRoot()
    {
        string saved = LoadSavedPath();
        if (IsValidGameRoot(saved)) return saved;

        string shortcut = FindFromDesktopShortcuts();
        if (IsValidGameRoot(shortcut)) return shortcut;

        string common = FindFromCommonPaths();
        if (IsValidGameRoot(common)) return common;

        return null;
    }

    private static string LoadSavedPath()
    {
        try
        {
            if (File.Exists(SavedPathFile))
            {
                return File.ReadAllText(SavedPathFile, Encoding.UTF8).Trim();
            }
        }
        catch { }

        return null;
    }

    private static void SaveGameRoot(string root)
    {
        File.WriteAllText(SavedPathFile, root, new UTF8Encoding(false));
    }

    private static string FindFromDesktopShortcuts()
    {
        string userDesktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string publicDesktop = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
        string[] desktops = new string[] { userDesktop, publicDesktop };

        foreach (string desktop in desktops)
        {
            if (String.IsNullOrEmpty(desktop) || !Directory.Exists(desktop)) continue;
            foreach (string lnk in Directory.GetFiles(desktop, "*.lnk"))
            {
                string name = Path.GetFileNameWithoutExtension(lnk);
                if (name.IndexOf("LifeAfter", StringComparison.OrdinalIgnoreCase) < 0 &&
                    name.IndexOf("\u660e\u65e5\u4e4b\u540e", StringComparison.OrdinalIgnoreCase) < 0)
                {
                    continue;
                }

                string target = TryReadShortcutTarget(lnk);
                string root = RootFromExecutable(target);
                if (IsValidGameRoot(root)) return root;
            }
        }

        return null;
    }

    private static string TryReadShortcutTarget(string shortcutPath)
    {
        try
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return null;
            object shell = Activator.CreateInstance(shellType);
            object shortcut = shellType.InvokeMember(
                "CreateShortcut",
                BindingFlags.InvokeMethod,
                null,
                shell,
                new object[] { shortcutPath });
            object target = shortcut.GetType().InvokeMember(
                "TargetPath",
                BindingFlags.GetProperty,
                null,
                shortcut,
                null);
            return target as string;
        }
        catch
        {
            return null;
        }
    }

    private static string RootFromExecutable(string executable)
    {
        if (String.IsNullOrEmpty(executable) || !File.Exists(executable)) return null;
        string dir = Path.GetDirectoryName(executable);
        while (!String.IsNullOrEmpty(dir))
        {
            if (IsValidGameRoot(dir)) return dir;
            DirectoryInfo parent = Directory.GetParent(dir);
            if (parent == null) break;
            dir = parent.FullName;
        }
        return null;
    }

    private static string FindFromCommonPaths()
    {
        foreach (DriveInfo drive in DriveInfo.GetDrives())
        {
            if (!drive.IsReady || drive.DriveType != DriveType.Fixed) continue;
            string root = drive.RootDirectory.FullName;
            string[] candidates = new string[]
            {
                Path.Combine(root, @"Program Files (x86)\LifeAfter"),
                Path.Combine(root, @"Program Files\LifeAfter"),
                Path.Combine(root, "LifeAfter"),
                Path.Combine(root, @"Games\LifeAfter"),
                Path.Combine(root, @"Netease\LifeAfter"),
                Path.Combine(root, @"FeverGames\mrzh")
            };

            foreach (string candidate in candidates)
            {
                if (IsValidGameRoot(candidate)) return candidate;
            }
        }

        return null;
    }

    private static PresetData BuildPreset(string preset)
    {
        switch (preset)
        {
            case "2K 120":
                return new PresetData(ReplaceResolution(Pc540p, 2560, 1440), Quality2K120);
            case "1080p 120":
                return new PresetData(ReplaceResolution(Pc540p, 1920, 1080), Quality2K120);
            case "1080p 60":
                return new PresetData(ReplaceResolution(Pc540p, 1920, 1080), SetRawNumber(Quality2K120, "frame", 2));
            case "900p 120":
                return new PresetData(ReplaceResolution(Pc540p, 1600, 900), Quality2K120);
            case "900p 60":
                return new PresetData(ReplaceResolution(Pc540p, 1600, 900), SetRawNumber(Quality540p, "frame", 2));
            case "720p 60":
                return new PresetData(ReplaceResolution(Pc540p, 1280, 720), SetRawNumber(Quality540p, "frame", 2));
            case "540p 25":
            case "540p":
                return new PresetData(Pc540p, Quality540p);
            case "540p 60":
                return new PresetData(Pc540p, SetRawNumber(Quality540p, "frame", 2));
            default:
                throw new InvalidOperationException("\u672a\u77e5\u9884\u8bbe\uff1a" + preset);
        }
    }

    private static string ApplyPreset(string preset, bool launch)
    {
        return ApplyPreset(preset, launch, false);
    }

    private static string ApplyPreset(string preset, bool launch, bool performanceMode)
    {
        if (!IsValidGameRoot(gameRoot))
        {
            throw new InvalidOperationException("\u8bf7\u5148\u9009\u62e9\u6b63\u786e\u7684\u6e38\u620f\u76ee\u5f55\u3002");
        }

        PresetData data = BuildPreset(preset);
        string pcBackup = BackupConfig(pcConfigPath);
        string qualityBackup = BackupConfig(qualityConfigPath);

        WriteTextNoBom(pcConfigPath, data.Pc);
        WriteTextNoBom(qualityConfigPath, data.Quality);

        string message = "\u5df2\u5e94\u7528\u9884\u8bbe\uff1a" + preset + Environment.NewLine +
                         "\u6e38\u620f\u76ee\u5f55\uff1a" + gameRoot + Environment.NewLine +
                         "\u5f53\u524d\u914d\u7f6e\uff1a" + ReadCurrentConfigSummary() + Environment.NewLine +
                         "\u5907\u4efd\u6587\u4ef6\uff1a" + Environment.NewLine +
                         pcBackup + Environment.NewLine +
                         qualityBackup;

        if (launch)
        {
            string launchExe = GetLaunchExe(performanceMode);
            Process.Start(new ProcessStartInfo
            {
                FileName = launchExe,
                WorkingDirectory = gameRoot,
                UseShellExecute = true
            });
            message += Environment.NewLine + "\u542f\u52a8\u6a21\u5f0f\uff1a" + GetLaunchModeName(performanceMode);
            message += Environment.NewLine + "\u542f\u52a8\u6587\u4ef6\uff1a" + launchExe;
            message += Environment.NewLine + "\u6e38\u620f\u5df2\u542f\u52a8\u3002";
        }

        WriteLog("ApplyPreset preset=" + preset + " launch=" + launch + " performanceMode=" + performanceMode + " root=" + gameRoot + " summary=" + ReadCurrentConfigSummary());
        return message;
    }

    private static string GetLaunchExe(bool performanceMode)
    {
        string launchExe = performanceMode ? performanceGameExe : gameExe;
        if (String.IsNullOrEmpty(launchExe) || !File.Exists(launchExe))
        {
            string modeName = GetLaunchModeName(performanceMode);
            throw new FileNotFoundException("\u627e\u4e0d\u5230" + modeName + "\u542f\u52a8\u6587\u4ef6", launchExe);
        }

        return launchExe;
    }

    private static string GetLaunchModeName(bool performanceMode)
    {
        return performanceMode ? "\u6027\u80fd\u4f18\u5148" : "\u6807\u51c6";
    }

    private static string ApplyAndLaunchSequence(string[] presets, Func<string, string, bool> confirmNext)
    {
        return ApplyAndLaunchSequence(presets, confirmNext, false);
    }

    private static string ApplyAndLaunchSequence(string[] presets, Func<string, string, bool> confirmNext, bool performanceMode)
    {
        if (!IsValidGameRoot(gameRoot))
        {
            throw new InvalidOperationException("\u8bf7\u5148\u9009\u62e9\u6b63\u786e\u7684\u6e38\u620f\u76ee\u5f55\u3002");
        }

        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < presets.Length; i++)
        {
            string preset = presets[i];
            builder.AppendLine("\u542f\u52a8\u7a97\u53e3 " + (i + 1) + "\uff1a" + preset);
            builder.AppendLine(ApplyPreset(preset, true, performanceMode));
            if (i < presets.Length - 1)
            {
                string nextPreset = presets[i + 1];
                builder.AppendLine("\u5df2\u6682\u505c\uff1a\u8bf7\u786e\u8ba4\u7a97\u53e3 " + (i + 1) + "\uff08" + preset + "\uff09\u5df2\u7ecf\u6309\u6b63\u786e\u753b\u8d28\u663e\u793a\uff0c\u518d\u7ee7\u7eed\u542f\u52a8\u4e0b\u4e00\u4e2a\u7a97\u53e3\u3002");
                if (confirmNext != null && !confirmNext(preset, nextPreset))
                {
                    builder.AppendLine("\u7528\u6237\u5df2\u53d6\u6d88\u540e\u7eed\u542f\u52a8\u3002");
                    break;
                }

                builder.AppendLine("\u5df2\u786e\u8ba4\uff0c\u7ee7\u7eed\u5199\u5165\u4e0b\u4e00\u4e2a\u914d\u7f6e\uff1a" + nextPreset);
            }
        }

        WriteLog("MultiLaunch count=" + presets.Length + " performanceMode=" + performanceMode + " manualConfirm=true");
        return builder.ToString();
    }

    private static Size GetPresetResolution(string preset)
    {
        switch (preset)
        {
            case "2K 120":
                return new Size(2560, 1440);
            case "1080p 120":
            case "1080p 60":
                return new Size(1920, 1080);
            case "900p 60":
            case "900p 120":
                return new Size(1600, 900);
            case "720p 60":
                return new Size(1280, 720);
            case "540p 25":
            case "540p 60":
            case "540p":
                return new Size(960, 540);
            default:
                throw new InvalidOperationException("\u672a\u77e5\u9884\u8bbe\uff1a" + preset);
        }
    }

    private static void WriteLog(string message)
    {
        try
        {
            string logFile = GetLogFilePath();
            Directory.CreateDirectory(Path.GetDirectoryName(logFile));
            File.AppendAllText(
                logFile,
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine,
                new UTF8Encoding(false));
        }
        catch { }
    }

    private static string GetLauncherDataDir()
    {
        if (IsValidGameRoot(gameRoot))
        {
            return Path.Combine(configDir, "launcher_data");
        }

        return AppDomain.CurrentDomain.BaseDirectory;
    }

    private static string GetLogFilePath()
    {
        return Path.Combine(GetLauncherDataDir(), "LifeAfterLauncher.log");
    }

    private static string GetPresetDescription(string preset)
    {
        switch (preset)
        {
            case "2K 120":
                return "2560x1440 / frame=4 / \u9ad8\u753b\u8d28\uff0c\u9002\u5408\u4e3b\u7a97\u53e3";
            case "1080p 120":
                return "1920x1080 / frame=4 / \u9ad8\u753b\u8d28\uff0c\u6bd4 2K \u66f4\u7701\u8d44\u6e90";
            case "1080p 60":
                return "1920x1080 / frame=2 / \u9ad8\u753b\u8d28 60 \u6863";
            case "900p 120":
                return "1600x900 / frame=4 / \u9ad8\u753b\u8d28 120 \u6863\uff0c\u4e2d\u5206\u8fa8\u7387\u9ad8\u5e27";
            case "900p 60":
                return "1600x900 / frame=2 / \u4e2d\u95f4\u6863\uff0c\u9002\u5408\u591a\u5f00";
            case "720p 60":
                return "1280x720 / frame=2 / \u8f7b\u91cf\u591a\u5f00";
            case "540p 60":
                return "960x540 / frame=2 / \u4f4e\u5206\u8fa8\u7387 60 \u6863";
            case "540p 25":
                return "960x540 / frame=0 / \u6700\u4f4e\u8d1f\u8f7d\uff0c\u9002\u5408\u6302\u673a";
            default:
                return "";
        }
    }

    private static string GetOptConfigPath()
    {
        if (String.IsNullOrEmpty(configDir)) return null;
        return Path.Combine(configDir, "optconfig");
    }

    private static decimal ReadTiaoziScale()
    {
        string optConfigPath = GetOptConfigPath();
        if (String.IsNullOrEmpty(optConfigPath) || !File.Exists(optConfigPath))
        {
            throw new FileNotFoundException("\u627e\u4e0d\u5230 optconfig \u914d\u7f6e\u6587\u4ef6", optConfigPath);
        }

        string json = File.ReadAllText(optConfigPath, Encoding.UTF8);
        Match match = Regex.Match(json, @"""tiaozi_size""\s*:\s*(-?\d+(?:\.\d+)?)");
        if (!match.Success)
        {
            throw new InvalidOperationException("optconfig \u91cc\u6ca1\u6709 tiaozi_size \u5b57\u6bb5\u3002");
        }

        return Decimal.Parse(match.Groups[1].Value, CultureInfo.InvariantCulture);
    }

    private static string SetTiaoziScale(decimal scale)
    {
        if (!IsValidGameRoot(gameRoot))
        {
            throw new InvalidOperationException("\u8bf7\u5148\u9009\u62e9\u6b63\u786e\u7684\u6e38\u620f\u76ee\u5f55\u3002");
        }

        if (scale < 0.1m || scale > 8.0m)
        {
            throw new ArgumentOutOfRangeException("scale", "\u8df3\u5b57\u7f29\u653e\u6bd4\u4f8b\u5fc5\u987b\u5728 0.1 \u5230 8.0 \u4e4b\u95f4\u3002");
        }

        string optConfigPath = GetOptConfigPath();
        if (String.IsNullOrEmpty(optConfigPath) || !File.Exists(optConfigPath))
        {
            throw new FileNotFoundException("\u627e\u4e0d\u5230 optconfig \u914d\u7f6e\u6587\u4ef6", optConfigPath);
        }

        string backup = BackupConfig(optConfigPath);
        string json = File.ReadAllText(optConfigPath, Encoding.UTF8);
        string value = scale.ToString("0.0", CultureInfo.InvariantCulture);
        string updated;
        Regex fieldRegex = new Regex(@"""tiaozi_size""\s*:\s*-?\d+(?:\.\d+)?");
        if (fieldRegex.IsMatch(json))
        {
            updated = fieldRegex.Replace(json, @"""tiaozi_size"": " + value, 1);
        }
        else
        {
            int insertAt = json.LastIndexOf('}');
            if (insertAt < 0)
            {
                throw new InvalidOperationException("optconfig \u4e0d\u50cf\u6709\u6548 JSON\uff0c\u672a\u627e\u5230\u7ed3\u675f\u82b1\u62ec\u53f7\u3002");
            }

            string before = json.Substring(0, insertAt).TrimEnd();
            string after = json.Substring(insertAt);
            string separator = before.EndsWith("{", StringComparison.Ordinal) ? "" : ",";
            updated = before + separator + Environment.NewLine + @"  ""tiaozi_size"": " + value + Environment.NewLine + after;
        }

        WriteTextNoBom(optConfigPath, updated);
        WriteLog("SetTiaoziScale scale=" + value + " path=" + optConfigPath);
        return "\u5df2\u8bbe\u7f6e\u8df3\u5b57\u7f29\u653e\u6bd4\u4f8b\uff1a" + value + Environment.NewLine +
               "\u914d\u7f6e\u6587\u4ef6\uff1a" + optConfigPath + Environment.NewLine +
               "\u5907\u4efd\u6587\u4ef6\uff1a" + backup + Environment.NewLine +
               "\u8bf7\u91cd\u542f\u6e38\u620f\u751f\u6548\u3002";
    }

    private static bool IsGameRunning()
    {
        foreach (Process process in Process.GetProcesses())
        {
            try
            {
                string name = process.ProcessName;
                if (name.IndexOf("lifeafter", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    name.IndexOf("mingrizhihou", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }
            catch { }
        }

        return false;
    }

    private static int CountGameClientProcesses()
    {
        int count = 0;
        foreach (Process process in Process.GetProcesses())
        {
            try
            {
                string name = process.ProcessName;
                if (name.IndexOf("lifeafter", StringComparison.OrdinalIgnoreCase) < 0 &&
                    name.IndexOf("mingrizhihou", StringComparison.OrdinalIgnoreCase) < 0)
                {
                    continue;
                }

                string path = null;
                try { path = process.MainModule.FileName; } catch { }
                if (String.IsNullOrEmpty(path) ||
                    path.IndexOf(@"\Documents\bin\", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    path.Equals(gameExe, StringComparison.OrdinalIgnoreCase))
                {
                    count++;
                }
            }
            catch { }
        }

        return count;
    }

    private static int CountVisibleGameWindows()
    {
        int count = 0;
        EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;

            uint processId;
            GetWindowThreadProcessId(hWnd, out processId);
            if (processId == 0) return true;

            try
            {
                Process process = Process.GetProcessById((int)processId);
                string name = process.ProcessName;
                if (name.IndexOf("lifeafter", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    name.IndexOf("mingrizhihou", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    count++;
                }
            }
            catch { }

            return true;
        }, IntPtr.Zero);

        return count;
    }

    private static HashSet<IntPtr> GetVisibleGameWindowHandles()
    {
        HashSet<IntPtr> handles = new HashSet<IntPtr>();
        EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
        {
            if (IsVisibleGameWindow(hWnd))
            {
                handles.Add(hWnd);
            }

            return true;
        }, IntPtr.Zero);

        return handles;
    }

    private static bool IsVisibleGameWindow(IntPtr hWnd)
    {
        if (!IsWindowVisible(hWnd)) return false;

        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        if (processId == 0) return false;

        try
        {
            Process process = Process.GetProcessById((int)processId);
            return IsGameProcessName(process.ProcessName);
        }
        catch
        {
            return false;
        }
    }

    private static bool IsGameProcessName(string processName)
    {
        return processName.IndexOf("lifeafter", StringComparison.OrdinalIgnoreCase) >= 0 ||
               processName.IndexOf("mingrizhihou", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static bool TryGetClientSize(IntPtr hWnd, out Size size)
    {
        NativeRect rect;
        if (GetClientRect(hWnd, out rect))
        {
            size = new Size(Math.Max(0, rect.Right - rect.Left), Math.Max(0, rect.Bottom - rect.Top));
            return size.Width > 0 && size.Height > 0;
        }

        size = Size.Empty;
        return false;
    }

    private static bool IsNearSize(Size actual, Size expected)
    {
        int toleranceWidth = Math.Max(24, expected.Width / 100);
        int toleranceHeight = Math.Max(24, expected.Height / 100);
        return Math.Abs(actual.Width - expected.Width) <= toleranceWidth &&
               Math.Abs(actual.Height - expected.Height) <= toleranceHeight;
    }

    private static bool WaitForNewGameWindow(HashSet<IntPtr> existingWindows, Size expectedSize, int timeoutMilliseconds, out Size detectedSize, out bool sizeMatched)
    {
        detectedSize = Size.Empty;
        sizeMatched = false;
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < timeoutMilliseconds)
        {
            bool found = false;
            Size foundSize = Size.Empty;
            bool foundSizeMatched = false;
            EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
            {
                if (existingWindows.Contains(hWnd)) return true;
                if (!IsVisibleGameWindow(hWnd)) return true;

                Size actualSize;
                if (!TryGetClientSize(hWnd, out actualSize))
                {
                    actualSize = Size.Empty;
                }

                found = true;
                foundSize = actualSize;
                foundSizeMatched = !actualSize.IsEmpty && IsNearSize(actualSize, expectedSize);
                return false;
            }, IntPtr.Zero);

            if (found)
            {
                detectedSize = foundSize;
                sizeMatched = foundSizeMatched;
                return true;
            }

            Thread.Sleep(500);
        }

        return false;
    }

    private static bool WaitForNewGameWindow(int previousWindowCount, int timeoutMilliseconds)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < timeoutMilliseconds)
        {
            if (CountVisibleGameWindows() > previousWindowCount)
            {
                Thread.Sleep(1000);
                return true;
            }
            Thread.Sleep(500);
        }

        return false;
    }

    private static string ReadCurrentConfigSummary()
    {
        if (!IsValidGameRoot(gameRoot)) return "\u672a\u627e\u5230\u6e38\u620f\u76ee\u5f55";
        try
        {
            string pc = File.ReadAllText(pcConfigPath, Encoding.UTF8);
            string quality = File.ReadAllText(qualityConfigPath, Encoding.UTF8);
            Match res = Regex.Match(pc, @"""resolution""\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]");
            string resolution = res.Success ? res.Groups[1].Value + "x" + res.Groups[2].Value : "\u672a\u77e5\u5206\u8fa8\u7387";
            string presetName = DetectCurrentPreset(resolution, quality);
            return presetName +
                   " / " + resolution +
                   " / frame=" + ReadJsonNumber(quality, "frame") +
                   " / render=" + ReadJsonNumber(quality, "render") +
                   " / light=" + ReadJsonNumber(quality, "light") +
                   " / shadow=" + ReadJsonNumber(quality, "shadow") +
                   " / plant=" + ReadJsonNumber(quality, "plant");
        }
        catch (Exception ex)
        {
            return "\u8bfb\u53d6\u5931\u8d25\uff1a" + ex.Message;
        }
    }

    private static string DetectCurrentPreset(string resolution, string quality)
    {
        string frame = ReadJsonNumber(quality, "frame");
        string render = ReadJsonNumber(quality, "render");
        string light = ReadJsonNumber(quality, "light");
        string shadow = ReadJsonNumber(quality, "shadow");
        string plant = ReadJsonNumber(quality, "plant");

        if (resolution == "2560x1440" && frame == "4" && render == "4") return "\u5f53\u524d\u6863\u4f4d\uff1a2K 120";
        if (resolution == "1920x1080" && frame == "4" && render == "4") return "\u5f53\u524d\u6863\u4f4d\uff1a1080p 120";
        if (resolution == "1920x1080" && frame == "2" && render == "4") return "\u5f53\u524d\u6863\u4f4d\uff1a1080p 60";
        if (resolution == "1600x900" && frame == "4" && render == "4") return "\u5f53\u524d\u6863\u4f4d\uff1a900p 120";
        if (resolution == "1600x900" && frame == "2" && render == "0") return "\u5f53\u524d\u6863\u4f4d\uff1a900p 60";
        if (resolution == "1280x720" && frame == "2" && render == "0") return "\u5f53\u524d\u6863\u4f4d\uff1a720p 60";
        if (resolution == "960x540" && frame == "2" && render == "0") return "\u5f53\u524d\u6863\u4f4d\uff1a540p 60";
        if (resolution == "960x540" && frame == "0" && render == "0") return "\u5f53\u524d\u6863\u4f4d\uff1a540p 25";

        if (light == "?" || shadow == "?" || plant == "?") return "\u5f53\u524d\u6863\u4f4d\uff1a\u672a\u77e5";
        return "\u5f53\u524d\u6863\u4f4d\uff1a\u81ea\u5b9a\u4e49";
    }

    private static string ReadJsonNumber(string json, string key)
    {
        Match match = Regex.Match(json, @"""" + Regex.Escape(key) + @"""\s*:\s*(-?\d+(\.\d+)?)");
        return match.Success ? match.Groups[1].Value : "?";
    }

    private static string RestoreLatestBackup()
    {
        if (!IsValidGameRoot(gameRoot))
        {
            throw new InvalidOperationException("\u8bf7\u5148\u9009\u62e9\u6b63\u786e\u7684\u6e38\u620f\u76ee\u5f55\u3002");
        }

        string backupDir = Path.Combine(configDir, "profile_backups");
        if (!Directory.Exists(backupDir))
        {
            throw new InvalidOperationException("\u6ca1\u6709\u627e\u5230\u5907\u4efd\u76ee\u5f55\u3002");
        }

        FileInfo pcBackup = FindLatestBackup(backupDir, "pcconfig.*.bak");
        FileInfo qualityBackup = FindLatestBackup(backupDir, "qualityconfig.*.bak");
        if (pcBackup == null || qualityBackup == null)
        {
            throw new InvalidOperationException("\u6ca1\u6709\u627e\u5230\u53ef\u6062\u590d\u7684\u5907\u4efd\u6587\u4ef6\u3002");
        }

        File.Copy(pcBackup.FullName, pcConfigPath, true);
        File.Copy(qualityBackup.FullName, qualityConfigPath, true);
        return "\u5df2\u6062\u590d\u6700\u8fd1\u5907\u4efd\uff1a" + Environment.NewLine +
               pcBackup.FullName + Environment.NewLine +
               qualityBackup.FullName + Environment.NewLine +
               "\u5f53\u524d\u914d\u7f6e\uff1a" + ReadCurrentConfigSummary();
    }

    private static string RestoreFactoryDefault()
    {
        if (!IsValidGameRoot(gameRoot))
        {
            throw new InvalidOperationException("\u8bf7\u5148\u9009\u62e9\u6b63\u786e\u7684\u6e38\u620f\u76ee\u5f55\u3002");
        }

        PresetData data = BuildPreset("2K 120");
        BackupConfig(pcConfigPath);
        BackupConfig(qualityConfigPath);
        WriteTextNoBom(pcConfigPath, data.Pc);
        WriteTextNoBom(qualityConfigPath, data.Quality);
        EnsureFactoryDefaultBackup();
        return "\u5df2\u6062\u590d\u9ed8\u8ba4\u914d\u7f6e\uff1a2K 120" + Environment.NewLine +
               "\u5f53\u524d\u914d\u7f6e\uff1a" + ReadCurrentConfigSummary();
    }

    private static string EnsureFactoryDefaultBackup()
    {
        if (!IsValidGameRoot(gameRoot))
        {
            throw new InvalidOperationException("\u8bf7\u5148\u9009\u62e9\u6b63\u786e\u7684\u6e38\u620f\u76ee\u5f55\u3002");
        }

        string backupDir = Path.Combine(configDir, "profile_backups");
        Directory.CreateDirectory(backupDir);
        PresetData data = BuildPreset("2K 120");
        string pcFactory = Path.Combine(backupDir, "factory_2k120_pcconfig.bak");
        string qualityFactory = Path.Combine(backupDir, "factory_2k120_qualityconfig.bak");
        WriteTextNoBom(pcFactory, data.Pc);
        WriteTextNoBom(qualityFactory, data.Quality);
        return "\u9ed8\u8ba4\u6062\u590d\u70b9\u5df2\u4fdd\u5b58\uff1a2K 120" + Environment.NewLine +
               pcFactory + Environment.NewLine +
               qualityFactory;
    }

    private static string CleanAutoBackups()
    {
        if (!IsValidGameRoot(gameRoot))
        {
            throw new InvalidOperationException("\u8bf7\u5148\u9009\u62e9\u6b63\u786e\u7684\u6e38\u620f\u76ee\u5f55\u3002");
        }

        string backupDir = Path.Combine(configDir, "profile_backups");
        if (!Directory.Exists(backupDir))
        {
            EnsureFactoryDefaultBackup();
            return "\u6ca1\u6709\u666e\u901a\u5907\u4efd\u9700\u8981\u6e05\u7406\u3002";
        }

        EnsureFactoryDefaultBackup();
        int deleted = 0;
        foreach (string file in Directory.GetFiles(backupDir, "*.bak"))
        {
            string name = Path.GetFileName(file);
            if (name.StartsWith("factory_2k120_", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            try
            {
                File.Delete(file);
                deleted++;
            }
            catch { }
        }

        return "\u5df2\u6e05\u7406\u666e\u901a\u5907\u4efd\uff1a" + deleted + "\u4e2a\u3002" + Environment.NewLine +
               "\u5df2\u4fdd\u7559\u9ed8\u8ba4\u6062\u590d\u70b9\uff1a2K 120\u3002";
    }

    private static void CleanAutoBackupsQuietly()
    {
        try
        {
            CleanAutoBackups();
            WriteLog("AutoCleanBackups root=" + gameRoot);
        }
        catch (Exception ex)
        {
            WriteLog("AutoCleanBackupsFailed " + ex.Message);
        }
    }

    private static FileInfo FindLatestBackup(string backupDir, string pattern)
    {
        FileInfo latest = null;
        foreach (string file in Directory.GetFiles(backupDir, pattern))
        {
            FileInfo info = new FileInfo(file);
            if (latest == null || info.LastWriteTime > latest.LastWriteTime)
            {
                latest = info;
            }
        }
        return latest;
    }

    private static void CreateDesktopShortcut()
    {
        string exePath = Application.ExecutablePath;
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string shortcutPath = Path.Combine(desktop, "\u660e\u65e5\u4e4b\u540e\u753b\u8d28\u542f\u52a8\u5668.lnk");

        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) throw new InvalidOperationException("\u65e0\u6cd5\u521b\u5efa\u5feb\u6377\u65b9\u5f0f\u3002");
        object shell = Activator.CreateInstance(shellType);
        object shortcut = shellType.InvokeMember(
            "CreateShortcut",
            BindingFlags.InvokeMethod,
            null,
            shell,
            new object[] { shortcutPath });
        Type shortcutType = shortcut.GetType();
        shortcutType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { exePath });
        shortcutType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { Path.GetDirectoryName(exePath) });
        shortcutType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { exePath + ",0" });
        shortcutType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
    }

    private static void OpenFolder(string path)
    {
        if (String.IsNullOrEmpty(path) || !Directory.Exists(path))
        {
            throw new DirectoryNotFoundException(path);
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = path,
            UseShellExecute = true
        });
    }

    private static void OpenLogFile()
    {
        string logFile = GetLogFilePath();
        Directory.CreateDirectory(Path.GetDirectoryName(logFile));
        if (!File.Exists(logFile))
        {
            File.WriteAllText(logFile, "", new UTF8Encoding(false));
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = logFile,
            UseShellExecute = true
        });
    }

    private static string BackupConfig(string path)
    {
        if (!File.Exists(path))
        {
            throw new FileNotFoundException("\u627e\u4e0d\u5230\u914d\u7f6e\u6587\u4ef6", path);
        }

        string backupDir = Path.Combine(configDir, "profile_backups");
        Directory.CreateDirectory(backupDir);
        string backupPath = Path.Combine(
            backupDir,
            Path.GetFileName(path) + "." + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".bak");
        File.Copy(path, backupPath, true);
        return backupPath;
    }

    private static void WriteTextNoBom(string path, string text)
    {
        File.WriteAllText(path, text.Trim(), new UTF8Encoding(false));
    }

    private static string ReplaceResolution(string json, int width, int height)
    {
        return new Regex(@"""resolution""\s*:\s*\[\s*\d+\s*,\s*\d+\s*\]").Replace(
            json,
            @"""resolution"": [" + width + ", " + height + "]",
            1);
    }

    private static string SetRawNumber(string json, string key, int value)
    {
        return new Regex(@"""" + Regex.Escape(key) + @"""\s*:\s*-?\d+(\.\d+)?").Replace(
            json,
            @"""" + key + @""": " + value,
            1);
    }

    private sealed class PresetData
    {
        public PresetData(string pc, string quality)
        {
            Pc = pc;
            Quality = quality;
        }

        public string Pc { get; private set; }
        public string Quality { get; private set; }
    }

    // UI-independent data contract. A future LAN monitor can serialize these snapshots
    // without coupling the network layer to WinForms controls.
    private sealed class InstanceSnapshot
    {
        public int ProcessId;
        public string DisplayName;
        public string WindowTitle;
        public Size ClientSize;
        public double CpuPercent;
        public double TotalProcessorMilliseconds;
        public long WorkingSetBytes;
        public TimeSpan RunningTime;
    }

    private sealed class ProcessCpuSample
    {
        public TimeSpan TotalProcessorTime;
        public DateTime TimestampUtc;
    }

    private sealed class GameInstanceMonitor
    {
        private readonly Dictionary<int, ProcessCpuSample> cpuSamples =
            new Dictionary<int, ProcessCpuSample>();

        public List<InstanceSnapshot> Capture()
        {
            DateTime nowUtc = DateTime.UtcNow;
            Dictionary<int, IntPtr> windows = FindVisibleGameWindowsByProcess();
            List<InstanceSnapshot> result = new List<InstanceSnapshot>();
            HashSet<int> activeProcessIds = new HashSet<int>();

            foreach (Process process in Process.GetProcesses())
            {
                try
                {
                    if (!IsGameProcessName(process.ProcessName)) continue;

                    string executable = null;
                    try { executable = process.MainModule.FileName; } catch { }
                    if (!String.IsNullOrEmpty(executable) &&
                        executable.IndexOf(@"\Documents\bin\", StringComparison.OrdinalIgnoreCase) < 0 &&
                        !String.IsNullOrEmpty(gameExe) &&
                        !executable.Equals(gameExe, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    IntPtr window;
                    windows.TryGetValue(process.Id, out window);
                    if (window == IntPtr.Zero && process.MainWindowHandle != IntPtr.Zero)
                    {
                        window = process.MainWindowHandle;
                    }

                    Size clientSize = Size.Empty;
                    if (window != IntPtr.Zero) TryGetClientSize(window, out clientSize);
                    string title = ReadWindowTitle(window);
                    if (String.IsNullOrWhiteSpace(title)) title = process.MainWindowTitle;

                    double cpu = CalculateCpuPercent(process, nowUtc);
                    DateTime startTime = DateTime.Now;
                    try { startTime = process.StartTime; } catch { }

                    result.Add(new InstanceSnapshot
                    {
                        ProcessId = process.Id,
                        DisplayName = ExtractGameId(title),
                        WindowTitle = title,
                        ClientSize = clientSize,
                        CpuPercent = cpu,
                        TotalProcessorMilliseconds = process.TotalProcessorTime.TotalMilliseconds,
                        WorkingSetBytes = process.WorkingSet64,
                        RunningTime = DateTime.Now - startTime
                    });
                    activeProcessIds.Add(process.Id);
                }
                catch
                {
                }
                finally
                {
                    process.Dispose();
                }
            }

            List<int> staleIds = new List<int>();
            foreach (int processId in cpuSamples.Keys)
            {
                if (!activeProcessIds.Contains(processId)) staleIds.Add(processId);
            }
            foreach (int processId in staleIds) cpuSamples.Remove(processId);

            result.Sort(delegate (InstanceSnapshot left, InstanceSnapshot right)
            {
                int leftArea = left.ClientSize.Width * left.ClientSize.Height;
                int rightArea = right.ClientSize.Width * right.ClientSize.Height;
                int byArea = rightArea.CompareTo(leftArea);
                return byArea != 0 ? byArea : left.ProcessId.CompareTo(right.ProcessId);
            });

            for (int index = 0; index < result.Count; index++)
            {
                if (String.IsNullOrWhiteSpace(result[index].DisplayName))
                {
                    result[index].DisplayName = index == 0 ? "\u4e3b\u53f7" : "\u5c0f\u53f7 " + index;
                }
            }

            if (result.Count > 4) result.RemoveRange(4, result.Count - 4);
            return result;
        }

        private double CalculateCpuPercent(Process process, DateTime nowUtc)
        {
            TimeSpan total = process.TotalProcessorTime;
            ProcessCpuSample previous;
            double percent = 0;
            if (cpuSamples.TryGetValue(process.Id, out previous))
            {
                double elapsedMs = (nowUtc - previous.TimestampUtc).TotalMilliseconds;
                double cpuMs = (total - previous.TotalProcessorTime).TotalMilliseconds;
                if (elapsedMs > 0)
                {
                    percent = cpuMs / elapsedMs / Environment.ProcessorCount * 100.0;
                    percent = Math.Max(0, Math.Min(100, percent));
                }
            }

            cpuSamples[process.Id] = new ProcessCpuSample
            {
                TotalProcessorTime = total,
                TimestampUtc = nowUtc
            };
            return percent;
        }

        private static Dictionary<int, IntPtr> FindVisibleGameWindowsByProcess()
        {
            Dictionary<int, IntPtr> windows = new Dictionary<int, IntPtr>();
            EnumWindows(delegate (IntPtr hWnd, IntPtr lParam)
            {
                if (!IsVisibleGameWindow(hWnd)) return true;
                uint processId;
                GetWindowThreadProcessId(hWnd, out processId);
                if (processId > 0 && !windows.ContainsKey((int)processId))
                {
                    windows[(int)processId] = hWnd;
                }
                return true;
            }, IntPtr.Zero);
            return windows;
        }

        private static string ReadWindowTitle(IntPtr window)
        {
            if (window == IntPtr.Zero) return "";
            int length = GetWindowTextLength(window);
            if (length <= 0) return "";
            StringBuilder builder = new StringBuilder(length + 1);
            GetWindowText(window, builder, builder.Capacity);
            return builder.ToString().Trim();
        }

        private static string ExtractGameId(string windowTitle)
        {
            if (String.IsNullOrWhiteSpace(windowTitle)) return null;

            Match id = Regex.Match(
                windowTitle,
                @"(?:\u6e38\u620f\s*ID|\u89d2\u8272\s*ID|UID|ID)\s*[:\uff1a#-]?\s*([A-Za-z0-9_\-\u4e00-\u9fff]{2,32})",
                RegexOptions.IgnoreCase);
            if (id.Success) return id.Groups[1].Value;

            // Current LifeAfter window titles follow:
            // "<game id> -  - <server> - 明日之后".
            // Only the first segment identifies the account. Including the
            // server made the history name unstable and obscured account swaps.
            Match leadingSegment = Regex.Match(windowTitle, @"^\s*(.+?)\s+-\s+");
            if (leadingSegment.Success)
            {
                string candidate = leadingSegment.Groups[1].Value.Trim();
                if (candidate.Length >= 2 && candidate.Length <= 32)
                {
                    return candidate;
                }
            }

            string cleaned = Regex.Replace(
                windowTitle,
                @"(?i)LifeAfter|\u660e\u65e5\u4e4b\u540e|[\[\]\(\)\-_|:：]+",
                " ").Trim();
            cleaned = Regex.Replace(cleaned, @"\s{2,}", " ");
            if (cleaned.Length >= 2 && cleaned.Length <= 32) return cleaned;
            return null;
        }
    }

    private static string FpsPackagePath()
    {
        return String.IsNullOrEmpty(gameRoot)
            ? null
            : Path.Combine(gameRoot, @"Documents\script.py314.lc.npk");
    }

    private static string FpsBackupDirectory()
    {
        return String.IsNullOrEmpty(gameRoot)
            ? null
            : Path.Combine(gameRoot, @"Documents\fps_unlock_backups");
    }

    private static string FpsRootPackagePath()
    {
        return String.IsNullOrEmpty(gameRoot)
            ? null
            : Path.Combine(gameRoot, "script.py314.lc.npk");
    }

    private static string ReadGameVersion()
    {
        try
        {
            string path = Path.Combine(gameRoot, @"Documents\configs\release_version_config");
            if (!File.Exists(path)) return "";
            string version = File.ReadAllText(path, Encoding.UTF8).Trim();
            return version.Length <= 64 ? version : version.Substring(0, 64);
        }
        catch
        {
            return "";
        }
    }

    private static FpsCompatibilityProfile BuildFpsCompatibilityProfile(string normalizedHash)
    {
        string platformId = DetectGamePlatformId(gameRoot);
        bool knownProfile =
            (platformId == "fever" && normalizedHash.Equals(
                FpsFeverOriginalArchiveSha256, StringComparison.OrdinalIgnoreCase)) ||
            (platformId == "netease" && normalizedHash.Equals(
                FpsNeteaseOriginalArchiveSha256, StringComparison.OrdinalIgnoreCase));
        string normalized = normalizedHash.ToUpperInvariant();
        return new FpsCompatibilityProfile
        {
            PlatformId = platformId,
            PlatformLabel = GetGamePlatformLabel(platformId),
            GameVersion = ReadGameVersion(),
            NormalizedSha256 = normalized,
            Mode = knownProfile ? "known-profile" : "auto-compatible",
            ModeLabel = knownProfile ? "已验证档案" : "结构一致 · 自动兼容",
            ProfileId = platformId + "-" + normalized.Substring(0, 16),
            KnownProfile = knownProfile
        };
    }

    private static string FpsProtectedBackupRoot()
    {
        string configured = Environment.GetEnvironmentVariable(
            "LIFEAFTER_PROTECTED_BACKUP_ROOT");
        if (!String.IsNullOrWhiteSpace(configured))
            return Path.GetFullPath(configured.Trim());
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "LifeAfterGraphicsLauncher",
            "protected-backups");
    }

    private static string FpsInstallId()
    {
        string normalizedRoot = Path.GetFullPath(gameRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .ToUpperInvariant();
        return FpsSha256(Encoding.UTF8.GetBytes(normalizedRoot)).Substring(0, 16);
    }

    private static string FpsProtectedBackupDirectory(FpsCompatibilityProfile profile)
    {
        return Path.Combine(
            FpsProtectedBackupRoot(),
            FpsInstallId(),
            profile.ProfileId);
    }

    private static string FpsOfficialBaselinePath(FpsCompatibilityProfile profile)
    {
        return Path.Combine(
            FpsProtectedBackupDirectory(profile),
            "script.py314.lc.npk.official-original-" +
            profile.NormalizedSha256.Substring(0, 16) + ".bak");
    }

    private static string FpsPatchDirectory()
    {
        return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "fps-patches");
    }

    private static FpsSlotState IdentifyFpsSlotState(string slotHash)
    {
        if (slotHash.Equals(FpsOriginalSlotSha256, StringComparison.OrdinalIgnoreCase))
            return new FpsSlotState { Id = "original", Label = "官方原始 120 FPS", Target = 120, Writable = true };

        foreach (KeyValuePair<int, FpsPatchDefinition> item in FpsPatches)
        {
            if (slotHash.Equals(item.Value.SlotSha256, StringComparison.OrdinalIgnoreCase))
            {
                return new FpsSlotState
                {
                    Id = "conditional-" + item.Key.ToString(CultureInfo.InvariantCulture),
                    Label = item.Value.Label,
                    Target = item.Key,
                    Writable = true
                };
            }
        }

        // Recognize the earlier reviewed fixed-value patches so the launcher
        // can safely migrate the user's current test state to the conditional patch.
        if (slotHash.Equals(
            "4D0997446DBD08E7AF24C536AFA7D5055E29E8EBEEA07300B36CB95B9849B469",
            StringComparison.OrdinalIgnoreCase))
            return new FpsSlotState { Id = "legacy-180", Label = "旧版全局强制 180 FPS", Target = 180, Writable = true };
        if (slotHash.Equals(
            "15AAC9544494399DDDEF72E8278D00DF492D5D45EE29A1D5FE610AA1896943C4",
            StringComparison.OrdinalIgnoreCase))
            return new FpsSlotState { Id = "legacy-240", Label = "旧版全局强制 240 FPS", Target = 240, Writable = true };

        return new FpsSlotState { Id = "unknown", Label = "未知或其他补丁", Target = 0, Writable = false };
    }

    private static string GetFpsUnlockStatusJson()
    {
        try
        {
            string packagePath = FpsPackagePath();
            string backupDir = FpsBackupDirectory();
            if (!IsValidGameRoot(gameRoot))
                return "{\"ok\":false,\"error\":\"请先选择有效的游戏目录。\"}";
            if (!File.Exists(packagePath))
                return "{\"ok\":false,\"error\":\"未找到 Documents\\\\script.py314.lc.npk。\"}";

            byte[] originalPatch = LoadFpsPatch("patch_original.bin", FpsOriginalSlotSha256);
            FpsNxpkRecord record;
            byte[] currentSlot;
            string normalizedHash;
            string packageHash;
            using (FileStream stream = new FileStream(
                packagePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                record = ParseFpsNxpk(stream);
                currentSlot = FpsReadAt(stream, record.DataOffset, record.CompressedSize);
                ComputeFpsArchiveHashes(
                    stream,
                    record,
                    currentSlot,
                    originalPatch,
                    out packageHash,
                    out normalizedHash);
            }
            FpsSlotState state = IdentifyFpsSlotState(FpsSha256(currentSlot));
            FpsCompatibilityProfile profile = BuildFpsCompatibilityProfile(normalizedHash);
            bool compatible = state.Writable;
            int transactionBackupCount = GetFpsTransactionBackups().Length;
            string baseline = FpsOfficialBaselinePath(profile);
            bool baselineReady = File.Exists(baseline) &&
                new FileInfo(baseline).Length == new FileInfo(packagePath).Length &&
                FpsSha256File(baseline).Equals(
                    profile.NormalizedSha256, StringComparison.OrdinalIgnoreCase);
            int backupCount = transactionBackupCount + (File.Exists(baseline) ? 1 : 0);
            bool gameRunning = IsFpsGameRunning();
            string rootPackagePath = FpsRootPackagePath();
            bool rootPackagePresent = File.Exists(rootPackagePath);
            long rootPackageSize = rootPackagePresent
                ? new FileInfo(rootPackagePath).Length
                : 0;

            StringBuilder json = new StringBuilder();
            json.Append("{\"ok\":true")
                .Append(",\"compatible\":").Append(compatible ? "true" : "false")
                .Append(",\"writable\":").Append(
                    compatible && state.Writable && !gameRunning ? "true" : "false")
                .Append(",\"gameRunning\":").Append(gameRunning ? "true" : "false")
                .Append(",\"state\":\"").Append(JsonEscape(state.Id)).Append('"')
                .Append(",\"stateLabel\":\"").Append(JsonEscape(state.Label)).Append('"')
                .Append(",\"target\":").Append(state.Target)
                .Append(",\"platformId\":\"").Append(JsonEscape(profile.PlatformId)).Append('"')
                .Append(",\"platformLabel\":\"").Append(JsonEscape(profile.PlatformLabel)).Append('"')
                .Append(",\"gameVersion\":\"").Append(JsonEscape(profile.GameVersion)).Append('"')
                .Append(",\"compatibilityMode\":\"").Append(JsonEscape(profile.Mode)).Append('"')
                .Append(",\"compatibilityLabel\":\"").Append(JsonEscape(profile.ModeLabel)).Append('"')
                .Append(",\"profileId\":\"").Append(JsonEscape(profile.ProfileId)).Append('"')
                .Append(",\"knownProfile\":").Append(profile.KnownProfile ? "true" : "false")
                .Append(",\"packagePath\":\"").Append(JsonEscape(packagePath)).Append('"')
                .Append(",\"packageRole\":\"write-target\"")
                .Append(",\"packageHash\":\"").Append(packageHash).Append('"')
                .Append(",\"normalizedHash\":\"").Append(normalizedHash).Append('"')
                .Append(",\"slotHash\":\"").Append(FpsSha256(currentSlot)).Append('"')
                .Append(",\"rootPackagePath\":\"").Append(JsonEscape(rootPackagePath)).Append('"')
                .Append(",\"rootPackagePresent\":").Append(rootPackagePresent ? "true" : "false")
                .Append(",\"rootPackageReadOnly\":true")
                .Append(",\"rootPackageSize\":").Append(rootPackageSize)
                .Append(",\"backupDir\":\"").Append(JsonEscape(backupDir)).Append('"')
                .Append(",\"protectedBackupDir\":\"")
                    .Append(JsonEscape(FpsProtectedBackupDirectory(profile))).Append('"')
                .Append(",\"baselinePath\":\"").Append(JsonEscape(baseline)).Append('"')
                .Append(",\"backupCount\":").Append(backupCount)
                .Append(",\"transactionBackupCount\":").Append(transactionBackupCount)
                .Append(",\"baselineReady\":").Append(baselineReady ? "true" : "false")
                .Append(",\"packageSize\":").Append(new FileInfo(packagePath).Length)
                .Append('}');
            return json.ToString();
        }
        catch (Exception ex)
        {
            return "{\"ok\":false,\"error\":\"" + JsonEscape(ex.Message) + "\"}";
        }
    }

    private static string ApplyFpsUnlock(int target)
    {
        FpsPatchDefinition definition;
        if (!FpsPatches.TryGetValue(target, out definition))
            throw new InvalidOperationException("仅支持 180、240、300 FPS。");
        EnsureFpsGameStopped();

        string packagePath = FpsPackagePath();
        if (!IsValidGameRoot(gameRoot) || !File.Exists(packagePath))
            throw new InvalidOperationException("未找到兼容的游戏 NPK 包。");

        byte[] originalPatch = LoadFpsPatch("patch_original.bin", FpsOriginalSlotSha256);
        byte[] targetPatch = LoadFpsPatch(definition.FileName, definition.SlotSha256);
        string backupPath = null;
        using (FileStream stream = new FileStream(
            packagePath, FileMode.Open, FileAccess.ReadWrite, FileShare.Read))
        {
            FpsNxpkRecord record = ParseFpsNxpk(stream);
            byte[] current = FpsReadAt(stream, record.DataOffset, record.CompressedSize);
            string currentHash = FpsSha256(current);
            FpsSlotState state = IdentifyFpsSlotState(currentHash);
            if (!state.Writable)
                throw new InvalidDataException("目标槽位不是已知原版或已审查补丁，拒绝覆盖。");
            string normalizedHash = ComputeFpsNormalizedArchiveHash(stream, record, originalPatch);
            FpsCompatibilityProfile profile = BuildFpsCompatibilityProfile(normalizedHash);
            string baseline = FpsOfficialBaselinePath(profile);
            bool writeNeeded = !currentHash.Equals(
                definition.SlotSha256, StringComparison.OrdinalIgnoreCase);
            EnsureFpsBackupCapacity(
                packagePath, baseline, !File.Exists(baseline), writeNeeded);
            EnsureFpsOfficialBaseline(packagePath, stream, record, originalPatch, profile);
            if (!writeNeeded)
                return "当前已经是 " + definition.Label +
                    "；当前平台版本的永久还原点已校验，无需重复写入。";
            backupPath = CreateFpsTransactionBackup(state.Id, stream);

            try
            {
                FpsWriteAt(stream, record.DataOffset, targetPatch);
                byte[] written = FpsReadAt(stream, record.DataOffset, record.CompressedSize);
                if (!FpsSha256(written).Equals(
                    definition.SlotSha256, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("写入后槽位哈希校验失败。");
                string verifiedNormalized = ComputeFpsNormalizedArchiveHash(
                    stream, record, originalPatch);
                if (!verifiedNormalized.Equals(
                    profile.NormalizedSha256, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("写入后包体一致性校验失败。");
            }
            catch
            {
                FpsWriteAt(stream, record.DataOffset, current);
                if (!FpsSha256(FpsReadAt(stream, record.DataOffset, record.CompressedSize))
                    .Equals(currentHash, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("写入失败且自动回滚校验失败，请使用完整 NPK 备份恢复。");
                throw;
            }
        }

        string cleanupNotice = AutoPruneFpsTransactionBackups();
        WriteLog("FpsUnlock target=" + target.ToString(CultureInfo.InvariantCulture) +
                 " platform=" + DetectGamePlatformId(gameRoot) +
                 " backup=" + backupPath + " " + cleanupNotice);
        return "已启用 " + definition.Label + "。游戏内“120 FPS”标签将实际对应 " +
               target.ToString(CultureInfo.InvariantCulture) + " FPS；其他帧率档保持原样。" +
               Environment.NewLine + "写入前完整备份：" + backupPath +
               Environment.NewLine + cleanupNotice;
    }

    private static string RestoreFpsUnlock()
    {
        EnsureFpsGameStopped();
        string packagePath = FpsPackagePath();
        if (!IsValidGameRoot(gameRoot) || !File.Exists(packagePath))
            throw new InvalidOperationException("未找到兼容的游戏 NPK 包。");

        byte[] originalPatch = LoadFpsPatch("patch_original.bin", FpsOriginalSlotSha256);
        string backupPath;
        using (FileStream stream = new FileStream(
            packagePath, FileMode.Open, FileAccess.ReadWrite, FileShare.Read))
        {
            FpsNxpkRecord record = ParseFpsNxpk(stream);
            byte[] current = FpsReadAt(stream, record.DataOffset, record.CompressedSize);
            string currentHash = FpsSha256(current);
            FpsSlotState state = IdentifyFpsSlotState(currentHash);
            if (!state.Writable)
                throw new InvalidDataException("目标槽位不是已知状态，拒绝覆盖。");
            string normalizedHash = ComputeFpsNormalizedArchiveHash(stream, record, originalPatch);
            FpsCompatibilityProfile profile = BuildFpsCompatibilityProfile(normalizedHash);
            string baseline = FpsOfficialBaselinePath(profile);
            bool writeNeeded = !currentHash.Equals(
                FpsOriginalSlotSha256, StringComparison.OrdinalIgnoreCase);
            EnsureFpsBackupCapacity(
                packagePath, baseline, !File.Exists(baseline), writeNeeded);
            EnsureFpsOfficialBaseline(packagePath, stream, record, originalPatch, profile);
            if (!writeNeeded)
                return "当前已经是官方原始 120 FPS 状态；当前平台版本的永久还原点已校验。";
            backupPath = CreateFpsTransactionBackup(state.Id, stream);
            try
            {
                FpsWriteAt(stream, record.DataOffset, originalPatch);
                if (!FpsSha256(FpsReadAt(stream, record.DataOffset, record.CompressedSize))
                    .Equals(FpsOriginalSlotSha256, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("恢复后槽位哈希校验失败。");
                string fullHash = FpsSha256File(stream);
                if (!fullHash.Equals(
                    profile.NormalizedSha256, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("恢复后的完整包体哈希不是官方原始值。");
            }
            catch
            {
                FpsWriteAt(stream, record.DataOffset, current);
                if (!FpsSha256(FpsReadAt(stream, record.DataOffset, record.CompressedSize))
                    .Equals(currentHash, StringComparison.OrdinalIgnoreCase))
                    throw new IOException("恢复失败且自动回滚校验失败，请使用完整 NPK 备份恢复。");
                throw;
            }
        }

        string cleanupNotice = AutoPruneFpsTransactionBackups();
        WriteLog("FpsUnlock restore backup=" + backupPath + " " + cleanupNotice);
        return "已恢复官方原始 120 FPS 槽位。" + Environment.NewLine +
               "恢复前完整备份：" + backupPath + Environment.NewLine +
               cleanupNotice;
    }

    private static FpsNxpkRecord ParseFpsNxpk(FileStream stream)
    {
        if (stream.Length < 1024 * 1024 || stream.Length > UInt32.MaxValue)
            throw new InvalidDataException("NPK 文件大小不在支持范围。");
        byte[] header = FpsDecryptAesEcb(FpsReadAt(stream, 0, 32));
        if (Encoding.ASCII.GetString(header, 8, 4) != "NXPK")
            throw new InvalidDataException("文件不是 NXPK 包。");
        if (FpsReadUInt32(header, 12) != 3)
            throw new InvalidDataException("只支持 NXPK v3。");
        long indexOffset = FpsReadUInt32(header, 16);
        int recordCount = checked((int)FpsReadUInt32(header, 20));
        long indexSize = checked((long)recordCount * 48L);
        if (recordCount <= 0 || recordCount > 500000 ||
            indexOffset < 32 || indexOffset + indexSize != stream.Length ||
            indexSize > Int32.MaxValue)
            throw new InvalidDataException("NXPK 索引边界异常。");
        byte[] index = FpsDecryptAesEcb(
            FpsReadAt(stream, indexOffset, checked((int)indexSize)));
        FpsNxpkRecord found = null;
        for (int indexNumber = 0; indexNumber < recordCount; indexNumber++)
        {
            int offset = indexNumber * 48;
            if (FpsReadUInt32(index, offset) != FpsTargetNameHash ||
                FpsReadUInt32(index, offset + 4) != FpsTargetNameId)
                continue;
            if (found != null)
                throw new InvalidDataException("发现多个 SettingManager 目标记录。");
            found = new FpsNxpkRecord
            {
                IndexOffset = indexOffset,
                RecordCount = recordCount,
                DataOffset = FpsReadUInt32(index, offset + 8),
                CompressedSize = checked((int)FpsReadUInt32(index, offset + 12)),
                OriginalSize = checked((int)FpsReadUInt32(index, offset + 16)),
                Checksum1 = FpsReadUInt32(index, offset + 20),
                Checksum2 = FpsReadUInt32(index, offset + 24),
                CompressionType = FpsReadUInt32(index, offset + 28)
            };
            for (int reserved = 0; reserved < 4; reserved++)
            {
                if (FpsReadUInt32(index, offset + 32 + reserved * 4) != 0)
                    throw new InvalidDataException("目标记录保留字段发生变化。");
            }
        }
        if (found == null)
            throw new InvalidDataException("未找到兼容的 SettingManager 记录。");
        if (found.CompressedSize != FpsSlotSize ||
            found.OriginalSize != FpsOriginalSize ||
            found.Checksum1 != FpsChecksum1 ||
            found.Checksum2 != FpsChecksum2 ||
            found.CompressionType != FpsCompressionType ||
            found.DataOffset < 32 ||
            found.DataOffset + found.CompressedSize > found.IndexOffset)
            throw new InvalidDataException("SettingManager 元数据与已审查版本不一致。");
        return found;
    }

    private static byte[] LoadFpsPatch(string fileName, string expectedHash)
    {
        string path = Path.Combine(FpsPatchDirectory(), fileName);
        if (!File.Exists(path))
            throw new FileNotFoundException("缺少帧率补丁资源：" + fileName, path);
        byte[] data = File.ReadAllBytes(path);
        if (data.Length != FpsSlotSize ||
            !FpsSha256(data).Equals(expectedHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("帧率补丁资源校验失败：" + fileName);
        return data;
    }

    private static void EnsureFpsOfficialBaseline(
        string packagePath,
        FileStream source,
        FpsNxpkRecord record,
        byte[] originalPatch,
        FpsCompatibilityProfile profile)
    {
        string backupDir = FpsProtectedBackupDirectory(profile);
        Directory.CreateDirectory(backupDir);
        string baseline = FpsOfficialBaselinePath(profile);
        if (File.Exists(baseline))
        {
            if (!FpsSha256File(baseline).Equals(
                profile.NormalizedSha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("当前平台版本的官方原始基线已存在但哈希异常，请先人工检查。");
            return;
        }

        string partial = baseline + ".partial";
        if (File.Exists(partial)) File.Delete(partial);
        source.Flush();
        FpsCopyOpenStream(source, partial);
        try
        {
            using (FileStream backup = new FileStream(
                partial, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
            {
                FpsWriteAt(backup, record.DataOffset, originalPatch);
                if (!FpsSha256File(backup).Equals(
                    profile.NormalizedSha256, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("无法重建经哈希验证的平台版本原始基线备份。");
            }
            File.Move(partial, baseline);
        }
        catch
        {
            try { if (File.Exists(partial)) File.Delete(partial); } catch { }
            throw;
        }
    }

    private static string CreateFpsTransactionBackup(string stateId, FileStream source)
    {
        string backupDir = FpsBackupDirectory();
        Directory.CreateDirectory(backupDir);
        string sourceHash = FpsSha256File(source);
        string safeState = Regex.Replace(stateId ?? "unknown", @"[^A-Za-z0-9\-]", "_");
        string name = "script.py314.lc.npk." +
            DateTime.Now.ToString("yyyyMMdd-HHmmss-fff", CultureInfo.InvariantCulture) +
            "." + safeState + "." + sourceHash.Substring(0, 16) + ".bak";
        string target = Path.Combine(backupDir, name);
        string partial = target + ".partial";
        try
        {
            FpsCopyOpenStream(source, partial);
            string copiedHash = FpsSha256File(partial);
            if (!copiedHash.Equals(sourceHash, StringComparison.OrdinalIgnoreCase))
                throw new IOException("完整 NPK 备份复制后哈希不一致。");
            File.Move(partial, target);
            return target;
        }
        catch
        {
            try { if (File.Exists(partial)) File.Delete(partial); } catch { }
            throw;
        }
    }

    private static FileInfo[] GetFpsTransactionBackups()
    {
        string backupDir = FpsBackupDirectory();
        if (String.IsNullOrEmpty(backupDir) || !Directory.Exists(backupDir))
            return new FileInfo[0];

        List<FileInfo> backups = new List<FileInfo>();
        foreach (string path in Directory.GetFiles(
            backupDir, "script.py314.lc.npk.*.bak", SearchOption.TopDirectoryOnly))
        {
            string name = Path.GetFileName(path);
            if (FpsTransactionBackupNamePattern.IsMatch(name))
                backups.Add(new FileInfo(path));
        }
        backups.Sort(delegate(FileInfo left, FileInfo right)
        {
            int byName = StringComparer.OrdinalIgnoreCase.Compare(right.Name, left.Name);
            return byName != 0 ? byName : right.LastWriteTimeUtc.CompareTo(left.LastWriteTimeUtc);
        });
        return backups.ToArray();
    }

    private static int PruneFpsTransactionBackups(int keepLatestCount)
    {
        if (keepLatestCount < 0)
            throw new ArgumentOutOfRangeException("keepLatestCount");

        FileInfo[] backups = GetFpsTransactionBackups();
        int removed = 0;
        for (int index = keepLatestCount; index < backups.Length; index++)
        {
            backups[index].Delete();
            removed++;
        }
        return removed;
    }

    private static string AutoPruneFpsTransactionBackups()
    {
        try
        {
            int removed = PruneFpsTransactionBackups(1);
            return removed > 0
                ? "自动清理了 " + removed.ToString(CultureInfo.InvariantCulture) +
                  " 份旧事务备份；官方初始还原点与最新 1 份备份已保留。"
                : "备份保留策略已确认：官方初始还原点 + 最新 1 份事务备份。";
        }
        catch (Exception ex)
        {
            WriteLog("FpsBackup auto-prune failed: " + ex.Message);
            return "帧率修改已完成，但自动清理旧备份失败：" + ex.Message;
        }
    }

    private static string CleanFpsTransactionBackups()
    {
        if (!IsValidGameRoot(gameRoot))
            throw new InvalidOperationException("请先选择有效的游戏目录。");

        string packagePath = FpsPackagePath();
        if (!File.Exists(packagePath))
            throw new FileNotFoundException("未找到帧率目标包体。", packagePath);
        byte[] originalPatch = LoadFpsPatch("patch_original.bin", FpsOriginalSlotSha256);
        FpsCompatibilityProfile profile;
        using (FileStream stream = new FileStream(
            packagePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
        {
            FpsNxpkRecord record = ParseFpsNxpk(stream);
            byte[] current = FpsReadAt(stream, record.DataOffset, record.CompressedSize);
            if (!IdentifyFpsSlotState(FpsSha256(current)).Writable)
                throw new InvalidDataException("当前目标槽位未知，拒绝清理事务备份。");
            profile = BuildFpsCompatibilityProfile(
                ComputeFpsNormalizedArchiveHash(stream, record, originalPatch));
        }

        string baseline = FpsOfficialBaselinePath(profile);
        if (!File.Exists(baseline))
            throw new InvalidOperationException("当前平台版本尚未建立官方初始还原点，拒绝清理事务备份。");
        if (!FpsSha256File(baseline).Equals(
            profile.NormalizedSha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("官方初始还原点哈希异常，拒绝清理其他备份。");

        int removed = PruneFpsTransactionBackups(0);
        WriteLog("FpsBackup manual-clean removed=" +
            removed.ToString(CultureInfo.InvariantCulture) +
            " baseline=" + baseline);
        return removed > 0
            ? "已清理 " + removed.ToString(CultureInfo.InvariantCulture) +
              " 份事务备份；官方初始还原点已永久保留。"
            : "没有可清理的事务备份；官方初始还原点保持不变。";
    }

    private static void FpsCopyOpenStream(FileStream source, string target)
    {
        long originalPosition = source.Position;
        try
        {
            source.Position = 0;
            using (FileStream output = new FileStream(
                target, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                source.CopyTo(output);
                output.Flush(true);
            }
        }
        finally
        {
            source.Position = originalPosition;
        }
    }

    private static void EnsureFpsBackupCapacity(
        string packagePath,
        string baselinePath,
        bool baselineMissing,
        bool transactionNeeded)
    {
        FileInfo info = new FileInfo(packagePath);
        string gameDriveRoot = Path.GetPathRoot(info.FullName);
        string protectedDriveRoot = Path.GetPathRoot(Path.GetFullPath(baselinePath));
        long safetyMargin = 128L * 1024L * 1024L;
        long gameDriveRequired = transactionNeeded
            ? checked(info.Length + safetyMargin)
            : 0;
        if (baselineMissing &&
            gameDriveRoot.Equals(protectedDriveRoot, StringComparison.OrdinalIgnoreCase))
            gameDriveRequired = checked(
                gameDriveRequired + info.Length + (transactionNeeded ? 0 : safetyMargin));
        if (gameDriveRequired > 0)
            EnsureFpsFreeSpace(gameDriveRoot, gameDriveRequired, "帧率安全备份");

        if (baselineMissing &&
            !gameDriveRoot.Equals(protectedDriveRoot, StringComparison.OrdinalIgnoreCase))
            EnsureFpsFreeSpace(
                protectedDriveRoot,
                checked(info.Length + safetyMargin),
                "永久还原点");
    }

    private static void EnsureFpsFreeSpace(string driveRoot, long required, string purpose)
    {
        DriveInfo drive = new DriveInfo(driveRoot);
        if (drive.AvailableFreeSpace < required)
            throw new IOException(purpose + "空间不足；" + driveRoot + " 至少需要 " +
                (required / 1024L / 1024L).ToString(CultureInfo.InvariantCulture) +
                " MB 可用空间。");
    }

    private static bool IsFpsGameRunning()
    {
        string[] names = new string[] { "lifeafter", "mingrizhihou" };
        foreach (string name in names)
        {
            try
            {
                if (Process.GetProcessesByName(name).Length > 0) return true;
            }
            catch { }
        }
        return false;
    }

    private static void EnsureFpsGameStopped()
    {
        if (IsFpsGameRunning())
            throw new InvalidOperationException("请先完全退出游戏，再修改或恢复帧率补丁。");
    }

    private static string ComputeFpsNormalizedArchiveHash(
        FileStream stream,
        FpsNxpkRecord record,
        byte[] originalPatch)
    {
        stream.Position = 0;
        using (SHA256 sha = SHA256.Create())
        {
            byte[] buffer = new byte[4 * 1024 * 1024];
            FpsHashRange(stream, sha, record.DataOffset, buffer);
            sha.TransformBlock(originalPatch, 0, originalPatch.Length, null, 0);
            stream.Position = record.DataOffset + record.CompressedSize;
            FpsHashRange(stream, sha, stream.Length - stream.Position, buffer);
            sha.TransformFinalBlock(new byte[0], 0, 0);
            return FpsHex(sha.Hash);
        }
    }

    private static void ComputeFpsArchiveHashes(
        FileStream stream,
        FpsNxpkRecord record,
        byte[] currentSlot,
        byte[] originalPatch,
        out string packageHash,
        out string normalizedHash)
    {
        if (currentSlot.Length != record.CompressedSize ||
            originalPatch.Length != record.CompressedSize)
            throw new InvalidDataException("帧率槽位长度不匹配。");

        stream.Position = 0;
        using (SHA256 packageSha = SHA256.Create())
        using (SHA256 normalizedSha = SHA256.Create())
        {
            byte[] buffer = new byte[4 * 1024 * 1024];
            FpsHashRangePair(
                stream, packageSha, normalizedSha, record.DataOffset, buffer);
            packageSha.TransformBlock(currentSlot, 0, currentSlot.Length, null, 0);
            normalizedSha.TransformBlock(originalPatch, 0, originalPatch.Length, null, 0);
            stream.Position = record.DataOffset + record.CompressedSize;
            FpsHashRangePair(
                stream,
                packageSha,
                normalizedSha,
                stream.Length - stream.Position,
                buffer);
            packageSha.TransformFinalBlock(new byte[0], 0, 0);
            normalizedSha.TransformFinalBlock(new byte[0], 0, 0);
            packageHash = FpsHex(packageSha.Hash);
            normalizedHash = FpsHex(normalizedSha.Hash);
        }
    }

    private static void FpsHashRangePair(
        FileStream stream,
        HashAlgorithm first,
        HashAlgorithm second,
        long count,
        byte[] buffer)
    {
        long remaining = count;
        while (remaining > 0)
        {
            int wanted = (int)Math.Min(buffer.Length, remaining);
            int read = stream.Read(buffer, 0, wanted);
            if (read <= 0) throw new EndOfStreamException();
            first.TransformBlock(buffer, 0, read, null, 0);
            second.TransformBlock(buffer, 0, read, null, 0);
            remaining -= read;
        }
    }

    private static void FpsHashRange(
        FileStream stream,
        HashAlgorithm hash,
        long count,
        byte[] buffer)
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

    private static byte[] FpsReadAt(FileStream stream, long offset, int count)
    {
        byte[] data = new byte[count];
        stream.Position = offset;
        int total = 0;
        while (total < count)
        {
            int read = stream.Read(data, total, count - total);
            if (read <= 0) throw new EndOfStreamException();
            total += read;
        }
        return data;
    }

    private static void FpsWriteAt(FileStream stream, long offset, byte[] data)
    {
        stream.Position = offset;
        stream.Write(data, 0, data.Length);
        stream.Flush(true);
    }

    private static uint FpsReadUInt32(byte[] data, int offset)
    {
        return (uint)(
            data[offset] |
            (data[offset + 1] << 8) |
            (data[offset + 2] << 16) |
            (data[offset + 3] << 24));
    }

    private static byte[] FpsDecryptAesEcb(byte[] encrypted)
    {
        if (encrypted.Length % 16 != 0)
            throw new InvalidDataException("NXPK AES 数据未按 16 字节对齐。");
        using (Aes aes = Aes.Create())
        {
            aes.Key = FpsNxpkKey;
            aes.Mode = CipherMode.ECB;
            aes.Padding = PaddingMode.None;
            using (ICryptoTransform transform = aes.CreateDecryptor())
                return transform.TransformFinalBlock(encrypted, 0, encrypted.Length);
        }
    }

    private static string FpsSha256(byte[] data)
    {
        using (SHA256 sha = SHA256.Create()) return FpsHex(sha.ComputeHash(data));
    }

    private static string FpsSha256File(string path)
    {
        using (FileStream stream = File.OpenRead(path)) return FpsSha256File(stream);
    }

    private static string FpsSha256File(FileStream stream)
    {
        long originalPosition = stream.Position;
        try
        {
            stream.Position = 0;
            using (SHA256 sha = SHA256.Create()) return FpsHex(sha.ComputeHash(stream));
        }
        finally
        {
            stream.Position = originalPosition;
        }
    }

    private static string FpsHex(byte[] data)
    {
        StringBuilder result = new StringBuilder(data.Length * 2);
        foreach (byte value in data)
            result.Append(value.ToString("X2", CultureInfo.InvariantCulture));
        return result.ToString();
    }

    private static string CaptureInstancesJson()
    {
        List<InstanceSnapshot> snapshots = new GameInstanceMonitor().Capture();
        StringBuilder json = new StringBuilder();
        json.Append("{\"capturedAt\":")
            .Append((long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds)
            .Append(",\"instances\":[");
        for (int index = 0; index < snapshots.Count; index++)
        {
            if (index > 0) json.Append(',');
            InstanceSnapshot item = snapshots[index];
            json.Append("{\"pid\":").Append(item.ProcessId)
                .Append(",\"name\":\"").Append(JsonEscape(item.DisplayName)).Append('"')
                .Append(",\"title\":\"").Append(JsonEscape(item.WindowTitle)).Append('"')
                .Append(",\"width\":").Append(item.ClientSize.Width)
                .Append(",\"height\":").Append(item.ClientSize.Height)
                .Append(",\"totalCpuMs\":").Append(item.TotalProcessorMilliseconds.ToString("0.###", CultureInfo.InvariantCulture))
                .Append(",\"workingSetBytes\":").Append(item.WorkingSetBytes)
                .Append(",\"runningSeconds\":").Append(Math.Max(0, (long)item.RunningTime.TotalSeconds))
                .Append('}');
        }
        json.Append("]}");
        return json.ToString();
    }

    private static string JsonEscape(string value)
    {
        if (String.IsNullOrEmpty(value)) return "";
        StringBuilder escaped = new StringBuilder(value.Length + 8);
        foreach (char character in value)
        {
            switch (character)
            {
                case '\\': escaped.Append(@"\\"); break;
                case '"': escaped.Append("\\\""); break;
                case '\r': escaped.Append(@"\r"); break;
                case '\n': escaped.Append(@"\n"); break;
                case '\t': escaped.Append(@"\t"); break;
                default:
                    if (character < 32)
                    {
                        escaped.Append("\\u").Append(((int)character).ToString("x4"));
                    }
                    else
                    {
                        escaped.Append(character);
                    }
                    break;
            }
        }
        return escaped.ToString();
    }

    private sealed class CoverPanel : Panel
    {
        private readonly Image coverImage;
        private readonly string projectUrl;

        public CoverPanel(string url)
        {
            projectUrl = url;
            DoubleBuffered = true;
            try
            {
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("cover.png"))
                {
                    if (stream != null)
                    {
                        using (Image embedded = Image.FromStream(stream))
                        {
                            coverImage = new Bitmap(embedded);
                        }
                    }
                }

                if (coverImage == null)
                {
                    string imagePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets", "cover.png");
                    if (File.Exists(imagePath))
                    {
                        using (Image fileImage = Image.FromFile(imagePath))
                        {
                            coverImage = new Bitmap(fileImage);
                        }
                    }
                }
            }
            catch
            {
                coverImage = null;
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing && coverImage != null)
            {
                coverImage.Dispose();
            }

            base.Dispose(disposing);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Rectangle bounds = ClientRectangle;

            if (coverImage != null)
            {
                g.DrawImage(coverImage, GetCoverImageRect(coverImage.Size, bounds));
            }
            else
            {
                DrawFallbackCover(g, bounds);
            }

            using (LinearGradientBrush shade = new LinearGradientBrush(
                bounds,
                Color.FromArgb(238, 5, 13, 19),
                Color.FromArgb(86, 5, 13, 19),
                LinearGradientMode.Horizontal))
            {
                g.FillRectangle(shade, bounds);
            }

            using (Pen border = new Pen(Color.FromArgb(70, 95, 224, 203)))
            {
                g.DrawRectangle(border, 0, 0, bounds.Width - 1, bounds.Height - 1);
            }

            using (Font titleFont = new Font("Microsoft YaHei UI", 20F, FontStyle.Bold))
            using (Font subtitleFont = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular))
            using (Font tagFont = new Font("Microsoft YaHei UI", 8F, FontStyle.Bold))
            using (Brush titleBrush = new SolidBrush(Color.White))
            using (Brush subtitleBrush = new SolidBrush(Color.FromArgb(205, 220, 232, 234)))
            using (Brush tagBrush = new SolidBrush(Color.FromArgb(255, 103, 232, 207)))
            {
                g.DrawString("LIFEAFTER  //  \u753b\u8d28\u63a7\u5236\u53f0", tagFont, tagBrush, 26, 17);
                g.DrawString("\u660e\u65e5\u4e4b\u540e\u753b\u8d28\u542f\u52a8\u5668", titleFont, titleBrush, 24, 37);
                g.DrawString("\u4e00\u952e\u9884\u8bbe  \u00b7  \u7a33\u5b9a\u591a\u5f00  \u00b7  \u81ea\u52a8\u5907\u4efd", subtitleFont, subtitleBrush, 27, 76);
            }
        }

        private static Rectangle GetCoverImageRect(Size imageSize, Rectangle bounds)
        {
            if (imageSize.Width <= 0 || imageSize.Height <= 0) return bounds;
            double scale = Math.Max(bounds.Width / (double)imageSize.Width, bounds.Height / (double)imageSize.Height);
            int width = (int)Math.Ceiling(imageSize.Width * scale);
            int height = (int)Math.Ceiling(imageSize.Height * scale);
            return new Rectangle(
                bounds.Left + (bounds.Width - width) / 2,
                bounds.Top + (bounds.Height - height) / 2,
                width,
                height);
        }

        private static void DrawFallbackCover(Graphics g, Rectangle bounds)
        {
            using (LinearGradientBrush back = new LinearGradientBrush(
                bounds,
                Color.FromArgb(13, 35, 52),
                Color.FromArgb(224, 177, 101),
                LinearGradientMode.ForwardDiagonal))
            {
                g.FillRectangle(back, bounds);
            }

            using (Pen line = new Pen(Color.FromArgb(120, 125, 210, 245), 1F))
            {
                for (int x = 28; x < bounds.Width; x += 54)
                {
                    g.DrawLine(line, x, 12, x + 70, bounds.Height - 12);
                }
            }

            using (SolidBrush mountain = new SolidBrush(Color.FromArgb(125, 10, 24, 35)))
            {
                Point[] ridge = new Point[]
                {
                    new Point(0, bounds.Bottom),
                    new Point(100, bounds.Bottom - 26),
                    new Point(210, bounds.Bottom - 50),
                    new Point(340, bounds.Bottom - 28),
                    new Point(510, bounds.Bottom - 62),
                    new Point(bounds.Right, bounds.Bottom - 24),
                    new Point(bounds.Right, bounds.Bottom)
                };
                g.FillPolygon(mountain, ridge);
            }
        }
    }

    private sealed class ModernButton : Button
    {
        private bool hovering;
        private bool pressing;

        public ModernButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            FlatStyle = FlatStyle.Flat;
            FlatAppearance.BorderSize = 0;
            Cursor = Cursors.Hand;
        }

        protected override void OnMouseEnter(EventArgs e) { hovering = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hovering = false; pressing = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { pressing = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { pressing = false; Invalidate(); base.OnMouseUp(e); }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            Color fill = pressing ? FlatAppearance.MouseDownBackColor :
                         hovering ? FlatAppearance.MouseOverBackColor : BackColor;
            Rectangle rect = new Rectangle(0, 0, Width - 1, Height - 1);
            using (GraphicsPath path = RoundedRectangle(rect, 7))
            using (SolidBrush brush = new SolidBrush(fill))
            using (Pen border = new Pen(FlatAppearance.BorderColor))
            {
                e.Graphics.FillPath(brush, path);
                e.Graphics.DrawPath(border, path);
            }

            TextRenderer.DrawText(
                e.Graphics,
                Text,
                Font,
                rect,
                Enabled ? ForeColor : Color.FromArgb(110, ForeColor),
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis);
        }

        private static GraphicsPath RoundedRectangle(Rectangle rect, int radius)
        {
            int diameter = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
            path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
            path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    private sealed class InstanceMonitorPanel : Panel
    {
        private readonly List<InstanceSnapshot> snapshots = new List<InstanceSnapshot>();
        private static readonly Color Card = Color.FromArgb(150, 28, 39, 48);
        private static readonly Color Border = Color.FromArgb(65, 255, 255, 255);
        private static readonly Color PrimaryText = Color.FromArgb(244, 248, 250);
        private static readonly Color SecondaryText = Color.FromArgb(168, 181, 190);
        private static readonly Color Accent = Color.FromArgb(69, 202, 219);
        private static readonly Color Success = Color.FromArgb(74, 207, 139);

        public InstanceMonitorPanel()
        {
            DoubleBuffered = true;
            BackColor = Color.Transparent;
            AccessibleName = "\u5b9e\u4f8b\u8fd0\u884c\u8be6\u60c5";
            AccessibleRole = AccessibleRole.Grouping;
            AccessibleDescription = "\u6682\u65e0\u8fd0\u884c\u5b9e\u4f8b";
        }

        public void UpdateSnapshots(List<InstanceSnapshot> current)
        {
            snapshots.Clear();
            if (current != null) snapshots.AddRange(current);
            StringBuilder accessibility = new StringBuilder();
            accessibility.Append("\u8fd0\u884c\u4e2d ").Append(snapshots.Count).Append(" \u4e2a\u5b9e\u4f8b\u3002");
            foreach (InstanceSnapshot snapshot in snapshots)
            {
                accessibility
                    .Append(snapshot.DisplayName)
                    .Append("\uff0cCPU ")
                    .Append(snapshot.CpuPercent.ToString("0", CultureInfo.InvariantCulture))
                    .Append("%\uff0c\u5185\u5b58 ")
                    .Append((snapshot.WorkingSetBytes / 1073741824.0).ToString("0.0", CultureInfo.InvariantCulture))
                    .Append(" GB\u3002");
            }
            AccessibleDescription = accessibility.ToString();
            AccessibilityNotifyClients(AccessibleEvents.DescriptionChange, -1);
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

            using (Font heading = UiFont(13F, FontStyle.Bold))
            using (Font summary = UiFont(10F, FontStyle.Regular))
            using (SolidBrush titleBrush = new SolidBrush(PrimaryText))
            using (SolidBrush mutedBrush = new SolidBrush(SecondaryText))
            {
                g.DrawString("\u5b9e\u4f8b\u8fd0\u884c\u8be6\u60c5", heading, titleBrush, 20, 16);
                Rectangle summaryRect = new Rectangle(16, 52, Width - 32, 48);
                DrawGlassCard(g, summaryRect, 10);
                using (SolidBrush dot = new SolidBrush(snapshots.Count > 0 ? Success : SecondaryText))
                {
                    g.FillEllipse(dot, summaryRect.Left + 18, summaryRect.Top + 19, 10, 10);
                }
                g.DrawString(
                    snapshots.Count > 0 ? "\u8fd0\u884c\u4e2d  " + snapshots.Count : "\u6682\u65e0\u8fd0\u884c\u5b9e\u4f8b",
                    summary,
                    snapshots.Count > 0 ? titleBrush : mutedBrush,
                    summaryRect.Left + 38,
                    summaryRect.Top + 14);
            }

            if (snapshots.Count == 0)
            {
                DrawEmptyState(g);
                return;
            }

            int cardTop = 112;
            int available = Height - cardTop - 18;
            int cardHeight = Math.Min(102, Math.Max(80, (available - 10 * (snapshots.Count - 1)) / snapshots.Count));
            for (int i = 0; i < snapshots.Count; i++)
            {
                DrawInstanceCard(g, snapshots[i], new Rectangle(16, cardTop + i * (cardHeight + 10), Width - 32, cardHeight));
            }
        }

        private void DrawEmptyState(Graphics g)
        {
            Rectangle rect = new Rectangle(16, 114, Width - 32, 150);
            DrawGlassCard(g, rect, 12);
            using (Font iconFont = UiFont(25F, FontStyle.Regular))
            using (Font body = UiFont(10F, FontStyle.Regular))
            using (Font caption = UiFont(8.5F, FontStyle.Regular))
            using (SolidBrush icon = new SolidBrush(Color.FromArgb(110, Accent)))
            using (SolidBrush text = new SolidBrush(PrimaryText))
            using (SolidBrush muted = new SolidBrush(SecondaryText))
            {
                string glyph = "\u25a3";
                SizeF glyphSize = g.MeasureString(glyph, iconFont);
                g.DrawString(glyph, iconFont, icon, (Width - glyphSize.Width) / 2, rect.Top + 24);
                string line1 = "\u542f\u52a8\u6e38\u620f\u540e\u5c06\u81ea\u52a8\u663e\u793a";
                SizeF line1Size = g.MeasureString(line1, body);
                g.DrawString(line1, body, text, (Width - line1Size.Width) / 2, rect.Top + 76);
                string line2 = "\u652f\u6301\u6700\u591a 4 \u4e2a\u7a97\u53e3\u5b9e\u65f6\u76d1\u63a7";
                SizeF line2Size = g.MeasureString(line2, caption);
                g.DrawString(line2, caption, muted, (Width - line2Size.Width) / 2, rect.Top + 104);
            }
        }

        private static void DrawInstanceCard(Graphics g, InstanceSnapshot snapshot, Rectangle rect)
        {
            DrawGlassCard(g, rect, 11);
            int left = rect.Left + 18;
            int top = rect.Top + 13;
            string resolution = snapshot.ClientSize.IsEmpty
                ? "\u7b49\u5f85\u7a97\u53e3"
                : snapshot.ClientSize.Width + " \u00d7 " + snapshot.ClientSize.Height;
            string memory = (snapshot.WorkingSetBytes / 1073741824.0).ToString("0.0", CultureInfo.InvariantCulture) + " GB";
            string running = FormatRunningTime(snapshot.RunningTime);

            using (Font nameFont = UiFont(11F, FontStyle.Bold))
            using (Font bodyFont = UiFont(8.5F, FontStyle.Regular))
            using (Font valueFont = UiFont(9F, FontStyle.Bold))
            using (SolidBrush primary = new SolidBrush(PrimaryText))
            using (SolidBrush secondary = new SolidBrush(SecondaryText))
            using (SolidBrush success = new SolidBrush(Success))
            {
                g.FillEllipse(success, left, top + 7, 8, 8);
                string name = Ellipsize(snapshot.DisplayName, 18);
                g.DrawString(name, nameFont, primary, left + 16, top);
                g.DrawString("PID " + snapshot.ProcessId, bodyFont, secondary, rect.Right - 72, top + 2);

                int detailTop = top + 32;
                int columnWidth = (rect.Width - 36) / 4;
                DrawMetric(g, resolution, "\u7a97\u53e3", left, detailTop, columnWidth, valueFont, bodyFont, primary, secondary);
                DrawMetric(g, snapshot.CpuPercent.ToString("0", CultureInfo.InvariantCulture) + "%", "CPU", left + columnWidth, detailTop, columnWidth, valueFont, bodyFont, primary, secondary);
                DrawMetric(g, memory, "\u5185\u5b58", left + columnWidth * 2, detailTop, columnWidth, valueFont, bodyFont, primary, secondary);
                DrawMetric(g, running, "\u8fd0\u884c\u65f6\u957f", left + columnWidth * 3, detailTop, columnWidth, valueFont, bodyFont, primary, secondary);

                int barY = rect.Bottom - 12;
                DrawUsageBar(g, new Rectangle(left + columnWidth, barY, columnWidth - 18, 4), snapshot.CpuPercent / 100.0);
                double memoryRatio = Math.Min(1, snapshot.WorkingSetBytes / (8.0 * 1073741824.0));
                DrawUsageBar(g, new Rectangle(left + columnWidth * 2, barY, columnWidth - 18, 4), memoryRatio);
            }
        }

        private static void DrawMetric(
            Graphics g,
            string value,
            string label,
            int x,
            int y,
            int width,
            Font valueFont,
            Font labelFont,
            Brush primary,
            Brush secondary)
        {
            g.DrawString(label, labelFont, secondary, x, y);
            g.DrawString(Ellipsize(value, 16), valueFont, primary, new RectangleF(x, y + 18, width - 8, 22));
        }

        private static void DrawUsageBar(Graphics g, Rectangle rect, double ratio)
        {
            using (GraphicsPath backPath = RoundRect(rect, 2))
            using (SolidBrush back = new SolidBrush(Color.FromArgb(65, 120, 137, 146)))
            {
                g.FillPath(back, backPath);
            }
            int filled = Math.Max(2, (int)(rect.Width * Math.Max(0, Math.Min(1, ratio))));
            using (GraphicsPath fillPath = RoundRect(new Rectangle(rect.X, rect.Y, filled, rect.Height), 2))
            using (SolidBrush fill = new SolidBrush(Accent))
            {
                g.FillPath(fill, fillPath);
            }
        }

        private static string FormatRunningTime(TimeSpan time)
        {
            if (time < TimeSpan.Zero) time = TimeSpan.Zero;
            int hours = (int)Math.Min(999, time.TotalHours);
            return hours.ToString("00") + ":" + time.Minutes.ToString("00") + ":" + time.Seconds.ToString("00");
        }

        private static string Ellipsize(string text, int maxLength)
        {
            if (String.IsNullOrEmpty(text)) return "";
            return text.Length <= maxLength ? text : text.Substring(0, maxLength - 1) + "\u2026";
        }

        private static void DrawGlassCard(Graphics g, Rectangle rect, int radius)
        {
            using (GraphicsPath path = RoundRect(rect, radius))
            using (LinearGradientBrush fill = new LinearGradientBrush(
                rect,
                Color.FromArgb(165, 35, 48, 58),
                Card,
                LinearGradientMode.Vertical))
            using (Pen border = new Pen(Border))
            {
                g.FillPath(fill, path);
                g.DrawPath(border, path);
            }
        }

        private static GraphicsPath RoundRect(Rectangle rect, int radius)
        {
            int diameter = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
            path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
            path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        private static Font UiFont(float size, FontStyle style)
        {
            try { return new Font("Segoe UI Variable Text", size, style); }
            catch { return new Font("Segoe UI", size, style); }
        }
    }

    private sealed class LauncherForm : Form
    {
        private const int HeaderOffset = 126;
        private static readonly Color WindowBackColor = Color.FromArgb(6, 11, 15);
        private static readonly Color PanelBackColor = Color.FromArgb(13, 23, 28);
        private static readonly Color FieldBackColor = Color.FromArgb(8, 17, 21);
        private static readonly Color PrimaryColor = Color.FromArgb(35, 190, 164);
        private static readonly Color PrimaryHoverColor = Color.FromArgb(53, 218, 190);
        private static readonly Color WarningColor = Color.FromArgb(237, 183, 91);
        private static readonly Color CardBorderColor = Color.FromArgb(37, 73, 78);
        private static readonly Color TextColor = Color.FromArgb(232, 242, 241);
        private static readonly Color MutedTextColor = Color.FromArgb(132, 154, 155);

        private readonly ComboBox presetBox = new ComboBox();
        private readonly TextBox statusBox = new TextBox();
        private readonly Label pathLabel = new Label();
        private readonly Label descriptionLabel = new Label();
        private readonly CheckBox performanceModeCheckBox = new CheckBox();
        private readonly CheckBox advancedCheckBox = new CheckBox();
        private readonly ComboBox mainPresetBox = new ComboBox();
        private readonly ComboBox idlePresetBox = new ComboBox();
        private readonly ComboBox multiModeBox = new ComboBox();
        private readonly NumericUpDown idleCountBox = new NumericUpDown();
        private readonly NumericUpDown settleWaitBox = new NumericUpDown();
        private Label multiLabel;
        private Label mainLabel;
        private Label idleLabel;
        private Label countLabel;
        private Label waitLabel;
        private Label waitUnitLabel;
        private Button multiLaunchButton;
        private Label projectInfoLabel;
        private Label githubLabel;
        private Label versionLabel;
        private Button restoreButton;
        private Button shortcutButton;
        private Button factoryButton;
        private Button cleanButton;
        private Button openBackupButton;
        private Button openLogButton;
        private Label tiaoziLabel;
        private NumericUpDown tiaoziScaleBox;
        private Button tiaoziApplyButton;
        private readonly GameInstanceMonitor instanceMonitor = new GameInstanceMonitor();
        private readonly InstanceMonitorPanel instanceMonitorPanel = new InstanceMonitorPanel();
        private readonly System.Windows.Forms.Timer instanceMonitorTimer = new System.Windows.Forms.Timer();
        private Button startNavButton;
        private Button multiNavButton;
        private Button toolsNavButton;
        private bool toolsPageVisible;

        public LauncherForm()
        {
            Text = "\u660e\u65e5\u4e4b\u540e\u5b89\u5168\u753b\u8d28\u542f\u52a8\u5668";
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1240, 820);
            MinimumSize = new Size(1100, 760);
            Font = CreateUiFont(9F, FontStyle.Regular);
            AutoScaleMode = AutoScaleMode.Dpi;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = WindowBackColor;
            DoubleBuffered = true;
            Icon icon = LoadWindowIcon();
            if (icon != null) Icon = icon;

            CoverPanel coverPanel = new CoverPanel(ProjectUrl)
            {
                Left = 16,
                Top = 16,
                Width = 690,
                Height = 106
            };
            Controls.Add(coverPanel);

            Label label = new Label
            {
                Text = "\u9009\u62e9\u9884\u8bbe\u540e\u70b9\u51fb\u5e94\u7528\uff0c\u6216\u76f4\u63a5\u5e94\u7528\u5e76\u542f\u52a8\u6e38\u620f\u3002",
                AutoSize = true,
                Left = 16,
                Top = 16
            };
            Controls.Add(label);

            pathLabel.AutoSize = false;
            pathLabel.Left = 16;
            pathLabel.Top = 42;
            pathLabel.Width = 500;
            pathLabel.Height = 38;
            Controls.Add(pathLabel);

            Button browseButton = new ModernButton
            {
                Text = "\u9009\u62e9\u6e38\u620f\u76ee\u5f55",
                Left = 535,
                Top = 44,
                Width = 130,
                Height = 30
            };
            browseButton.Click += delegate { ChooseGameRoot(); };
            Controls.Add(browseButton);

            presetBox.DropDownStyle = ComboBoxStyle.DropDownList;
            presetBox.Items.AddRange(new object[] { "2K 120", "1080p 120", "1080p 60", "900p 120", "900p 60", "720p 60", "540p 60", "540p 25" });
            presetBox.SelectedItem = "2K 120";
            presetBox.Left = 16;
            presetBox.Top = 92;
            presetBox.Width = 190;
            presetBox.SelectedIndexChanged += delegate { RefreshPresetDescription(); };
            Controls.Add(presetBox);

            descriptionLabel.AutoSize = false;
            descriptionLabel.Left = 16;
            descriptionLabel.Top = 124;
            descriptionLabel.Width = 455;
            descriptionLabel.Height = 22;
            Controls.Add(descriptionLabel);

            Button applyButton = new ModernButton
            {
                Text = "\u5e94\u7528",
                Left = 222,
                Top = 90,
                Width = 100,
                Height = 30
            };
            applyButton.Click += delegate { Apply(false); };
            Controls.Add(applyButton);

            Button launchButton = new ModernButton
            {
                Text = "\u5e94\u7528\u5e76\u542f\u52a8",
                Left = 334,
                Top = 90,
                Width = 140,
                Height = 30
            };
            launchButton.Click += delegate { Apply(true); };
            Controls.Add(launchButton);

            Button currentButton = new ModernButton
            {
                Text = "\u8bfb\u53d6\u5f53\u524d\u914d\u7f6e",
                Left = 486,
                Top = 90,
                Width = 145,
                Height = 30
            };
            currentButton.Click += delegate { statusBox.Text = "\u5f53\u524d\u914d\u7f6e\uff1a" + ReadCurrentConfigSummary(); };
            Controls.Add(currentButton);

            performanceModeCheckBox.Text = "\u6027\u80fd\u4f18\u5148";
            performanceModeCheckBox.Left = 640;
            performanceModeCheckBox.Top = 95;
            performanceModeCheckBox.Width = 90;
            performanceModeCheckBox.Checked = true;
            performanceModeCheckBox.CheckedChanged += delegate { RefreshPathLabel(); };
            Controls.Add(performanceModeCheckBox);

            restoreButton = new ModernButton
            {
                Text = "\u6062\u590d\u6700\u8fd1\u5907\u4efd",
                Left = 16,
                Top = 154,
                Width = 150,
                Height = 30
            };
            restoreButton.Click += delegate { RestoreBackupFromUi(); };
            Controls.Add(restoreButton);

            shortcutButton = new ModernButton
            {
                Text = "\u521b\u5efa\u684c\u9762\u5feb\u6377\u65b9\u5f0f",
                Left = 178,
                Top = 154,
                Width = 175,
                Height = 30
            };
            shortcutButton.Click += delegate
            {
                try
                {
                    CreateDesktopShortcut();
                    statusBox.Text = "\u5df2\u521b\u5efa\u684c\u9762\u5feb\u6377\u65b9\u5f0f\u3002";
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, ex.Message, "\u9519\u8bef", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            };
            Controls.Add(shortcutButton);

            factoryButton = new ModernButton
            {
                Text = "\u6062\u590d\u9ed8\u8ba4 2K120",
                Left = 365,
                Top = 154,
                Width = 150,
                Height = 30
            };
            factoryButton.Click += delegate { RestoreFactoryFromUi(); };
            Controls.Add(factoryButton);

            cleanButton = new ModernButton
            {
                Text = "\u6e05\u7406\u666e\u901a\u5907\u4efd",
                Left = 527,
                Top = 154,
                Width = 140,
                Height = 30
            };
            cleanButton.Click += delegate { CleanBackupsFromUi(); };
            Controls.Add(cleanButton);

            openBackupButton = new ModernButton
            {
                Text = "\u6253\u5f00\u5907\u4efd\u76ee\u5f55",
                Left = 16,
                Top = 188,
                Width = 150,
                Height = 30
            };
            openBackupButton.Click += delegate
            {
                try
                {
                    OpenFolder(Path.Combine(configDir, "profile_backups"));
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, ex.Message, "\u9519\u8bef", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            };
            Controls.Add(openBackupButton);

            openLogButton = new ModernButton
            {
                Text = "\u6253\u5f00\u65e5\u5fd7",
                Left = 178,
                Top = 188,
                Width = 120,
                Height = 30
            };
            openLogButton.Click += delegate
            {
                try
                {
                    OpenLogFile();
                }
                catch (Exception ex)
                {
                    MessageBox.Show(this, ex.Message, "\u9519\u8bef", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            };
            Controls.Add(openLogButton);

            tiaoziLabel = new Label
            {
                Text = "\u8df3\u5b57",
                AutoSize = true,
                Left = 310,
                Top = 194
            };
            Controls.Add(tiaoziLabel);

            tiaoziScaleBox = new NumericUpDown
            {
                Minimum = 0.1m,
                Maximum = 8.0m,
                DecimalPlaces = 1,
                Increment = 0.1m,
                Value = 1.5m,
                Left = 355,
                Top = 188,
                Width = 70
            };
            Controls.Add(tiaoziScaleBox);

            tiaoziApplyButton = new ModernButton
            {
                Text = "\u4fee\u6539\u8df3\u5b57",
                Left = 438,
                Top = 188,
                Width = 110,
                Height = 30
            };
            tiaoziApplyButton.Click += delegate { ApplyTiaoziScaleFromUi(); };
            Controls.Add(tiaoziApplyButton);

            advancedCheckBox.Text = "\u663e\u793a\u9ad8\u7ea7\u529f\u80fd";
            advancedCheckBox.Left = 486;
            advancedCheckBox.Top = 126;
            advancedCheckBox.Width = 150;
            advancedCheckBox.CheckedChanged += delegate { RefreshAdvancedVisibility(); };
            Controls.Add(advancedCheckBox);

            multiLabel = new Label
            {
                Text = "\u4e00\u952e\u591a\u5f00\uff1a",
                AutoSize = true,
                Left = 16,
                Top = 240
            };
            Controls.Add(multiLabel);

            mainLabel = new Label
            {
                Text = "\u4e3b\u529b",
                AutoSize = true,
                Left = 95,
                Top = 240
            };
            Controls.Add(mainLabel);

            mainPresetBox.DropDownStyle = ComboBoxStyle.DropDownList;
            mainPresetBox.Items.AddRange(new object[] { "2K 120", "1080p 120", "1080p 60", "900p 120" });
            mainPresetBox.SelectedItem = "2K 120";
            mainPresetBox.Left = 135;
            mainPresetBox.Top = 236;
            mainPresetBox.Width = 120;
            Controls.Add(mainPresetBox);

            idleLabel = new Label
            {
                Text = "\u6302\u673a",
                AutoSize = true,
                Left = 270,
                Top = 240
            };
            Controls.Add(idleLabel);

            idlePresetBox.DropDownStyle = ComboBoxStyle.DropDownList;
            idlePresetBox.Items.AddRange(new object[] { "540p 25", "540p 60", "720p 60", "900p 60" });
            idlePresetBox.SelectedItem = "540p 25";
            idlePresetBox.Left = 310;
            idlePresetBox.Top = 236;
            idlePresetBox.Width = 120;
            Controls.Add(idlePresetBox);

            countLabel = new Label
            {
                Text = "\u6570\u91cf",
                AutoSize = true,
                Left = 445,
                Top = 240
            };
            Controls.Add(countLabel);

            idleCountBox.Minimum = 0;
            idleCountBox.Maximum = 3;
            idleCountBox.Value = 3;
            idleCountBox.Left = 485;
            idleCountBox.Top = 236;
            idleCountBox.Width = 55;
            Controls.Add(idleCountBox);

            waitLabel = new Label
            {
                Text = "\u6a21\u5f0f",
                AutoSize = true,
                Left = 445,
                Top = 274
            };
            Controls.Add(waitLabel);

            multiModeBox.DropDownStyle = ComboBoxStyle.DropDownList;
            multiModeBox.Items.AddRange(new object[] { "\u5206\u6b65\u786e\u8ba4", "\u81ea\u52a8\u5012\u8ba1\u65f6" });
            multiModeBox.SelectedItem = "\u5206\u6b65\u786e\u8ba4";
            multiModeBox.Left = 485;
            multiModeBox.Top = 270;
            multiModeBox.Width = 100;
            Controls.Add(multiModeBox);

            settleWaitBox.Minimum = 5;
            settleWaitBox.Maximum = 180;
            settleWaitBox.Value = 20;
            settleWaitBox.Left = 595;
            settleWaitBox.Top = 270;
            settleWaitBox.Width = 50;
            Controls.Add(settleWaitBox);

            waitUnitLabel = new Label
            {
                Text = "\u79d2",
                AutoSize = true,
                Left = 650,
                Top = 274
            };
            Controls.Add(waitUnitLabel);

            multiLaunchButton = new ModernButton
            {
                Text = "\u7a33\u5b9a\u591a\u5f00",
                Left = 552,
                Top = 234,
                Width = 120,
                Height = 30
            };
            multiLaunchButton.Click += delegate { MultiLaunchFromUi(); };
            Controls.Add(multiLaunchButton);

            statusBox.Multiline = true;
            statusBox.ReadOnly = true;
            statusBox.ScrollBars = ScrollBars.Vertical;
            statusBox.Left = 16;
            statusBox.Top = 285;
            statusBox.Width = 650;
            statusBox.Height = 230;
            Controls.Add(statusBox);

            versionLabel = new Label
            {
                Text = AppVersion + "  \u516c\u76ca\u7248",
                AutoSize = true,
                Left = 585,
                Top = 545
            };
            Controls.Add(versionLabel);

            projectInfoLabel = new Label
            {
                Text = "\u4f5c\u8005\uff1a\u4e0d\u4e0e\u4e16\u4fd7\u7eb7\u4e89  /  \u516c\u76ca\u5f00\u6e90\uff0c\u514d\u8d39\u4f7f\u7528",
                AutoSize = true,
                Left = 16,
                Top = 525
            };
            Controls.Add(projectInfoLabel);

            githubLabel = new Label
            {
                Text = "GitHub: " + ProjectUrl,
                AutoSize = true,
                Left = 16,
                Top = 545
            };
            Controls.Add(githubLabel);

            ApplyDashboardLayout(
                coverPanel,
                label,
                browseButton,
                applyButton,
                launchButton,
                currentButton);
            ApplyVisualStyle();
            RefreshPresetDescription();
            RefreshAdvancedVisibility();
            RefreshPathLabel();
            StartInstanceMonitoring();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            DrawMicaBackground(g, ClientRectangle);
            DrawNavigationRail(g, new Rectangle(0, 0, 108, ClientSize.Height));

            Rectangle currentCard = new Rectangle(124, 184, 632, 230);
            Rectangle workflowCard = new Rectangle(124, 430, 632, 210);
            Rectangle logCard = new Rectangle(124, 656, 632, 82);
            Rectangle monitorCard = new Rectangle(772, 184, 432, 554);
            DrawCard(g, currentCard);
            DrawCard(g, workflowCard);
            DrawCard(g, logCard);
            DrawCard(g, monitorCard);

            DrawSectionLabel(g, "\u5f53\u524d\u9884\u8bbe", currentCard.Left + 20, currentCard.Top + 16);
            DrawSectionLabel(g, toolsPageVisible ? "\u5b89\u5168\u4e0e\u5de5\u5177" : "\u591a\u5f00\u65b9\u6848", workflowCard.Left + 20, workflowCard.Top + 16);
            DrawSectionLabel(g, "\u8fd0\u884c\u65e5\u5fd7", logCard.Left + 20, logCard.Top + 12);
        }

        private static void DrawSectionLabel(Graphics g, string text, int x, int y)
        {
            using (Font font = CreateUiFont(12F, FontStyle.Bold))
            using (SolidBrush fore = new SolidBrush(TextColor))
            {
                g.DrawString(text, font, fore, x, y);
            }
        }

        private static void DrawCard(Graphics g, Rectangle rect)
        {
            using (GraphicsPath path = RoundedRectangle(rect, 14))
            using (LinearGradientBrush fill = new LinearGradientBrush(
                rect,
                Color.FromArgb(205, 28, 39, 48),
                Color.FromArgb(185, 17, 27, 34),
                LinearGradientMode.Vertical))
            using (Pen border = new Pen(Color.FromArgb(60, 255, 255, 255)))
            {
                g.FillPath(fill, path);
                g.DrawPath(border, path);
            }

            using (Pen highlight = new Pen(Color.FromArgb(38, 255, 255, 255), 1F))
            {
                g.DrawLine(highlight, rect.Left + 16, rect.Top + 1, rect.Right - 16, rect.Top + 1);
            }
        }

        private static void DrawMicaBackground(Graphics g, Rectangle bounds)
        {
            using (LinearGradientBrush back = new LinearGradientBrush(
                bounds,
                Color.FromArgb(12, 21, 29),
                Color.FromArgb(20, 31, 40),
                LinearGradientMode.ForwardDiagonal))
            {
                g.FillRectangle(back, bounds);
            }

            using (SolidBrush blueGlow = new SolidBrush(Color.FromArgb(22, 45, 127, 165)))
            {
                g.FillEllipse(blueGlow, bounds.Right - 400, -190, 520, 430);
            }
            using (SolidBrush tealGlow = new SolidBrush(Color.FromArgb(18, 45, 190, 180)))
            {
                g.FillEllipse(tealGlow, -230, bounds.Bottom - 260, 440, 390);
            }
        }

        private static void DrawNavigationRail(Graphics g, Rectangle rect)
        {
            using (LinearGradientBrush fill = new LinearGradientBrush(
                rect,
                Color.FromArgb(225, 11, 24, 36),
                Color.FromArgb(210, 9, 19, 29),
                LinearGradientMode.Vertical))
            using (Pen border = new Pen(Color.FromArgb(45, 255, 255, 255)))
            {
                g.FillRectangle(fill, rect);
                g.DrawLine(border, rect.Right - 1, rect.Top, rect.Right - 1, rect.Bottom);
            }
        }

        private static GraphicsPath RoundedRectangle(Rectangle rect, int radius)
        {
            int diameter = radius * 2;
            GraphicsPath path = new GraphicsPath();
            path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
            path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
            path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            TryEnableWindows11Backdrop();
        }

        private void TryEnableWindows11Backdrop()
        {
            try
            {
                int enabled = 1;
                DwmSetWindowAttribute(Handle, 20, ref enabled, sizeof(int));
                int rounded = 2;
                DwmSetWindowAttribute(Handle, 33, ref rounded, sizeof(int));
                int mica = 2;
                int result = DwmSetWindowAttribute(Handle, 38, ref mica, sizeof(int));
                if (result != 0)
                {
                    DwmSetWindowAttribute(Handle, 1029, ref enabled, sizeof(int));
                }
                DwmMargins margins = new DwmMargins { Left = 0, Right = 0, Top = 1, Bottom = 0 };
                DwmExtendFrameIntoClientArea(Handle, ref margins);
            }
            catch
            {
            }
        }

        private void ApplyDashboardLayout(
            CoverPanel coverPanel,
            Label instructionLabel,
            Button browseButton,
            Button applyButton,
            Button launchButton,
            Button currentButton)
        {
            coverPanel.SetBounds(124, 16, 1080, 152);
            using (GraphicsPath coverPath = RoundedRectangle(new Rectangle(0, 0, coverPanel.Width, coverPanel.Height), 14))
            {
                coverPanel.Region = new Region(coverPath);
            }

            instructionLabel.Visible = false;
            pathLabel.SetBounds(148, 129, 730, 24);
            pathLabel.AutoEllipsis = true;
            browseButton.SetBounds(1030, 124, 150, 34);
            pathLabel.BringToFront();
            browseButton.BringToFront();

            presetBox.SetBounds(150, 250, 205, 34);
            presetBox.Font = CreateUiFont(12F, FontStyle.Bold);
            descriptionLabel.SetBounds(150, 298, 570, 40);
            applyButton.SetBounds(150, 350, 128, 38);
            launchButton.SetBounds(292, 350, 196, 38);
            currentButton.SetBounds(502, 350, 160, 38);
            performanceModeCheckBox.SetBounds(652, 258, 88, 28);
            advancedCheckBox.Visible = false;

            multiLabel.Visible = false;
            mainLabel.SetBounds(150, 480, 46, 28);
            mainPresetBox.SetBounds(202, 474, 140, 32);
            idleLabel.Text = "\u5c0f\u53f7";
            idleLabel.SetBounds(364, 480, 46, 28);
            idlePresetBox.SetBounds(416, 474, 140, 32);
            countLabel.SetBounds(574, 480, 42, 28);
            idleCountBox.SetBounds(620, 474, 58, 32);
            multiLaunchButton.SetBounds(570, 548, 160, 38);

            waitLabel.SetBounds(150, 548, 42, 28);
            multiModeBox.SetBounds(202, 542, 150, 32);
            settleWaitBox.SetBounds(372, 542, 64, 32);
            waitUnitLabel.SetBounds(442, 548, 24, 28);

            restoreButton.SetBounds(150, 476, 150, 34);
            shortcutButton.SetBounds(314, 476, 174, 34);
            factoryButton.SetBounds(502, 476, 150, 34);
            cleanButton.SetBounds(150, 526, 150, 34);
            openBackupButton.SetBounds(314, 526, 150, 34);
            openLogButton.SetBounds(478, 526, 120, 34);
            tiaoziLabel.SetBounds(150, 584, 42, 28);
            tiaoziScaleBox.SetBounds(202, 578, 78, 32);
            tiaoziApplyButton.SetBounds(294, 578, 120, 34);

            statusBox.SetBounds(148, 689, 584, 40);
            statusBox.ScrollBars = ScrollBars.None;
            statusBox.Font = CreateUiFont(8.5F, FontStyle.Regular);
            projectInfoLabel.SetBounds(124, 748, 420, 22);
            githubLabel.Visible = false;
            versionLabel.SetBounds(1110, 748, 90, 22);

            instanceMonitorPanel.SetBounds(772, 184, 432, 554);
            Controls.Add(instanceMonitorPanel);
            instanceMonitorPanel.BringToFront();

            startNavButton = CreateNavigationButton("01\r\n\u542f\u52a8", 18, 40);
            multiNavButton = CreateNavigationButton("02\r\n\u591a\u5f00", 18, 160);
            toolsNavButton = CreateNavigationButton("03\r\n\u5de5\u5177", 18, 280);
            startNavButton.Click += delegate
            {
                advancedCheckBox.Checked = false;
                presetBox.Focus();
            };
            multiNavButton.Click += delegate
            {
                advancedCheckBox.Checked = false;
                mainPresetBox.Focus();
            };
            toolsNavButton.Click += delegate { advancedCheckBox.Checked = true; };
            Controls.Add(startNavButton);
            Controls.Add(multiNavButton);
            Controls.Add(toolsNavButton);
            startNavButton.BringToFront();
            multiNavButton.BringToFront();
            toolsNavButton.BringToFront();
        }

        private Button CreateNavigationButton(string text, int left, int top)
        {
            ModernButton button = new ModernButton
            {
                Text = text,
                Left = left,
                Top = top,
                Width = 72,
                Height = 94,
                Font = CreateUiFont(10.5F, FontStyle.Regular),
                BackColor = Color.FromArgb(24, 39, 49),
                ForeColor = TextColor
            };
            button.FlatAppearance.BorderColor = Color.FromArgb(50, 255, 255, 255);
            button.FlatAppearance.MouseOverBackColor = Color.FromArgb(43, 72, 86);
            button.FlatAppearance.MouseDownBackColor = Color.FromArgb(31, 57, 70);
            return button;
        }

        private void StartInstanceMonitoring()
        {
            instanceMonitorTimer.Interval = 1200;
            instanceMonitorTimer.Tick += delegate { RefreshInstanceMonitor(); };
            instanceMonitorTimer.Start();
            RefreshInstanceMonitor();
            FormClosed += delegate { instanceMonitorTimer.Stop(); };
        }

        private void RefreshInstanceMonitor()
        {
            try
            {
                instanceMonitorPanel.UpdateSnapshots(instanceMonitor.Capture());
            }
            catch
            {
                instanceMonitorPanel.UpdateSnapshots(new List<InstanceSnapshot>());
            }
        }

        private static Font CreateUiFont(float size, FontStyle style)
        {
            try { return new Font("Segoe UI Variable Text", size, style); }
            catch { return new Font("Segoe UI", size, style); }
        }

        private void ApplyVisualStyle()
        {
            foreach (Control control in Controls)
            {
                StyleControl(control);
            }

            statusBox.BackColor = PanelBackColor;
            statusBox.ForeColor = TextColor;
            statusBox.BorderStyle = BorderStyle.FixedSingle;
            pathLabel.ForeColor = TextColor;
            pathLabel.BackColor = Color.FromArgb(10, 19, 25);
            descriptionLabel.ForeColor = WarningColor;
            projectInfoLabel.ForeColor = MutedTextColor;
            githubLabel.ForeColor = Color.FromArgb(107, 211, 240);
            versionLabel.ForeColor = MutedTextColor;
        }

        private void StyleControl(Control control)
        {
            control.ForeColor = TextColor;
            if (control is Button)
            {
                Button button = (Button)control;
                button.FlatStyle = FlatStyle.Flat;
                button.FlatAppearance.BorderSize = 1;
                button.FlatAppearance.BorderColor = Color.FromArgb(64, 111, 132);
                button.FlatAppearance.MouseOverBackColor = Color.FromArgb(21, 55, 68);
                button.FlatAppearance.MouseDownBackColor = Color.FromArgb(19, 42, 52);
                button.BackColor = Color.FromArgb(15, 31, 40);
                button.ForeColor = TextColor;
                button.Cursor = Cursors.Hand;
                bool navigationButton =
                    Object.ReferenceEquals(button, startNavButton) ||
                    Object.ReferenceEquals(button, multiNavButton) ||
                    Object.ReferenceEquals(button, toolsNavButton);
                if (navigationButton)
                {
                    button.BackColor = Object.ReferenceEquals(button, startNavButton)
                        ? Color.FromArgb(23, 91, 111)
                        : Color.FromArgb(19, 31, 40);
                    button.FlatAppearance.BorderColor = Object.ReferenceEquals(button, startNavButton)
                        ? Color.FromArgb(130, 75, 210, 225)
                        : Color.FromArgb(48, 255, 255, 255);
                    button.FlatAppearance.MouseOverBackColor = Color.FromArgb(39, 71, 86);
                }
                else if (button.Text.IndexOf("\u542f\u52a8", StringComparison.Ordinal) >= 0 ||
                    button.Text.IndexOf("\u591a\u5f00", StringComparison.Ordinal) >= 0)
                {
                    button.BackColor = PrimaryColor;
                    button.ForeColor = Color.FromArgb(245, 252, 255);
                    button.FlatAppearance.BorderColor = PrimaryHoverColor;
                    button.FlatAppearance.MouseOverBackColor = PrimaryHoverColor;
                }
            }
            else if (control is ComboBox)
            {
                ComboBox combo = (ComboBox)control;
                combo.BackColor = FieldBackColor;
                combo.ForeColor = TextColor;
                combo.FlatStyle = FlatStyle.Flat;
                combo.DrawMode = DrawMode.OwnerDrawFixed;
                combo.ItemHeight = 22;
                combo.DrawItem += DrawComboBoxItem;
            }
            else if (control is NumericUpDown)
            {
                control.BackColor = FieldBackColor;
                control.ForeColor = TextColor;
                foreach (Control child in control.Controls)
                {
                    child.BackColor = FieldBackColor;
                    child.ForeColor = TextColor;
                }
            }
            else if (control is TextBox)
            {
                control.BackColor = FieldBackColor;
                control.ForeColor = TextColor;
            }
            else if (control is CheckBox)
            {
                CheckBox checkBox = (CheckBox)control;
                checkBox.BackColor = Color.Transparent;
                checkBox.UseVisualStyleBackColor = true;
            }
            else if (control is Label)
            {
                control.BackColor = Color.Transparent;
            }
        }

        private void DrawComboBoxItem(object sender, DrawItemEventArgs e)
        {
            if (e.Index < 0) return;
            ComboBox combo = (ComboBox)sender;
            bool selected = (e.State & DrawItemState.Selected) == DrawItemState.Selected;
            Color back = selected ? Color.FromArgb(27, 77, 72) : FieldBackColor;
            using (SolidBrush background = new SolidBrush(back))
            using (SolidBrush foreground = new SolidBrush(TextColor))
            {
                e.Graphics.FillRectangle(background, e.Bounds);
                string text = combo.GetItemText(combo.Items[e.Index]);
                e.Graphics.DrawString(text, combo.Font, foreground, e.Bounds.Left + 7, e.Bounds.Top + 3);
            }
            e.DrawFocusRectangle();
        }

        private void RefreshPresetDescription()
        {
            descriptionLabel.Text = "\u9884\u8bbe\u8bf4\u660e\uff1a" + GetPresetDescription((string)presetBox.SelectedItem);
        }

        private void RefreshAdvancedVisibility()
        {
            bool visible = advancedCheckBox.Checked;
            toolsPageVisible = visible;
            restoreButton.Visible = visible;
            shortcutButton.Visible = visible;
            factoryButton.Visible = visible;
            cleanButton.Visible = visible;
            openBackupButton.Visible = visible;
            openLogButton.Visible = visible;
            tiaoziLabel.Visible = visible;
            tiaoziScaleBox.Visible = visible;
            tiaoziApplyButton.Visible = visible;

            mainLabel.Visible = !visible;
            mainPresetBox.Visible = !visible;
            idleLabel.Visible = !visible;
            idlePresetBox.Visible = !visible;
            countLabel.Visible = !visible;
            idleCountBox.Visible = !visible;
            waitLabel.Visible = !visible;
            multiModeBox.Visible = !visible;
            settleWaitBox.Visible = !visible;
            waitUnitLabel.Visible = !visible;
            multiLaunchButton.Visible = !visible;

            if (startNavButton != null)
            {
                startNavButton.BackColor = !visible
                    ? Color.FromArgb(23, 91, 111)
                    : Color.FromArgb(19, 31, 40);
                toolsNavButton.BackColor = visible
                    ? Color.FromArgb(23, 91, 111)
                    : Color.FromArgb(19, 31, 40);
                startNavButton.Invalidate();
                toolsNavButton.Invalidate();
            }
            ApplyDynamicLayout(visible);
            Invalidate();
        }

        private void ApplyDynamicLayout(bool advancedVisible)
        {
            // The dashboard uses a fixed Windows 11 grid. Page switching changes
            // visibility only, so monitoring and log regions never jump.
        }

        private static Icon LoadWindowIcon()
        {
            string iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "assets", "app.ico");
            if (!File.Exists(iconPath)) return null;

            try
            {
                return new Icon(iconPath);
            }
            catch
            {
                return null;
            }
        }

        private void RefreshTiaoziScaleValue()
        {
            try
            {
                decimal scale = ReadTiaoziScale();
                if (scale < tiaoziScaleBox.Minimum) scale = tiaoziScaleBox.Minimum;
                if (scale > tiaoziScaleBox.Maximum) scale = tiaoziScaleBox.Maximum;
                tiaoziScaleBox.Value = scale;
            }
            catch
            {
            }
        }

        private void RefreshPathLabel()
        {
            if (IsValidGameRoot(gameRoot))
            {
                RefreshTiaoziScaleValue();
                pathLabel.Text = "\u5df2\u68c0\u6d4b\u5230\u6e38\u620f\u76ee\u5f55\uff1a" + gameRoot;
                CleanAutoBackupsQuietly();
                string launchMode = GetLaunchModeName(performanceModeCheckBox.Checked);
                string launchFile = performanceModeCheckBox.Checked ? performanceGameExe : gameExe;
                string launchState = File.Exists(launchFile) ? launchFile : "\u672a\u627e\u5230\uff1a" + launchFile;
                statusBox.Text = "\u5c31\u7eea\u3002\u542f\u52a8\u6a21\u5f0f\uff1a" + launchMode + Environment.NewLine +
                                 "\u542f\u52a8\u6587\u4ef6\uff1a" + launchState + Environment.NewLine +
                                 "\u5f53\u524d\u914d\u7f6e\uff1a" + ReadCurrentConfigSummary();
            }
            else
            {
                pathLabel.Text = "\u672a\u68c0\u6d4b\u5230\u6e38\u620f\u76ee\u5f55\uff0c\u8bf7\u624b\u52a8\u9009\u62e9 LifeAfter \u5b89\u88c5\u76ee\u5f55\u3002";
                statusBox.Text = "\u8bf7\u5148\u70b9\u51fb\u201c\u9009\u62e9\u6e38\u620f\u76ee\u5f55\u201d\u3002";
            }
        }

        private void ChooseGameRoot()
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "\u9009\u62e9 LifeAfter \u6e38\u620f\u5b89\u88c5\u76ee\u5f55\uff08\u5305\u542b lifeafter.exe \u7684\u90a3\u4e2a\u6587\u4ef6\u5939\uff09";
                dialog.ShowNewFolderButton = false;
                if (IsValidGameRoot(gameRoot)) dialog.SelectedPath = gameRoot;

                if (dialog.ShowDialog(this) == DialogResult.OK)
                {
                    if (!IsValidGameRoot(dialog.SelectedPath))
                    {
                        MessageBox.Show(this, "\u8fd9\u4e0d\u662f\u6b63\u786e\u7684 LifeAfter \u76ee\u5f55\u3002\u8bf7\u9009\u62e9\u5305\u542b lifeafter.exe \u548c Documents\\configs \u7684\u6587\u4ef6\u5939\u3002", "\u9519\u8bef", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }

                    SetGameRoot(dialog.SelectedPath);
                    SaveGameRoot(dialog.SelectedPath);
                    RefreshPathLabel();
                }
            }
        }

        private void Apply(bool launch)
        {
            try
            {
                if (IsGameRunning())
                {
                    DialogResult result = MessageBox.Show(
                        this,
                        "\u68c0\u6d4b\u5230\u6e38\u620f\u6b63\u5728\u8fd0\u884c\u3002\u5efa\u8bae\u5173\u95ed\u6e38\u620f\u540e\u518d\u5207\u6362\u753b\u8d28\u3002\u662f\u5426\u7ee7\u7eed\uff1f",
                        "\u6e38\u620f\u6b63\u5728\u8fd0\u884c",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning);
                    if (result != DialogResult.Yes) return;
                }

                statusBox.Text = ApplyPreset((string)presetBox.SelectedItem, launch, performanceModeCheckBox.Checked);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "\u9519\u8bef", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void ApplyTiaoziScaleFromUi()
        {
            try
            {
                decimal scale = tiaoziScaleBox.Value;
                if (scale < 0.5m || scale > 1.8m)
                {
                    DialogResult result = MessageBox.Show(
                        this,
                        "\u5f53\u524d\u8df3\u5b57\u7f29\u653e\u6bd4\u4f8b\u4e3a " + scale.ToString("0.0", CultureInfo.InvariantCulture) + "\uff0c\u53ef\u80fd\u4f1a\u5f71\u54cd\u6e38\u620f\u4f53\u9a8c\u3002\u5efa\u8bae\u8303\u56f4\u662f 0.5 \u5230 1.8\u3002\u662f\u5426\u7ee7\u7eed\uff1f",
                        "\u8df3\u5b57\u5927\u5c0f",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning);
                    if (result != DialogResult.Yes) return;
                }

                statusBox.Text = SetTiaoziScale(scale);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "\u9519\u8bef", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void RestoreBackupFromUi()
        {
            try
            {
                DialogResult result = MessageBox.Show(
                    this,
                    "\u786e\u5b9a\u8981\u6062\u590d\u6700\u8fd1\u4e00\u6b21\u5907\u4efd\u5417\uff1f",
                    "\u6062\u590d\u5907\u4efd",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);
                if (result != DialogResult.Yes) return;
                statusBox.Text = RestoreLatestBackup();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "\u9519\u8bef", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void MultiLaunchFromUi()
        {
            try
            {
                if (IsGameRunning())
                {
                    DialogResult runningResult = MessageBox.Show(
                        this,
                        "\u68c0\u6d4b\u5230\u6e38\u620f\u6b63\u5728\u8fd0\u884c\u3002\u7a33\u5b9a\u591a\u5f00\u5efa\u8bae\u4ece\u65e0\u6e38\u620f\u8fdb\u7a0b\u5f00\u59cb\u3002\u662f\u5426\u7ee7\u7eed\uff1f",
                        "\u6e38\u620f\u6b63\u5728\u8fd0\u884c",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Warning);
                    if (runningResult != DialogResult.Yes) return;
                }

                int idleCount = (int)idleCountBox.Value;
                int autoWaitSeconds = (int)settleWaitBox.Value;
                bool autoMode = ((string)multiModeBox.SelectedItem).IndexOf("\u81ea\u52a8", StringComparison.Ordinal) >= 0;
                string[] presets = new string[1 + idleCount];
                presets[0] = (string)mainPresetBox.SelectedItem;
                for (int i = 0; i < idleCount; i++)
                {
                    presets[i + 1] = (string)idlePresetBox.SelectedItem;
                }

                DialogResult result = MessageBox.Show(
                    this,
                    BuildMultiLaunchConfirmMessage(idleCount, autoMode, autoWaitSeconds),
                    "\u7a33\u5b9a\u591a\u5f00",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);
                if (result != DialogResult.Yes) return;

                statusBox.Text = ApplyAndLaunchSequence(
                    presets,
                    autoMode ? (Func<string, string, bool>)ConfirmNextMultiLaunchStepAutomatically : ConfirmNextMultiLaunchStep,
                    performanceModeCheckBox.Checked);
                statusBox.Text += Environment.NewLine + "\u591a\u5f00\u5b8c\u6210\uff0c\u672a\u81ea\u52a8\u56de\u5199\u4e3b\u529b\u6863\uff0c\u907f\u514d\u5f71\u54cd\u540e\u7eed\u7a97\u53e3\u8bfb\u53d6\u914d\u7f6e\u3002";
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "\u9519\u8bef", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private string BuildMultiLaunchConfirmMessage(int idleCount, bool autoMode, int autoWaitSeconds)
        {
            if (autoMode)
            {
                return "\u5c06\u542f\u52a8 1 \u4e2a\u4e3b\u529b\u7a97\u53e3\u548c " + idleCount + " \u4e2a\u6302\u673a\u7a97\u53e3\u3002\u7a0b\u5e8f\u4f1a\u5148\u5199\u5165\u5e76\u542f\u52a8\u4e3b\u529b\u6863\uff0c\u7136\u540e\u56fa\u5b9a\u7b49\u5f85 " + autoWaitSeconds + " \u79d2\uff0c\u518d\u5199\u5165\u6302\u673a\u914d\u7f6e\u5e76\u542f\u52a8\u3002\r\n\r\n\u8fd9\u662f\u5b9e\u9a8c\u81ea\u52a8\u6a21\u5f0f\uff0c\u5982\u679c\u53c8\u4e32\u6863\uff0c\u8bf7\u628a\u79d2\u6570\u8c03\u5927\u6216\u5207\u56de\u201c\u5206\u6b65\u786e\u8ba4\u201d\u3002\u662f\u5426\u7ee7\u7eed\uff1f";
            }

            return "\u5c06\u542f\u52a8 1 \u4e2a\u4e3b\u529b\u7a97\u53e3\u548c " + idleCount + " \u4e2a\u6302\u673a\u7a97\u53e3\u3002\u7a0b\u5e8f\u4f1a\u5148\u5199\u5165\u5e76\u542f\u52a8\u4e3b\u529b\u6863\uff0c\u7136\u540e\u7b49\u4f60\u786e\u8ba4\u4e3b\u529b\u7a97\u53e3\u5df2\u7ecf\u6b63\u786e\u663e\u793a\uff0c\u518d\u5199\u5165\u6302\u673a\u914d\u7f6e\u5e76\u542f\u52a8\u3002\u662f\u5426\u7ee7\u7eed\uff1f";
        }

        private bool ConfirmNextMultiLaunchStep(string currentPreset, string nextPreset)
        {
            DialogResult result = MessageBox.Show(
                this,
                "\u8bf7\u5148\u770b\u6e38\u620f\u7a97\u53e3\uff1a\u5f53\u524d\u7a97\u53e3\u5e94\u8be5\u5df2\u7ecf\u662f\u201c" + currentPreset + "\u201d\u3002\r\n\r\n\u786e\u8ba4\u5b83\u6b63\u5e38\u663e\u793a\u540e\uff0c\u70b9\u201c\u662f\u201d\uff0c\u7a0b\u5e8f\u5c06\u5199\u5165\u201c" + nextPreset + "\u201d\u5e76\u542f\u52a8\u4e0b\u4e00\u4e2a\u7a97\u53e3\u3002\r\n\r\n\u5982\u679c\u8fd8\u5728\u52a0\u8f7d\u6216\u5206\u8fa8\u7387\u4e0d\u5bf9\uff0c\u5148\u70b9\u201c\u5426\u201d\u53d6\u6d88\u3002",
                "\u786e\u8ba4\u7ee7\u7eed\u591a\u5f00",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question);
            return result == DialogResult.Yes;
        }

        private bool ConfirmNextMultiLaunchStepAutomatically(string currentPreset, string nextPreset)
        {
            int seconds = (int)settleWaitBox.Value;
            statusBox.Text += Environment.NewLine + "\u81ea\u52a8\u5012\u8ba1\u65f6\uff1a\u5df2\u542f\u52a8\u201c" + currentPreset + "\u201d\uff0c\u7b49\u5f85 " + seconds + " \u79d2\u540e\u5199\u5165\u201c" + nextPreset + "\u201d\u3002";
            statusBox.Refresh();
            Thread.Sleep(seconds * 1000);
            return true;
        }

        private void RestoreToMainPresetSilently()
        {
            try
            {
                ApplyPreset((string)mainPresetBox.SelectedItem, false);
            }
            catch { }
        }

        private void RestoreFactoryFromUi()
        {
            try
            {
                DialogResult result = MessageBox.Show(
                    this,
                    "\u786e\u5b9a\u8981\u6062\u590d\u5230\u9ed8\u8ba4 2K120 \u5417\uff1f\u5f53\u524d\u914d\u7f6e\u4f1a\u5148\u81ea\u52a8\u5907\u4efd\u3002",
                    "\u6062\u590d\u9ed8\u8ba4\u914d\u7f6e",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);
                if (result != DialogResult.Yes) return;
                statusBox.Text = RestoreFactoryDefault();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "\u9519\u8bef", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void CleanBackupsFromUi()
        {
            try
            {
                DialogResult result = MessageBox.Show(
                    this,
                    "\u786e\u5b9a\u8981\u5220\u9664\u666e\u901a\u81ea\u52a8\u5907\u4efd\u5417\uff1f\u9ed8\u8ba4 2K120 \u6062\u590d\u70b9\u4f1a\u4fdd\u7559\u3002",
                    "\u6e05\u7406\u5907\u4efd",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Warning);
                if (result != DialogResult.Yes) return;
                statusBox.Text = CleanAutoBackups();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "\u9519\u8bef", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
