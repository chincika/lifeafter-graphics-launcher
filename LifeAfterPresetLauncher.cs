using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
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

    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private static string gameRoot;
    private static string configDir;
    private static string pcConfigPath;
    private static string qualityConfigPath;
    private static string gameExe;

    private static readonly string SavedPathFile = Path.Combine(
        AppDomain.CurrentDomain.BaseDirectory,
        "LifeAfterLauncher.path");
    private const string AppVersion = "v1.5.0";
    private const string ProjectUrl = "https://github.com/chincika/lifeafter-graphics-launcher";

    private const string Pc540p =
@"{""resolution"": [960, 540], ""ignore_hint"": true, ""half_infected_keymap"": {""HANDBRAKE"": [0, 0], ""DRONE_CAST_SKILL"": [88, 0], ""SPORE_SKILL"": [74, 0], ""TOGGLE_WEAPONS"": [90, 0], ""DRONE_CONTROL_SKILL_1"": [0, 0], ""AIR_UP"": [0, 0], ""WHISTLE"": [0, 0], ""WEAPON_SKILL"": [81, 0], ""OPEN_FASHION"": [81, 1], ""ARTIFACT_STUNT"": [72, 0], ""CHANGE_POS"": [0, 0], ""AIR_DOWN"": [0, 0], ""SPORE_USE"": [16, 0], ""FAST_COLD_WEAPON"": [71, 0], ""TOGGLE_MEDICINE"": [66, 0], ""MOVE_RUN"": [87, 1], ""SWITCH_WEAPON"": [69, 0], ""PLAYER_SKILL7"": [-1, 0], ""AUTO_MOVE"": [0, 0], ""NITROGEN"": [0, 0], ""SWITCH_THROWABLE"": [188, 0]}, ""hide_tag"": false, ""pc_tutorial_showed"": true, ""full_screen"": false, ""hint_occurred"": 4, ""hint_close_PanelBulletBox"": true}";

    private const string Quality540p =
@"{""jijian_engine"": 1, ""render_2020"": 2, ""player_num"": 0.9, ""enemy_limit_num"": 35, ""friend_limit_num"": 20, ""hidden_tatic_sfx"": 0, ""hidden_flamethrower_sfx"": 0, ""hidden_diffuser_sfx"": 0, ""bloom_enhance"": 1, ""render"": 0, ""last_quality_level"": 4, ""light"": 0, ""shadow"": 0, ""plant"": 0, ""frame"": 0, ""frame_prediction"": 0, ""dynamic_shadow"": false, ""preset_mode"": -1, ""shadow_distance_scale"": 0.0, ""transparent_shadow"": false, ""lighting_rendering"": 1, ""quality"": -1, ""contrast_enhancement"": 1, ""color_grading"": 2, ""home_render_budget"": 1, ""scene_sfx_performance"": 2, ""main_player_sfx_performance"": 1, ""other_player_sfx_performance"": 2, ""fsr_postprocess"": 0, ""hidden_specific_shrub"": 0, ""dynamic_hide_bobj"": false, ""same_appear_hint"": 0, ""hide_building"": 0, ""enable_low_fps_mode"": 1, ""plant_distance_scale"": 0.0, ""volumetric_cloud"": 3, ""ambient_occlusion"": 0, ""yingguang_sen"": 1.0, ""illum_auto_switch"": 0, ""blurred_distant_view"": 0, ""surface_reflection"": 0, ""z_far"": 1.0, ""anisotropic_filter"": 2, ""global_illumination"": 1, ""self_home_bobj_show_range"": 100, ""other_home_bobj_show_range"": 30, ""anti_alias_pc"": 1, ""dynamic_pvp_rule"": 1, ""long_shadow"": 0, ""shadow_distance"": 0, ""ocean_depth"": 0, ""monster_quality_upgrade_hit_sfx"": 0}";

    private const string Quality2K120 =
