const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray
} = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { HistoryStore } = require('./history-store');
const { LanStatusServer } = require('./lan-status-server');
const { MonitorService } = require('./monitor-service');
const { SettingsStore } = require('./settings-store');

const execFileAsync = promisify(execFile);
const cpuHistory = new Map();
let historyStore = null;
let settingsStore = null;
let monitorService = null;
let lanServer = null;
let mainWindow = null;
let tray = null;
let isQuitting = false;
let cachedQrUrl = '';
let cachedQrDataUrl = '';
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

async function runBackend(args, timeout = 30000) {
  try {
    const { stdout, stderr } = await execFileAsync(backendPath(), args, {
      windowsHide: true,
      timeout,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 4
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
  const result = await runBackend(['--fps-status'], 120000);
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
  if (persistedRoot) {
    await runBackend(['--set-root', persistedRoot], 10000);
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
    fs.mkdirSync(path.dirname(persistentRootPath()), { recursive: true });
    fs.writeFileSync(persistentRootPath(), detectedRoot, 'utf8');
  }
  return {
    ok: true,
    root: detectedRoot,
    summary: summary.ok ? summary.text : '未找到游戏目录',
    instances: instances.ok ? instances.data : { instances: [] },
    fpsStatus: fpsStatus.ok ? fpsStatus.data : { ok: false, error: fpsStatus.error },
    fpsTargetPreference: readFpsPreference(),
    background
  };
});

ipcMain.handle('launcher:choose-root', async () => {
  const selected = await dialog.showOpenDialog({
    title: '选择 LifeAfter 游戏安装目录',
    properties: ['openDirectory']
  });
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true };
  const result = await runBackend(['--set-root', selected.filePaths[0]]);
  if (result.ok) {
    fs.mkdirSync(path.dirname(persistentRootPath()), { recursive: true });
    fs.writeFileSync(persistentRootPath(), result.text, 'utf8');
    return { ok: true, root: result.text };
  }
  return result;
});

ipcMain.handle('launcher:apply-preset', async (_event, payload) => {
  const args = ['--apply', String(payload.preset || '')];
  if (payload.launch) args.push('--launch');
  return runBackend(args, 60000);
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
  const result = await runBackend(['--fps-apply', String(value)], 300000);
  if (result.ok) saveFpsPreference(value);
  return result;
});
ipcMain.handle('launcher:restore-fps', async () => {
  const result = await runBackend(['--fps-restore'], 300000);
  if (result.ok) saveFpsPreference(120);
  return result;
});
ipcMain.handle('launcher:clean-fps-backups', () =>
  runBackend(['--fps-clean-backups'], 300000));

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

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  settingsStore = new SettingsStore(settingsPath());
  historyStore = new HistoryStore(path.join(app.getPath('userData'), 'history'));
  monitorService = new MonitorService({
    capture: captureInstances,
    historyStore
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
  });
  monitorService.start();
  createTray();
  applyAutoStart(settingsStore.get().autoStart);

  if (settingsStore.get().lanEnabled) {
    const result = await lanServer.start();
    if (!result.ok) settingsStore.update({ lanEnabled: false });
  }

  if (!process.argv.includes('--background')) createWindow();
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
