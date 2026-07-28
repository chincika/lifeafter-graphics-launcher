const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    frame: false,
    webPreferences: { backgroundThrottling: false }
  });
  await win.loadFile(path.join(__dirname, 'game-library-manager-preview.html'));
  await new Promise(resolve => setTimeout(resolve, 500));
  const image = await win.webContents.capturePage();
  require('fs').writeFileSync(
    path.join(__dirname, 'game-library-manager-preview.png'),
    image.toPNG()
  );
  app.quit();
});
