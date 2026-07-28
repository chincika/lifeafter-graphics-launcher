const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const output = path.resolve(
  process.env.LAUNCHER_REMOTE_UI_SCREENSHOT || path.join(__dirname, 'ui-smoke-remote.png')
);

const background = {
  minimizeToTray: true,
  autoStart: false,
  monitor: {
    visible: true,
    remoteClientCount: 1,
    intervalMs: 2000,
    instanceCount: 2
  },
  server: {
    enabled: false,
    running: false,
    address: '',
    port: 17666,
    url: '',
    pairingCode: '',
    pairingExpiresAt: 0,
    clientCount: 0,
    devices: []
  },
  qrDataUrl: ''
};

const fpsStatus = {
  ok: true,
  compatible: true,
  writable: true,
  gameRunning: false,
  state: 'conditional-180',
  target: 180,
  baselineReady: true,
  backupCount: 1,
  transactionBackupCount: 0
};

ipcMain.handle('launcher:init', async () => ({
  ok: true,
  root: 'D:\\LifeAfter',
  summary: '当前档位：2K 120',
  instances: {
    capturedAt: Date.now(),
    instances: [
      { pid: 101, name: '不与世俗纷争', width: 2560, height: 1440, runningSeconds: 6138 },
      { pid: 102, name: '挂机账号 02', width: 960, height: 540, runningSeconds: 8200 }
    ]
  },
  fpsTargetPreference: 180,
  fpsStatus,
  background
}));
ipcMain.handle('launcher:get-background-state', async () => background);
ipcMain.handle('launcher:set-background-option', async (_event, payload) => {
  if (payload.key === 'lanEnabled') {
    background.server = {
      enabled: payload.value,
      running: payload.value,
      address: payload.value ? '192.168.1.23' : '',
      port: 17666,
      url: payload.value ? 'http://192.168.1.23:17666' : '',
      pairingCode: payload.value ? '583204' : '',
      pairingExpiresAt: payload.value ? Date.now() + 5 * 60 * 1000 : 0,
      clientCount: payload.value ? 1 : 0,
      devices: payload.value ? [{
        id: 'device-1',
        name: 'iPhone · Safari',
        address: '192.168.1.51',
        createdAt: Date.now(),
        lastSeenAt: Date.now()
      }] : []
    };
    background.qrDataUrl = payload.value
      ? `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#e7f4f3"/><path d="M10 10h30v30H10zm50 0h30v30H60zM10 60h30v30H10zm42-7h12v12H52zm19 12h19v25H71zM45 75h16v15H45z" fill="#14343d"/></svg>').toString('base64')}`
      : '';
  }
  return { ok: true, data: background };
});
ipcMain.handle('launcher:rotate-pairing-code', async () => ({ ok: true, data: background }));
ipcMain.handle('launcher:revoke-remote-device', async () => ({ ok: true, data: background }));
ipcMain.handle('launcher:revoke-all-remote-devices', async () => ({ ok: true, data: background }));
ipcMain.handle('launcher:open-remote-page', async () => ({ ok: true, url: background.server.url }));
ipcMain.handle('launcher:copy-text', async () => ({ ok: true }));
ipcMain.handle('launcher:get-instances', async () => ({ ok: true, data: { instances: [] } }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1920,
    height: 1200,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('.view').forEach(view => {
      view.style.animation = 'none';
    });
    switchView('remote');
  })()`);
  await new Promise(resolve => setTimeout(resolve, 150));
  await win.webContents.executeJavaScript("document.querySelector('#lanEnabledToggle').click()");

  const deadline = Date.now() + 5000;
  let state;
  while (Date.now() < deadline) {
    state = await win.webContents.executeJavaScript(`(() => ({
      activeView: document.querySelector('.view.active')?.id,
      lanPressed: document.querySelector('#lanEnabledToggle').getAttribute('aria-pressed'),
      serverTitle: document.querySelector('#remoteServerTitle').textContent,
      remoteUrl: document.querySelector('#remoteUrl').textContent,
      pairingCode: document.querySelector('#remotePairCode').textContent,
      deviceCount: document.querySelector('#remoteDeviceCount').textContent,
      openDisabled: document.querySelector('#openRemotePage').disabled,
      remoteDisplay: getComputedStyle(document.querySelector('#remoteView')).display,
      remoteOpacity: getComputedStyle(document.querySelector('#remoteView')).opacity,
      remoteRect: document.querySelector('#remoteView').getBoundingClientRect().toJSON(),
      pageHeadRect: document.querySelector('.remote-page-head').getBoundingClientRect().toJSON()
    }))()`);
    if (state.serverTitle === '服务已开启') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (
    state.activeView !== 'remoteView' ||
    state.lanPressed !== 'true' ||
    state.serverTitle !== '服务已开启' ||
    state.remoteUrl !== 'http://192.168.1.23:17666' ||
    state.pairingCode !== '583 204' ||
    state.deviceCount !== '1 台' ||
    state.openDisabled
  ) {
    throw new Error(`Background UI mismatch: ${JSON.stringify(state)}`);
  }

  win.setPosition(-32000, -32000);
  win.showInactive();
  await new Promise(resolve => setTimeout(resolve, 500));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(output, image.toPNG());
  process.stdout.write(`${JSON.stringify({ state, output }, null, 2)}\n`);
  app.quit();
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
