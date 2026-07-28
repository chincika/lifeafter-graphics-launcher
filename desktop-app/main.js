const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  shell,
  Tray
} = require('electron');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const {
  GameInstallationsStore,
  discoverInstallations,
  inspectInstallation
} = require('./game-installations-store');
const { HistoryStore } = require('./history-store');
const { LanStatusServer } = require('./lan-status-server');
const { MonitorService } = require('./monitor-service');
const { SettingsStore } = require('./settings-store');
const {
  UpdateService,
  cleanupUpdateCache,
  schedulePortableReplacement,
  shouldCheckForUpdates
} = require('./update-service');

const execFileAsync = promisify(execFile);
const cpuHistory = new Map();
let gameInstallationsStore = null;
let historyStore = null;
let settingsStore = null;
let monitorService = null;
let lanServer = null;
let updateService = null;
let updateCheckInFlight = null;
let pendingUpdate = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let cachedQrUrl = '';
let cachedQrDataUrl = '';
const isRuntimeSmoke = process.argv.includes('--runtime-smoke');
if (isRuntimeSmoke && process.env.LAUNCHER_SMOKE_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.LAUNCHER_SMOKE_USER_DATA));
}
app.disableHardwareAcceleration();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

function backendDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'backend')
    : path.join(__dirname, 'backend');
}

function backendPath() {
  return path.join(backendDir(), 'LifeAfterBackend.exe');
}

function fpsCorePath() {
  return path.join(backendDir(), 'LifeAfterFrameCore.exe');
}

function verifyFpsCoreIntegrity() {
  const expected = require('./frame-core-integrity.json').sha256;
  const actual = crypto.createHash('sha256')
    .update(fs.readFileSync(fpsCorePath()))
    .digest('hex')
    .toUpperCase();
  const left = Buffer.from(String(expected || '').toUpperCase(), 'utf8');
  const right = Buffer.from(actual, 'utf8');
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new Error('帧率核心完整性校验失败，请从官方发布页重新下载启动器');
  }
}

function savedRootPath() {
  return path.join(backendDir(), 'LifeAfterLauncher.path');
}

function persistentRootPath() {
  return path.join(app.getPath('userData'), 'game-root.txt');
}

function fpsPreferencePath() {
  return path.join(app.getPath('userData'), 'fps-unlock-preference.json');
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'background-settings.json');
}

function installationsPath() {
  return path.join(app.getPath('userData'), 'game-installations.json');
}

function readFpsPreference() {
  try {
    const value = Number(JSON.parse(fs.readFileSync(fpsPreferencePath(), 'utf8')).target);
    if ([120, 180, 240, 300].includes(value)) return value;
  } catch {
  }
  return 180;
}

function saveFpsPreference(target) {
  const value = Number(target);
  if (![120, 180, 240, 300].includes(value)) return false;
  fs.mkdirSync(path.dirname(fpsPreferencePath()), { recursive: true });
  fs.writeFileSync(fpsPreferencePath(), JSON.stringify({ target: value }, null, 2), 'utf8');
  return true;
}

function readSavedRoot() {
  const activeRoot = gameInstallationsStore?.data?.activeRoot;
  if (activeRoot) return activeRoot;
  try {
    const persistent = fs.readFileSync(persistentRootPath(), 'utf8').trim();
    if (persistent) return persistent;
  } catch {
  }
  try {
    return fs.readFileSync(savedRootPath(), 'utf8').trim();
  } catch {
    return '';
  }
}

function launchModeState(root = readSavedRoot()) {
  const gameRoot = String(root || '').trim();
  const folderName = gameRoot ? path.basename(gameRoot).toLocaleLowerCase('en-US') : '';
  const fever = Boolean(gameRoot) &&
    fs.existsSync(path.join(gameRoot, 'mingrizhihou.exe')) &&
    (
      folderName === 'mrzh' ||
      fs.existsSync(path.join(gameRoot, 'FeverGamesLauncher.exe')) ||
      !fs.existsSync(path.join(gameRoot, 'lifeafter.exe'))
    );
  return {
    standardAvailable: Boolean(gameRoot) && (
      fs.existsSync(path.join(gameRoot, 'lifeafter.exe')) || fever
    ),
    performanceAvailable: Boolean(gameRoot) &&
      fs.existsSync(path.join(gameRoot, 'Documents', 'bin', 'x64-3', 'lifeafter.exe')),
    performanceRoute: 'Documents\\bin\\x64-3\\lifeafter.exe',
    platformId: fever ? 'fever' : 'netease',
    platformLabel: fever ? '发烧平台包体' : '老PC包体'
  };
}

