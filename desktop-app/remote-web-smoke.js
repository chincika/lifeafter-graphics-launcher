const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { LanStatusServer } = require('./lan-status-server');
const { SettingsStore } = require('./settings-store');

const output = path.join(__dirname, 'ui-smoke-remote-web.png');
let tempDir = '';
let server = null;

const snapshot = {
  appVersion: '2.2.0',
  generatedAt: Date.now(),
  capturedAt: Date.now(),
  fpsTakeoverTarget: 180,
  instances: [
    {
      pid: 18472,
      name: '不与世俗纷争',
      width: 2560,
      height: 1440,
      cpuPercent: 16,
      workingSetBytes: 4.6 * 1073741824,
      runningSeconds: 6138
    },
    {
      pid: 20640,
      name: '挂机账号 02',
      width: 960,
      height: 540,
      cpuPercent: 5,
      workingSetBytes: 3.2 * 1073741824,
      runningSeconds: 8200
    }
  ]
};

function history(range) {
  return {
    range,
    generatedAt: Date.now(),
    totalDurationMs: 35 * 60 * 60 * 1000 + 42 * 60 * 1000,
    launchCount: 4,
    averageDurationMs: 59 * 60 * 1000,
    mostUsedAccount: '不与世俗纷争',
    mostUsedShare: 0.62,
    durationDeltaMs: 0,
    launchDelta: 0,
    accounts: [
      { account: '不与世俗纷争', durationMs: 148 * 60 * 1000, launches: 2 },
      { account: '挂机账号 02', durationMs: 90 * 60 * 1000, launches: 2 }
    ],
    recent: [
      { pid: 18472, account: '不与世俗纷争', startedAt: Date.now() - 6138000, active: true, durationMs: 6138000 },
      { pid: 20640, account: '挂机账号 02', startedAt: Date.now() - 8200000, active: true, durationMs: 8200000 }
    ]
  };
}

app.whenReady().then(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'la-remote-web-'));
  const settings = new SettingsStore(path.join(tempDir, 'settings.json'));
  settings.update({ lanEnabled: true });
  server = new LanStatusServer({
    settingsStore: settings,
    staticDir: path.join(__dirname, 'renderer', 'remote'),
    addressProvider: () => '127.0.0.1',
    port: 0,
    statusProvider: () => snapshot,
    historyProvider: history
  });
  const started = await server.start();
  if (!started.ok) throw new Error(started.error);

  const win = new BrowserWindow({
    width: 430,
    height: 932,
    show: false,
    frame: false,
    backgroundColor: '#08131b'
  });
  await win.loadURL(server.publicState().url);
  await win.webContents.executeJavaScript(`(() => {
    document.querySelector('#pairCode').value = '${server.publicState().pairingCode}';
    document.querySelector('#deviceName').value = 'UI Smoke Phone';
    document.querySelector('#pairForm').requestSubmit();
  })()`);

  const deadline = Date.now() + 5000;
  let state;
  while (Date.now() < deadline) {
    state = await win.webContents.executeJavaScript(`(() => ({
      pairHidden: document.querySelector('#pairView').hidden,
      dashboardHidden: document.querySelector('#dashboard').hidden,
      instanceCount: document.querySelector('#instanceCount').textContent,
      totalDuration: document.querySelector('#totalDuration').textContent,
      connection: document.querySelector('#connectionState b').textContent
    }))()`);
    if (!state.dashboardHidden && state.instanceCount === '2') break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (
    !state.pairHidden ||
    state.dashboardHidden ||
    state.instanceCount !== '2' ||
    state.totalDuration !== '35小时42分'
  ) {
    throw new Error(`Remote dashboard mismatch: ${JSON.stringify(state)}`);
  }

  win.setPosition(-32000, -32000);
  win.showInactive();
  await new Promise(resolve => setTimeout(resolve, 400));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(output, image.toPNG());
  process.stdout.write(`${JSON.stringify({ state, output }, null, 2)}\n`);
  win.destroy();
  await server.stop();
  fs.rmSync(tempDir, { recursive: true, force: true });
  app.quit();
}).catch(async error => {
  process.stderr.write(`${error.stack || error}\n`);
  try {
    await server?.stop();
  } catch {
  }
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  app.exit(1);
});