@"{""jijian_engine"": 1, ""render_2020"": 2, ""player_num"": 0.9, ""enemy_limit_num"": 35, ""friend_limit_num"": 20, ""hidden_tatic_sfx"": 0, ""hidden_flamethrower_sfx"": 0, ""hidden_diffuser_sfx"": 0, ""bloom_enhance"": 1, ""render"": 4, ""last_quality_level"": 4, ""light"": 1, ""shadow"": 1, ""plant"": 1, ""frame"": 4, ""frame_prediction"": 1, ""dynamic_shadow"": false, ""preset_mode"": -1, ""shadow_distance_scale"": 0.0, ""transparent_shadow"": true, ""lighting_rendering"": 1, ""quality"": -1, ""contrast_enhancement"": 1, ""color_grading"": 2, ""home_render_budget"": 1, ""scene_sfx_performance"": 2, ""main_player_sfx_performance"": 1, ""other_player_sfx_performance"": 2, ""fsr_postprocess"": 0, ""hidden_specific_shrub"": 0, ""dynamic_hide_bobj"": false, ""same_appear_hint"": 0, ""hide_building"": 0, ""enable_low_fps_mode"": 1, ""plant_distance_scale"": 0.0, ""volumetric_cloud"": 3, ""ambient_occlusion"": 0, ""yingguang_sen"": 1.0, ""illum_auto_switch"": 0, ""blurred_distant_view"": 0, ""surface_reflection"": 0, ""z_far"": 1.0, ""anisotropic_filter"": 2, ""global_illumination"": 1, ""self_home_bobj_show_range"": 100, ""other_home_bobj_show_range"": 30, ""anti_alias_pc"": 1, ""dynamic_pvp_rule"": 1, ""long_shadow"": 0, ""shadow_distance"": 0, ""ocean_depth"": 0, ""monster_quality_upgrade_hit_sfx"": 0}";

    [STAThread]
    private static void Main(string[] args)
    {
        SetGameRoot(FindGameRoot());

        if (args.Length >= 2 && args[0].Equals("--apply", StringComparison.OrdinalIgnoreCase))
        {
            bool launch = args.Length >= 3 && args[2].Equals("--launch", StringComparison.OrdinalIgnoreCase);
            Console.WriteLine(ApplyPreset(args[1], launch));
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

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new LauncherForm());
    }

    private static void SetGameRoot(string root)
    {
        gameRoot = root;
        if (String.IsNullOrEmpty(root))
        {
            configDir = pcConfigPath = qualityConfigPath = gameExe = null;
            return;
        }

        configDir = Path.Combine(root, @"Documents\configs");
        pcConfigPath = Path.Combine(configDir, "pcconfig");
        qualityConfigPath = Path.Combine(configDir, "qualityconfig");
        gameExe = Path.Combine(root, "lifeafter.exe");
    }

    private static bool IsValidGameRoot(string root)
    {
        if (String.IsNullOrEmpty(root)) return false;
        return File.Exists(Path.Combine(root, "lifeafter.exe")) &&
               File.Exists(Path.Combine(root, @"Documents\configs\pcconfig")) &&
               File.Exists(Path.Combine(root, @"Documents\configs\qualityconfig"));
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
                Path.Combine(root, @"Netease\LifeAfter")
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
            Process.Start(new ProcessStartInfo
            {
                FileName = gameExe,
                WorkingDirectory = gameRoot,
                UseShellExecute = true
            });
            message += Environment.NewLine + "\u6e38\u620f\u5df2\u542f\u52a8\u3002";
        }

        WriteLog("ApplyPreset preset=" + preset + " launch=" + launch + " root=" + gameRoot + " summary=" + ReadCurrentConfigSummary());
        return message;
    }

    private static string ApplyAndLaunchSequence(string[] presets, Func<string, string, bool> confirmNext)
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
            builder.AppendLine(ApplyPreset(preset, true));
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

        WriteLog("MultiLaunch count=" + presets.Length + " manualConfirm=true");
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
                Color.FromArgb(210, 7, 18, 30),
                Color.FromArgb(60, 7, 18, 30),
                LinearGradientMode.Horizontal))
            {
                g.FillRectangle(shade, bounds);
            }

            using (Pen border = new Pen(Color.FromArgb(70, 255, 255, 255)))
            {
                g.DrawRectangle(border, 0, 0, bounds.Width - 1, bounds.Height - 1);
            }

            using (Font titleFont = new Font("Microsoft YaHei UI", 18F, FontStyle.Bold))
            using (Font subtitleFont = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular))
            using (Brush titleBrush = new SolidBrush(Color.White))
            using (Brush subtitleBrush = new SolidBrush(Color.FromArgb(220, 235, 242, 248)))
            {
                g.DrawString("\u660e\u65e5\u4e4b\u540e\u753b\u8d28\u542f\u52a8\u5668", titleFont, titleBrush, 24, 20);
                g.DrawString("\u516c\u76ca\u7248  /  \u591a\u5f00\u9884\u8bbe  /  \u5b89\u5168\u5907\u4efd", subtitleFont, subtitleBrush, 26, 56);
                g.DrawString(projectUrl, subtitleFont, subtitleBrush, 26, 76);
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

    private sealed class LauncherForm : Form
    {
        private const int HeaderOffset = 126;
        private static readonly Color WindowBackColor = Color.FromArgb(7, 12, 17);
        private static readonly Color PanelBackColor = Color.FromArgb(13, 24, 31);
        private static readonly Color FieldBackColor = Color.FromArgb(9, 18, 25);
        private static readonly Color PrimaryColor = Color.FromArgb(26, 149, 194);
        private static readonly Color PrimaryHoverColor = Color.FromArgb(36, 183, 226);
        private static readonly Color WarningColor = Color.FromArgb(214, 161, 78);
        private static readonly Color CardBorderColor = Color.FromArgb(53, 112, 137);
        private static readonly Color TextColor = Color.FromArgb(225, 235, 240);
        private static readonly Color MutedTextColor = Color.FromArgb(137, 159, 170);

        private readonly ComboBox presetBox = new ComboBox();
        private readonly TextBox statusBox = new TextBox();
        private readonly Label pathLabel = new Label();
        private readonly Label descriptionLabel = new Label();
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

        public LauncherForm()
        {
            Text = "\u660e\u65e5\u4e4b\u540e\u5b89\u5168\u753b\u8d28\u542f\u52a8\u5668";
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(740, 760);
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Regular);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            BackColor = WindowBackColor;
            DoubleBuffered = true;

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

            Button browseButton = new Button
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
            presetBox.Items.AddRange(new object[] { "2K 120", "1080p 120", "1080p 60", "900p 60", "720p 60", "540p 60", "540p 25" });
            presetBox.SelectedItem = "540p 25";
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

            Button applyButton = new Button
            {
                Text = "\u5e94\u7528",
                Left = 222,
                Top = 90,
                Width = 100,
                Height = 30
            };
            applyButton.Click += delegate { Apply(false); };
            Controls.Add(applyButton);

            Button launchButton = new Button
            {
                Text = "\u5e94\u7528\u5e76\u542f\u52a8",
                Left = 334,
                Top = 90,
                Width = 140,
                Height = 30
            };
            launchButton.Click += delegate { Apply(true); };
            Controls.Add(launchButton);

            Button currentButton = new Button
            {
                Text = "\u8bfb\u53d6\u5f53\u524d\u914d\u7f6e",
                Left = 486,
                Top = 90,
                Width = 145,
                Height = 30
            };
            currentButton.Click += delegate { statusBox.Text = "\u5f53\u524d\u914d\u7f6e\uff1a" + ReadCurrentConfigSummary(); };
            Controls.Add(currentButton);

            restoreButton = new Button
            {
                Text = "\u6062\u590d\u6700\u8fd1\u5907\u4efd",
                Left = 16,
                Top = 154,
                Width = 150,
                Height = 30
            };
            restoreButton.Click += delegate { RestoreBackupFromUi(); };
            Controls.Add(restoreButton);

            shortcutButton = new Button
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

            factoryButton = new Button
            {
                Text = "\u6062\u590d\u9ed8\u8ba4 2K120",
                Left = 365,
                Top = 154,
                Width = 150,
                Height = 30
            };
            factoryButton.Click += delegate { RestoreFactoryFromUi(); };
            Controls.Add(factoryButton);

            cleanButton = new Button
            {
                Text = "\u6e05\u7406\u666e\u901a\u5907\u4efd",
                Left = 527,
                Top = 154,
                Width = 140,
                Height = 30
            };
            cleanButton.Click += delegate { CleanBackupsFromUi(); };
            Controls.Add(cleanButton);

            openBackupButton = new Button
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

            openLogButton = new Button
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
            mainPresetBox.Items.AddRange(new object[] { "2K 120", "1080p 120", "1080p 60" });
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
            idleCountBox.Maximum = 8;
            idleCountBox.Value = 1;
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

            multiLaunchButton = new Button
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

            MoveControlsBelowCover();
            ApplyVisualStyle();
            RefreshPresetDescription();
            RefreshAdvancedVisibility();
            RefreshPathLabel();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            DrawTerminalBackground(g, ClientRectangle);

            DrawCard(g, new Rectangle(12, HeaderOffset + 78, 708, 64));

            if (advancedCheckBox.Checked)
            {
                DrawCard(g, new Rectangle(12, HeaderOffset + 150, 708, 76));
            }

            int multiTop = (advancedCheckBox.Checked ? 240 : 165) + HeaderOffset;
            int statusTop = (advancedCheckBox.Checked ? 315 : 245) + HeaderOffset;
            DrawCard(g, new Rectangle(12, multiTop - 16, 708, 80));
            DrawCard(g, new Rectangle(12, statusTop - 12, 708, statusBox.Height + 24));
        }

        private static void DrawCard(Graphics g, Rectangle rect)
        {
            using (GraphicsPath path = RoundedRectangle(rect, 8))
            using (SolidBrush fill = new SolidBrush(Color.FromArgb(226, 12, 24, 32)))
            using (Pen border = new Pen(CardBorderColor))
            {
                g.FillPath(fill, path);
                g.DrawPath(border, path);
            }

            using (Pen accent = new Pen(Color.FromArgb(160, 55, 190, 230), 1.4F))
            {
                int corner = 18;
                g.DrawLine(accent, rect.Left + 10, rect.Top, rect.Left + corner + 10, rect.Top);
                g.DrawLine(accent, rect.Left, rect.Top + 10, rect.Left, rect.Top + corner + 10);
                g.DrawLine(accent, rect.Right - corner - 10, rect.Top, rect.Right - 10, rect.Top);
                g.DrawLine(accent, rect.Right, rect.Top + 10, rect.Right, rect.Top + corner + 10);
            }
        }

        private static void DrawTerminalBackground(Graphics g, Rectangle bounds)
        {
            using (LinearGradientBrush back = new LinearGradientBrush(
                bounds,
                Color.FromArgb(5, 11, 16),
                Color.FromArgb(17, 30, 37),
                LinearGradientMode.ForwardDiagonal))
            {
                g.FillRectangle(back, bounds);
            }

            using (Pen grid = new Pen(Color.FromArgb(25, 56, 140, 160), 1F))
            {
                for (int x = 0; x < bounds.Width; x += 36)
                {
                    g.DrawLine(grid, x, 0, x, bounds.Height);
                }
                for (int y = 0; y < bounds.Height; y += 36)
                {
                    g.DrawLine(grid, 0, y, bounds.Width, y);
                }
            }

            using (Pen scan = new Pen(Color.FromArgb(16, 255, 255, 255), 1F))
            {
                for (int y = 0; y < bounds.Height; y += 4)
                {
                    g.DrawLine(scan, 0, y, bounds.Width, y);
                }
            }

            using (SolidBrush glow = new SolidBrush(Color.FromArgb(35, 28, 160, 205)))
            {
                g.FillEllipse(glow, bounds.Right - 180, 120, 260, 260);
                g.FillEllipse(glow, -120, bounds.Bottom - 180, 250, 220);
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

        private void MoveControlsBelowCover()
        {
            foreach (Control control in Controls)
            {
                if (control is CoverPanel) continue;
                control.Top += HeaderOffset;
            }
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
                if (button.Text.IndexOf("\u542f\u52a8", StringComparison.Ordinal) >= 0 ||
                    button.Text.IndexOf("\u591a\u5f00", StringComparison.Ordinal) >= 0)
                {
                    button.BackColor = PrimaryColor;
                    button.ForeColor = Color.FromArgb(245, 252, 255);
                    button.FlatAppearance.BorderColor = PrimaryHoverColor;
                    button.FlatAppearance.MouseOverBackColor = PrimaryHoverColor;
                }
            }
            else if (control is ComboBox || control is NumericUpDown || control is TextBox)
            {
                control.BackColor = FieldBackColor;
                control.ForeColor = TextColor;
            }
            else if (control is Label || control is CheckBox)
            {
                control.BackColor = Color.Transparent;
            }
        }

        private void RefreshPresetDescription()
        {
            descriptionLabel.Text = "\u9884\u8bbe\u8bf4\u660e\uff1a" + GetPresetDescription((string)presetBox.SelectedItem);
        }

        private void RefreshAdvancedVisibility()
        {
            bool visible = advancedCheckBox.Checked;
            restoreButton.Visible = visible;
            shortcutButton.Visible = visible;
            factoryButton.Visible = visible;
            cleanButton.Visible = visible;
            openBackupButton.Visible = visible;
            openLogButton.Visible = visible;
            ApplyDynamicLayout(visible);
            Invalidate();
        }

        private void ApplyDynamicLayout(bool advancedVisible)
        {
            int multiTop = (advancedVisible ? 240 : 165) + HeaderOffset;
            int waitTop = multiTop + 34;
            int statusTop = (advancedVisible ? 315 : 245) + HeaderOffset;
            int statusHeight = advancedVisible ? 190 : 260;
            int versionTop = 525 + HeaderOffset;

            multiLabel.Top = multiTop;
            mainLabel.Top = multiTop;
            idleLabel.Top = multiTop;
            countLabel.Top = multiTop;
            mainPresetBox.Top = multiTop - 4;
            idlePresetBox.Top = multiTop - 4;
            idleCountBox.Top = multiTop - 4;
            multiLaunchButton.Top = multiTop - 6;
            waitLabel.Top = waitTop;
            multiModeBox.Top = waitTop - 4;
            settleWaitBox.Top = waitTop - 4;
            waitUnitLabel.Top = waitTop;

            statusBox.Top = statusTop;
            statusBox.Height = statusHeight;
            versionLabel.Top = versionTop + 20;
            projectInfoLabel.Top = versionTop;
            githubLabel.Top = versionTop + 20;
        }

        private void RefreshPathLabel()
        {
            if (IsValidGameRoot(gameRoot))
            {
                pathLabel.Text = "\u5df2\u68c0\u6d4b\u5230\u6e38\u620f\u76ee\u5f55\uff1a" + gameRoot;
                CleanAutoBackupsQuietly();
                statusBox.Text = "\u5c31\u7eea\u3002\u5f53\u524d\u914d\u7f6e\uff1a" + ReadCurrentConfigSummary();
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

                statusBox.Text = ApplyPreset((string)presetBox.SelectedItem, launch);
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
                    autoMode ? (Func<string, string, bool>)ConfirmNextMultiLaunchStepAutomatically : ConfirmNextMultiLaunchStep);
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