function persistActiveRoot(root, source = 'manual') {
  const normalized = inspectInstallation(root).root;
  fs.mkdirSync(path.dirname(persistentRootPath()), { recursive: true });
  fs.writeFileSync(persistentRootPath(), normalized, 'utf8');
  gameInstallationsStore?.setActive(normalized, source);
  return normalized;
}

function installationSnapshot(scan = null) {
  return gameInstallationsStore?.snapshot(scan) || {
    activeRoot: readSavedRoot(),
    installations: [],
    scan
  };
}

function publicUpdateState() {
  const settings = settingsStore?.get() || {};
  return {
    ...(updateService?.publicState() || {
      phase: 'idle',
      currentVersion: app.getVersion(),
      latestVersion: '',
      progress: 0,
      message: '尚未检查更新',
      releaseUrl: '',
      downloadedPath: '',
      error: ''
    }),
    frequency: settings.updateFrequency || 'startup',
    lastCheckedAt: Number(settings.lastUpdateCheckAt) || 0,
    automaticInstallSupported: Boolean(app.isPackaged && process.env.PORTABLE_EXECUTABLE_FILE)
  };
}

function broadcastUpdateState() {
  broadcast('launcher:update-state', publicUpdateState());
}

function installPendingUpdate() {
  if (!pendingUpdate || isRuntimeSmoke) return { ok: false, deferred: true };
  if (monitorService?.getSnapshot().instances.length) {
    updateService.updateState({
      phase: 'ready',
      progress: 100,
      message: `v${pendingUpdate.latestVersion} 已下载，将在游戏退出后自动更新`
    });
    return { ok: true, deferred: true };
  }
  const scheduled = schedulePortableReplacement({
    downloadedPath: pendingUpdate.downloadedPath,
    expectedDigest: pendingUpdate.expectedDigest,
    portablePath: process.env.PORTABLE_EXECUTABLE_FILE,
    currentPid: process.pid,
    scriptDir: path.join(app.getPath('userData'), 'updates')
  });
  if (!scheduled.ok) {
    updateService.updateState({
      phase: 'error',
      message: '无法自动替换当前版本',
      error: scheduled.error
    });
    return scheduled;
  }
  updateService.updateState({
    phase: 'installing',
    progress: 100,
    message: `正在安装 v${pendingUpdate.latestVersion}，启动器即将重启…`
  });
  pendingUpdate = null;
  setTimeout(() => {
    quitApplication().catch(() => {
      isQuitting = true;
      app.quit();
    });
  }, 500);
  return { ok: true, scheduled: true };
}

async function checkForUpdates({ manual = false } = {}) {
  if (updateCheckInFlight) return updateCheckInFlight;
  updateCheckInFlight = (async () => {
    const checked = await updateService.check();
    settingsStore.update({ lastUpdateCheckAt: Date.now() });
    broadcastUpdateState();
    if (!checked.ok || !checked.updateAvailable) {
      return { ...checked, data: publicUpdateState() };
    }
    if (!app.isPackaged || !process.env.PORTABLE_EXECUTABLE_FILE) {
      updateService.updateState({
        phase: 'available',
        message: `发现 v${String(checked.release.tag_name).replace(/^v/i, '')}；便携版打包后可自动安装`
      });
      return { ok: true, updateAvailable: true, data: publicUpdateState() };
    }
    const latestVersion = String(checked.release.tag_name).replace(/^v/i, '');
    const downloaded = await updateService.download(
      checked.asset,
      checked.expectedDigest,
      latestVersion
    );
    if (!downloaded.ok) return { ...downloaded, data: publicUpdateState() };
    pendingUpdate = {
      latestVersion,
      downloadedPath: downloaded.path,
      expectedDigest: downloaded.digest
    };
    const install = installPendingUpdate();
    return {
      ok: install.ok,
      updateAvailable: true,
      scheduled: install.scheduled === true,
      deferred: install.deferred === true,
      error: install.error,
      data: publicUpdateState()
    };
  })();
  try {
    return await updateCheckInFlight;
  } finally {
    updateCheckInFlight = null;
  }
}

