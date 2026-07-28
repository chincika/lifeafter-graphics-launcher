const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const previewDir = __dirname;
const source = path.join(previewDir, 'tray-remote-v22-preview.html');
const windows = new Set();

async function capture(name, width, height, mode) {
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    frame: false,
    backgroundColor: '#08131b',
    webPreferences: { sandbox: true }
  });
  windows.add(win);
  await win.loadFile(source, { query: { mode } });
  win.setPosition(-32000, -32000);
  win.showInactive();
  await new Promise(resolve => setTimeout(resolve, 500));
  const image = await win.webContents.capturePage();
  const output = path.join(previewDir, name);
  fs.writeFileSync(output, image.toPNG());
  windows.delete(win);
  win.destroy();
  return output;
}

app.whenReady().then(async () => {
  const desktop = await capture('tray-remote-desktop-v22.png', 1920, 1200, 'desktop');
  const mobile = await capture('remote-mobile-v22.png', 430, 932, 'mobile');
  process.stdout.write(JSON.stringify({ desktop, mobile }, null, 2));
  app.quit();
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});

app.on('window-all-closed', event => {
  event.preventDefault();
});
