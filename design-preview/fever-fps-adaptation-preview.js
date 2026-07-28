const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const desktopRoot = path.join(projectRoot, 'desktop-app');
const output = path.join(__dirname, 'fever-fps-adaptation-v1.png');

const fpsStatus = {
  ok: true,
  compatible: true,
  writable: true,
  gameRunning: false,
  state: 'original',
  stateLabel: '官方原始 120 FPS',
  target: 120,
  packagePath: 'E:\\FeverGames\\mrzh\\Documents\\script.py314.lc.npk',
  packageHash: 'BCACC8B1CFD4C4DB6F2B5633069EFDB39A1C8835A2436EAB338FB1B90BD69CC2',
  normalizedHash: 'BCACC8B1CFD4C4DB6F2B5633069EFDB39A1C8835A2436EAB338FB1B90BD69CC2',
  slotHash: '6F9165B65B8E32391E32FBC5174B8CC680E90C33C5887B46999D087ACE8FE050',
  backupDir: 'E:\\FeverGames\\mrzh\\Documents\\fps_unlock_backups',
  backupCount: 1,
  transactionBackupCount: 0,
  baselineReady: true,
  packageSize: 97122752
};

ipcMain.handle('launcher:init', async () => ({
  ok: true,
  root: 'E:\\FeverGames\\mrzh',
  summary: '当前档位：2K 120',
  instances: { capturedAt: Date.now(), instances: [] },
  fpsTargetPreference: 180,
  fpsStatus,
  performanceMode: true,
  launchMode: {
    standardAvailable: true,
    performanceAvailable: true,
    performanceRoute: 'Documents\\bin\\x64-3\\lifeafter.exe'
  },
  background: {
    minimizeToTray: true,
    autoStart: false,
    monitor: { visible: true, instanceCount: 0 },
    server: { enabled: false, running: false, devices: [] }
  }
}));
ipcMain.handle('launcher:get-instances', async () => ({
  ok: true,
  data: { capturedAt: Date.now(), instances: [] }
}));
ipcMain.handle('launcher:get-fps-status', async () => ({ ok: true, data: fpsStatus }));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1920,
    height: 1230,
    show: false,
    backgroundColor: '#07151d',
    webPreferences: {
      preload: path.join(desktopRoot, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await win.loadFile(path.join(desktopRoot, 'renderer', 'index.html'));
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const ready = await win.webContents.executeJavaScript(
      "document.querySelector('#fpsCurrentState')?.textContent.includes('120 FPS')"
    );
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  await win.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('.view').forEach(view => {
      view.style.animation = 'none';
    });
    switchView('fps');

    const style = document.createElement('style');
    style.textContent = \`
      .fever-platform-chip {
        display:inline-flex; align-items:center; gap:6px; margin-top:6px; padding:4px 8px;
        border:1px solid rgba(73,207,228,.24); border-radius:7px;
        color:#8be8f2; background:rgba(73,207,228,.08);
        font:600 9px "Microsoft YaHei UI",sans-serif; letter-spacing:.04em;
      }
      .fever-platform-chip::before {
        content:""; width:5px; height:5px; border-radius:50%; background:#43d08a;
        box-shadow:0 0 9px rgba(67,208,138,.8);
      }
      .fever-route-card {
        margin-top:12px; padding:12px; border:1px solid rgba(91,151,170,.22);
        border-radius:11px; background:linear-gradient(145deg,rgba(7,22,30,.46),rgba(20,38,48,.64));
      }
      .fever-route-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:9px; }
      .fever-route-head span { color:#7e99a4; font-size:8px; letter-spacing:1.2px; }
      .fever-route-head b { color:#dcebed; font-size:11px; font-weight:620; }
      .fever-route-lane {
        display:grid; grid-template-columns:30px minmax(0,1fr) auto; align-items:center; gap:9px;
        min-height:45px; padding:7px 9px; border:1px solid rgba(255,255,255,.06);
        border-radius:9px; background:rgba(255,255,255,.018);
      }
      .fever-route-lane + .fever-route-lane { margin-top:7px; }
      .fever-route-lane.target {
        border-color:rgba(67,208,138,.28); background:rgba(67,208,138,.075);
        box-shadow:inset 3px 0 0 #43d08a;
      }
      .fever-route-lane.protected { opacity:.78; }
      .fever-route-icon {
        width:28px; height:28px; display:grid; place-items:center; border-radius:8px;
        color:#74e3ee; background:rgba(73,207,228,.09);
      }
      .fever-route-lane.protected .fever-route-icon { color:#e9b563; background:rgba(233,181,99,.08); }
      .fever-route-icon svg { width:14px; height:14px; }
      .fever-route-copy { min-width:0; display:flex; flex-direction:column; gap:2px; }
      .fever-route-copy b { color:#e6f1f2; font-size:10px; font-weight:600; }
      .fever-route-copy small {
        overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
        color:#77939e; font:500 8px "Cascadia Mono","Consolas",monospace;
      }
      .fever-route-tag {
        padding:4px 6px; border-radius:6px; color:#8de3bd; background:rgba(67,208,138,.11);
        font-size:8px; white-space:nowrap;
      }
      .fever-route-lane.protected .fever-route-tag { color:#e7bd78; background:rgba(233,181,99,.1); }
      .fever-route-foot {
        display:flex; align-items:center; gap:6px; margin-top:8px; color:#79939d; font-size:8px;
      }
      .fever-route-foot i { width:5px; height:5px; border-radius:50%; background:#43d08a; }
      .fps-package-card .fps-details { margin-top:13px; }
      .fps-package-state { margin-top:12px; }
      .fps-package-state p { line-height:1.5; }
    \`;
    document.head.appendChild(style);

    const packageHead = document.querySelector('.fps-package-card .fps-section-head > div');
    packageHead.insertAdjacentHTML(
      'beforeend',
      '<span class="fever-platform-chip">网易发烧平台 · 自动识别</span>'
    );

    const packageState = document.querySelector('#fpsPackageState');
    packageState.querySelector('strong').textContent = '发烧平台增量包已识别';
    packageState.querySelector('p').textContent = 'NXPK v3 · SettingManager 槽位与补丁模板完全匹配';

    packageState.insertAdjacentHTML('afterend', \`
      <section class="fever-route-card">
        <div class="fever-route-head">
          <span>DUAL PACKAGE SAFETY ROUTE</span>
          <b>双包体安全路由</b>
        </div>
        <div class="fever-route-lane target">
          <span class="fever-route-icon"><svg><use href="#i-check"/></svg></span>
          <span class="fever-route-copy">
            <b>Documents 增量脚本包</b>
            <small>script.py314.lc.npk · 92.6 MB · BCACC8B1…</small>
          </span>
          <span class="fever-route-tag">唯一写入目标</span>
        </div>
        <div class="fever-route-lane protected">
          <span class="fever-route-icon"><svg><use href="#i-shield"/></svg></span>
          <span class="fever-route-copy">
            <b>根目录完整脚本包</b>
            <small>script.py314.lc.npk · 466 MB · 69E4DB60…</small>
          </span>
          <span class="fever-route-tag">只读保护</span>
        </div>
        <div class="fever-route-foot"><i></i>版本 20260724 · 平台、整包、槽位三重锁均已通过</div>
      </section>
    \`);

    const details = document.querySelector('.fps-package-card .fps-details');
    details.insertAdjacentHTML(
      'afterbegin',
      '<div><span>游戏平台</span><b class="accent">网易发烧平台</b></div>'
    );
    document.querySelector('#fpsBaselineState').textContent = '已建立 · 发烧版独立还原点';
    document.querySelector('#fpsBackupCount').textContent = '0 份事务 + 1 份永久';
    document.querySelector('#fpsPackagePath').textContent =
      'E:\\\\FeverGames\\\\mrzh\\\\Documents\\\\script.py314.lc.npk';
    document.querySelector('#fpsStateBadge b').textContent = '发烧平台 · 可安全写入';
  })()`);

  win.setPosition(-32000, -32000);
  win.showInactive();
  win.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 800));
  await win.webContents.executeJavaScript(`(() => {
    const state = document.querySelector('#fpsPackageState');
    state.querySelector('strong').textContent = '发烧平台增量包已识别';
    state.querySelector('p').textContent = 'NXPK v3 · SettingManager 槽位与补丁模板完全匹配';
    document.querySelector('#fpsBaselineState').textContent = '已建立 · 发烧版独立还原点';
    document.querySelector('#fpsBackupCount').textContent = '0 份事务 + 1 份永久';
    document.querySelector('#fpsPackagePath').textContent =
      'E:\\\\FeverGames\\\\mrzh\\\\Documents\\\\script.py314.lc.npk';
    document.querySelector('#fpsStateBadge b').textContent = '发烧平台 · 可安全写入';
  })()`);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(output, image.toPNG());
  process.stdout.write(`${output}\n`);
  app.quit();
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