async function activateGameRoot(root, source = 'manual') {
  const info = inspectInstallation(root);
  if (!info.valid) {
    return {
      ok: false,
      error: '所选目录不是有效的游戏包体。请选择包含游戏程序和 Documents\\configs 的目录。'
    };
  }
  const result = await runBackend(['--set-root', info.root], 10000);
  if (!result.ok) return result;
  const normalized = persistActiveRoot(info.root, source);
  const [summary, fpsStatus] = await Promise.all([
    runBackend(['--read-summary'], 10000),
    getFpsStatus()
  ]);
  return {
    ok: true,
    root: normalized,
    installation: inspectInstallation(normalized),
    installations: installationSnapshot(),
    launchMode: launchModeState(normalized),
    summary: summary.ok ? summary.text : '',
    fpsStatus: fpsStatus.ok ? fpsStatus.data : { ok: false, error: fpsStatus.error }
  };
}

async function runBackend(args, timeout = 30000) {
  try {
    const { stdout, stderr } = await execFileAsync(backendPath(), args, {
      windowsHide: true,
      timeout,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 4,
      env: {
        ...process.env,
        LIFEAFTER_PROTECTED_BACKUP_ROOT: path.join(
          app.getPath('userData'),
          'protected-backups'
        )
      }
    });
    return { ok: true, text: (stdout || '').trim(), stderr: (stderr || '').trim() };
  } catch (error) {
    const detail = [
      error.stdout,
      error.stderr,
      error.message
    ].filter(Boolean).join('\n').trim();
    return { ok: false, error: detail || '后台操作失败' };
  }
}

async function runFpsCore(command, options = [], timeout = 300000) {
  const root = readSavedRoot();
  if (!root) return { ok: false, error: '请先选择游戏目录' };
  try {
    verifyFpsCoreIntegrity();
    const { stdout, stderr } = await execFileAsync(
      fpsCorePath(),
      [command, '--root', root, ...options],
      {
        windowsHide: true,
        timeout,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 4,
        env: {
          ...process.env,
          LIFEAFTER_PROTECTED_BACKUP_ROOT: path.join(
            app.getPath('userData'),
            'protected-backups'
          )
        }
      }
    );
    return { ok: true, text: (stdout || '').trim(), stderr: (stderr || '').trim() };
  } catch (error) {
    const detail = [
      error.stdout,
      error.stderr,
      error.message
    ].filter(Boolean).join('\n').trim();
    return { ok: false, error: detail || '帧率核心操作失败' };
  }
}

function computeCpu(payload) {
  const capturedAt = Number(payload.capturedAt) || Date.now();
  const active = new Set();
  const cpuCount = Math.max(1, os.cpus().length);
  for (const item of payload.instances || []) {
    active.add(item.pid);
    const previous = cpuHistory.get(item.pid);
    let cpu = 0;
    if (previous) {
      const elapsed = capturedAt - previous.capturedAt;
      const used = Number(item.totalCpuMs) - previous.totalCpuMs;
      if (elapsed > 0 && used >= 0) {
        cpu = Math.min(100, Math.max(0, used / elapsed / cpuCount * 100));
      }
    }
    item.cpuPercent = cpu;
    cpuHistory.set(item.pid, {
      totalCpuMs: Number(item.totalCpuMs) || 0,
      capturedAt
    });
  }
  for (const pid of cpuHistory.keys()) {
    if (!active.has(pid)) cpuHistory.delete(pid);
  }
  return payload;
}

async function captureInstances() {
  const result = await runBackend(['--instances-json'], 10000);
  if (!result.ok) return result;
  try {
    const data = computeCpu(JSON.parse(result.text));
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: `实例数据解析失败：${error.message}` };
  }
}

function publicSnapshot(snapshot = monitorService?.getSnapshot()) {
  const source = snapshot || { capturedAt: Date.now(), instances: [] };
  return {
    appVersion: app.getVersion(),
    generatedAt: Date.now(),
    capturedAt: Number(source.capturedAt) || Date.now(),
    fpsTakeoverTarget: readFpsPreference(),
    instances: (source.instances || []).map(item => ({
      pid: Number(item.pid) || 0,
      name: String(item.name || ''),
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      cpuPercent: Math.max(0, Number(item.cpuPercent) || 0),
      workingSetBytes: Math.max(0, Number(item.workingSetBytes) || 0),
      runningSeconds: Math.max(0, Number(item.runningSeconds) || 0)
    }))
  };
}

function publicHistory(range) {
  const data = historyStore?.aggregate(range) || {
    range,
    generatedAt: Date.now(),
    totalDurationMs: 0,
    launchCount: 0,
    averageDurationMs: 0,
    mostUsedAccount: '暂无',
    mostUsedShare: 0,
    accounts: [],
    recent: []
  };
  const { dataDir: _dataDir, ...safe } = data;
  return safe;
}

async function getFpsStatus() {
  const result = await runFpsCore('status', [], 120000);
  if (!result.ok) return result;
  try {
    const data = JSON.parse(result.text);
    return data.ok ? { ok: true, data } : { ok: false, error: data.error || '帧率包体状态不可用' };
  } catch (error) {
    return { ok: false, error: `帧率状态解析失败：${error.message}` };
  }
}

function broadcast(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function formatTrayDuration(totalSeconds) {
  const totalMinutes = Math.max(0, Math.floor((Number(totalSeconds) || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}小时${minutes}分` : `${minutes}分钟`;
}

async function setLanEnabled(enabled) {
  const value = Boolean(enabled);
  if (!value) {
    settingsStore.update({ lanEnabled: false });
    await lanServer.stop();
    updateTrayMenu();
    return { ok: true, data: await backgroundState() };
  }
  settingsStore.update({ lanEnabled: true });
  const result = await lanServer.start();
  if (!result.ok) {
    settingsStore.update({ lanEnabled: false });
    return result;
  }
  updateTrayMenu();
  return { ok: true, data: await backgroundState() };
}

async function backgroundState() {
  const settings = settingsStore?.get() || {};
  const server = lanServer?.publicState() || {
    enabled: false,
    running: false,
    devices: [],
    clientCount: 0
  };
  let qrDataUrl = '';
  if (server.url) {
    if (cachedQrUrl === server.url && cachedQrDataUrl) {
      qrDataUrl = cachedQrDataUrl;
    } else {
      try {
        const QRCode = require('qrcode');
        qrDataUrl = await QRCode.toDataURL(server.url, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 280,
          color: { dark: '#14343d', light: '#e7f4f3' }
        });
        cachedQrUrl = server.url;
        cachedQrDataUrl = qrDataUrl;
      } catch {
      }
    }
  }
  return {
    minimizeToTray: settings.minimizeToTray !== false,
    autoStart: settings.autoStart === true,
    monitor: {
      visible: Boolean(monitorService?.visible),
      remoteClientCount: Number(monitorService?.remoteClientCount) || 0,
      intervalMs: monitorService?.intervalMs() || 15000,
      instanceCount: monitorService?.getSnapshot().instances.length || 0
    },
    server,
    qrDataUrl
  };
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const snapshot = monitorService?.getSnapshot() || { instances: [] };
  const instances = snapshot.instances || [];
  const status = instances.length
    ? `${instances.length} 个游戏实例运行中`
    : '当前没有运行中的游戏';
  const detail = instances.length
    ? instances.slice(0, 2).map(item =>
      `${item.name || `PID ${item.pid}`} ${formatTrayDuration(item.runningSeconds)}`).join(' · ')
    : '后台守护正在等待游戏';
  tray.setToolTip(`明日之后画质启动器\n${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: status,
      enabled: false
    },
    {
      label: detail,
      enabled: false
    },
    { type: 'separator' },
    {
      label: '打开控制中心',
      click: () => createWindow()
    },
    {
      label: '打开远端状态页',
      enabled: Boolean(lanServer?.publicState().running),
      click: () => {
        const url = lanServer?.publicState().url;
        if (url) shell.openExternal(url);
      }
    },
    {
      label: '局域网只读访问',
      type: 'checkbox',
      checked: Boolean(settingsStore?.get().lanEnabled),
      click: item => {
        setLanEnabled(item.checked).then(result => {
          if (!result.ok) {
            tray.displayBalloon?.({
              iconType: 'error',
              title: '局域网访问启动失败',
              content: result.error
            });
          }
          updateTrayMenu();
        });
      }
    },
    { type: 'separator' },
    {
      label: '退出并停止记录',
      click: () => quitApplication()
    }
  ]));
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const iconPath = path.join(__dirname, 'renderer', 'assets', 'app-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) icon = icon.resize({ width: 20, height: 20, quality: 'best' });
  tray = new Tray(icon);
  tray.on('click', () => createWindow());
  tray.on('double-click', () => createWindow());
  updateTrayMenu();
  return tray;
}

function hideWindowToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const win = mainWindow;
  mainWindow = null;
  monitorService?.setVisible(false);
  win.destroy();
  const settings = settingsStore.get();
  if (!settings.trayTipShown && tray && !tray.isDestroyed()) {
    tray.displayBalloon?.({
      iconType: 'info',
      title: '启动器已在后台运行',
      content: '游戏时长会继续记录。点击托盘图标可重新打开控制中心。'
    });
    settingsStore.update({ trayTipShown: true });
  }
  updateTrayMenu();
}

function applyAutoStart(enabled) {
  const executablePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: executablePath,
    args: ['--background']
  });
}

async function quitApplication() {
  if (isQuitting) return;
  isQuitting = true;
  historyStore?.syncInstances([], Date.now());
  try {
    historyStore?.flush();
  } catch {
  }
  await monitorService?.stop();
  await lanServer?.stop();
  tray?.destroy();
  app.quit();
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    monitorService?.setVisible(true);
    return mainWindow;
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#0b151d',
    backgroundMaterial: 'mica',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0b151d',
      symbolColor: '#d8e4e8',
      height: 52
    },
    icon: path.join(__dirname, 'renderer', 'assets', 'app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow = win;
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    if (isRuntimeSmoke) return;
    win.show();
    monitorService?.setVisible(true);
  });
  win.on('minimize', event => {
    event.preventDefault();
    hideWindowToTray();
  });
  win.on('close', event => {
    if (isQuitting) return;
    if (settingsStore.get().minimizeToTray) {
      event.preventDefault();
      hideWindowToTray();
      return;
    }
    event.preventDefault();
    quitApplication();
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    monitorService?.setVisible(false);
  });
  return win;
}

ipcMain.handle('launcher:init', async () => {
  const persistedRoot = readSavedRoot();
  const startupScan = discoverInstallations({
    knownRoots: [persistedRoot],
    maxDepth: 2
  });
  gameInstallationsStore.merge(startupScan.installations);
  let selectedRoot = persistedRoot;
  if (!inspectInstallation(selectedRoot).valid) {
    selectedRoot = gameInstallationsStore.list().find(item => item.valid)?.root || '';
  }
  if (selectedRoot) {
    const selectedRecord = gameInstallationsStore.list()
      .find(item => item.root.toLocaleLowerCase('en-US') === selectedRoot.toLocaleLowerCase('en-US'));
    await runBackend(['--set-root', selectedRoot], 10000);
    persistActiveRoot(selectedRoot, selectedRecord?.source || 'auto');
  }
  const [rootResult, summary, instances, fpsStatus, background] = await Promise.all([
    runBackend(['--get-root'], 10000),
    runBackend(['--read-summary'], 10000),
    monitorService.refreshNow(),
    getFpsStatus(),
    backgroundState()
  ]);
  const detectedRoot = rootResult.ok ? rootResult.text : persistedRoot;
  if (detectedRoot) {
    persistActiveRoot(detectedRoot, 'auto');
  }
  return {
    ok: true,
    root: detectedRoot,
    summary: summary.ok ? summary.text : '未找到游戏目录',
    instances: instances.ok ? instances.data : { instances: [] },
    fpsStatus: fpsStatus.ok ? fpsStatus.data : { ok: false, error: fpsStatus.error },
    fpsTargetPreference: readFpsPreference(),
    performanceMode: settingsStore.get().performanceMode,
    historyEnabled: settingsStore.get().historyEnabled,
    launchMode: launchModeState(detectedRoot),
    installations: installationSnapshot({
      drives: startupScan.drives,
      checkedCount: startupScan.checkedCount,
      foundCount: startupScan.installations.length,
      completedAt: Date.now()
    }),
    update: publicUpdateState(),
    background
  };
});

ipcMain.handle('launcher:choose-root', async () => {
  const selected = await dialog.showOpenDialog({
    title: '添加明日之后游戏目录',
    properties: ['openDirectory']
  });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
  return activateGameRoot(selected.filePaths[0], 'manual');
});

ipcMain.handle('launcher:scan-roots', async () => {
  const knownRoots = gameInstallationsStore.list().map(item => item.root);
  const scan = discoverInstallations({ knownRoots, maxDepth: 3 });
  gameInstallationsStore.merge(scan.installations);
  return {
    ok: true,
    data: installationSnapshot({
      drives: scan.drives,
      checkedCount: scan.checkedCount,
      foundCount: scan.installations.length,
      completedAt: Date.now()
    })
  };
});

ipcMain.handle('launcher:switch-root', (_event, root) =>
  activateGameRoot(root, 'auto'));

ipcMain.handle('launcher:remove-root', (_event, root) => {
  if (!gameInstallationsStore.remove(root)) {
    return { ok: false, error: '当前正在使用的包体不能从列表中移除。' };
  }
  return { ok: true, data: installationSnapshot() };
});

ipcMain.handle('launcher:apply-preset', async (_event, payload) => {
  const args = ['--apply', String(payload.preset || '')];
  if (payload.launch) {
    args.push('--launch');
    if (payload.performanceMode === true) {
      const mode = launchModeState();
      if (!mode.performanceAvailable) {
        return {
          ok: false,
          error: `性能启动文件不存在：${mode.performanceRoute}。请修复游戏文件或关闭“性能优先”。`
        };
      }
      args.push('--performance');
    }
  }
  return runBackend(args, 60000);
});

ipcMain.handle('launcher:set-performance-mode', (_event, enabled) => {
  const value = enabled === true;
  if (value && !launchModeState().performanceAvailable) {
    return { ok: false, error: '当前游戏包体未检测到 x64-3 性能启动通道' };
  }
  settingsStore.update({ performanceMode: value });
  return { ok: true, value, launchMode: launchModeState() };
});

ipcMain.handle('launcher:read-summary', () => runBackend(['--read-summary'], 10000));
ipcMain.handle('launcher:get-instances', () => monitorService.refreshNow());
ipcMain.handle('launcher:restore-latest', () => runBackend(['--restore-latest'], 20000));
ipcMain.handle('launcher:restore-factory', () => runBackend(['--restore-factory'], 20000));
ipcMain.handle('launcher:clean-backups', () => runBackend(['--clean-backups'], 20000));
ipcMain.handle('launcher:set-tiaozi', (_event, scale) =>
  runBackend(['--set-tiaozi', String(scale)], 20000));
ipcMain.handle('launcher:get-fps-status', () => getFpsStatus());
ipcMain.handle('launcher:save-fps-target', (_event, target) => ({
  ok: saveFpsPreference(target)
}));
ipcMain.handle('launcher:apply-fps', async (_event, target) => {
  const value = Number(target);
  if (![180, 240, 300].includes(value)) return { ok: false, error: '不支持的帧率目标' };
  const result = await runFpsCore('apply', ['--target', String(value)], 300000);
  if (result.ok) saveFpsPreference(value);
  return result;
});
ipcMain.handle('launcher:restore-fps', async () => {
  const result = await runFpsCore('restore', [], 300000);
  if (result.ok) saveFpsPreference(120);
  return result;
});
ipcMain.handle('launcher:clean-fps-backups', () =>
  runFpsCore('clean', [], 300000));

ipcMain.handle('launcher:open-backups', async () => {
  const root = readSavedRoot();
  if (!root) return { ok: false, error: '请先选择游戏目录' };
  const target = path.join(root, 'Documents', 'configs', 'profile_backups');
  fs.mkdirSync(target, { recursive: true });
  const error = await shell.openPath(target);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('launcher:open-log', async () => {
  const root = readSavedRoot();
  if (!root) return { ok: false, error: '请先选择游戏目录' };
  const target = path.join(root, 'Documents', 'configs', 'launcher_data', 'LifeAfterLauncher.log');
  if (!fs.existsSync(target)) return { ok: false, error: '日志文件尚未生成' };
  const error = await shell.openPath(target);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('launcher:get-history', (_event, range) => {
  if (!historyStore) return { ok: false, error: '启动记录尚未就绪' };
  return { ok: true, data: historyStore.aggregate(range) };
});

ipcMain.handle('launcher:export-history', async (_event, range) => {
  if (!historyStore) return { ok: false, error: '启动记录尚未就绪' };
  const labels = { day: '日', week: '周', month: '月', total: '总' };
  const date = new Date().toISOString().slice(0, 10);
  const selected = await dialog.showSaveDialog({
    title: '导出启动记录',
    defaultPath: `启动记录-${labels[range] || '总'}-${date}.csv`,
    filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
  });
  if (selected.canceled || !selected.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(selected.filePath, historyStore.exportCsv(range), 'utf8');
  return { ok: true, path: selected.filePath };
});

ipcMain.handle('launcher:open-history-folder', async () => {
  if (!historyStore) return { ok: false, error: '启动记录尚未就绪' };
  fs.mkdirSync(historyStore.dataDir, { recursive: true });
  const error = await shell.openPath(historyStore.dataDir);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('launcher:set-history-enabled', async (_event, enabled) => {
  const value = enabled === true;
  settingsStore.update({ historyEnabled: value });
  monitorService.setHistoryEnabled(value);
  if (value) await monitorService.refreshNow();
  return { ok: true, value };
});

ipcMain.handle('launcher:get-update-state', () => ({
  ok: true,
  data: publicUpdateState()
}));

ipcMain.handle('launcher:set-update-frequency', (_event, frequency) => {
  const value = String(frequency || '');
  if (!['startup', 'daily', 'weekly', 'monthly'].includes(value)) {
    return { ok: false, error: '不支持的更新检查频率。' };
  }
  settingsStore.update({ updateFrequency: value });
  broadcastUpdateState();
  return { ok: true, data: publicUpdateState() };
});

ipcMain.handle('launcher:check-for-updates', () =>
  checkForUpdates({ manual: true }));

ipcMain.handle('launcher:get-background-state', () => backgroundState());

ipcMain.handle('launcher:set-background-option', async (_event, payload) => {
  const key = String(payload?.key || '');
  const value = Boolean(payload?.value);
  if (key === 'minimizeToTray') {
    settingsStore.update({ minimizeToTray: value });
    return { ok: true, data: await backgroundState() };
  }
  if (key === 'autoStart') {
    try {
      applyAutoStart(value);
      settingsStore.update({ autoStart: value });
      return { ok: true, data: await backgroundState() };
    } catch (error) {
      return { ok: false, error: `无法更新开机启动：${error.message}` };
    }
  }
  if (key === 'lanEnabled') return setLanEnabled(value);
  return { ok: false, error: '不支持的后台设置' };
});

ipcMain.handle('launcher:rotate-pairing-code', async () => {
  if (!lanServer?.publicState().running) return { ok: false, error: '局域网服务尚未开启' };
  lanServer.rotatePairingCode();
  return { ok: true, data: await backgroundState() };
});

ipcMain.handle('launcher:revoke-remote-device', async (_event, id) => {
  if (!lanServer?.revokeDevice(String(id || ''))) {
    return { ok: false, error: '没有找到该授权设备' };
  }
  return { ok: true, data: await backgroundState() };
});

ipcMain.handle('launcher:revoke-all-remote-devices', async () => {
  lanServer?.revokeAllDevices();
  return { ok: true, data: await backgroundState() };
});

ipcMain.handle('launcher:open-remote-page', async () => {
  const url = lanServer?.publicState().url;
  if (!url) return { ok: false, error: '局域网服务尚未开启' };
  await shell.openExternal(url);
  return { ok: true, url };
});

ipcMain.handle('launcher:copy-text', (_event, value) => {
  clipboard.writeText(String(value || ''));
  return { ok: true };
});

ipcMain.handle('launcher:open-fps-backups', async () => {
  const root = readSavedRoot();
  if (!root) return { ok: false, error: '请先选择游戏目录' };
  const target = path.join(root, 'Documents', 'fps_unlock_backups');
  fs.mkdirSync(target, { recursive: true });
  const error = await shell.openPath(target);
  return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('launcher:open-fps-protected-backups', async () => {
  const target = path.join(app.getPath('userData'), 'protected-backups');
  fs.mkdirSync(target, { recursive: true });
  const error = await shell.openPath(target);
  return error ? { ok: false, error } : { ok: true };
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  gameInstallationsStore = new GameInstallationsStore(installationsPath());
  settingsStore = new SettingsStore(settingsPath());
  cleanupUpdateCache(app.getPath('userData'), app.getVersion());
  updateService = new UpdateService({
    currentVersion: app.getVersion(),
    repo: 'chincika/lifeafter-graphics-launcher',
    dataDir: app.getPath('userData'),
    fetchImpl: (...args) => net.fetch(...args),
    onStateChanged: broadcastUpdateState
  });
  historyStore = new HistoryStore(path.join(app.getPath('userData'), 'history'));
  monitorService = new MonitorService({
    capture: captureInstances,
    historyStore,
    historyEnabled: settingsStore.get().historyEnabled
  });
  lanServer = new LanStatusServer({
    settingsStore,
    staticDir: path.join(__dirname, 'renderer', 'remote'),
    statusProvider: publicSnapshot,
    historyProvider: publicHistory,
    onClientCountChanged: count => monitorService.setRemoteClientCount(count),
    onStateChanged: () => {
      backgroundState().then(state => broadcast('launcher:background-updated', state));
      updateTrayMenu();
    }
  });
  monitorService.on('snapshot', snapshot => {
    broadcast('launcher:instances-updated', snapshot);
    lanServer.pushSnapshot(snapshot);
    updateTrayMenu();
    if (pendingUpdate && !snapshot.instances.length) installPendingUpdate();
  });
  monitorService.start();
  if (!isRuntimeSmoke) {
    createTray();
    applyAutoStart(settingsStore.get().autoStart);
  }

  if (!isRuntimeSmoke && settingsStore.get().lanEnabled) {
    const result = await lanServer.start();
    if (!result.ok) settingsStore.update({ lanEnabled: false });
  }

  if (!process.argv.includes('--background') || isRuntimeSmoke) createWindow();
  const updateSettings = settingsStore.get();
  if (
    !isRuntimeSmoke &&
    app.isPackaged &&
    shouldCheckForUpdates(
      updateSettings.updateFrequency,
      updateSettings.lastUpdateCheckAt
    )
  ) {
    setTimeout(() => checkForUpdates({ manual: false }), 1500);
  }
  if (isRuntimeSmoke) {
    setTimeout(() => {
      isQuitting = true;
      app.quit();
    }, 7000);
  }
  app.on('activate', () => createWindow());
});

app.on('second-instance', () => {
  createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  historyStore?.syncInstances([], Date.now());
  try {
    historyStore?.flush();
  } catch {
  }
});

app.on('window-all-closed', () => {
  monitorService?.setVisible(false);
});
