const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'la-background-runtime-'));
app.setPath('userData', tempDir);
if (!process.argv.includes('--background')) process.argv.push('--background');
require('./main');

app.whenReady().then(async () => {
  await new Promise(resolve => setTimeout(resolve, 12000));
  const metrics = app.getAppMetrics().map(item => ({
    type: item.type,
    pid: item.pid,
    workingSetKb: item.memory?.workingSetSize || 0,
    privateKb: item.memory?.privateBytes || 0,
    cpuPercent: item.cpu?.percentCPUUsage || 0
  }));
  const result = {
    windowCount: BrowserWindow.getAllWindows().length,
    totalWorkingSetKb: metrics.reduce((sum, item) => sum + item.workingSetKb, 0),
    metrics
  };
  if (result.windowCount !== 0) {
    throw new Error(`Background start created ${result.windowCount} renderer window(s)`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  app.quit();
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});

app.on('will-quit', () => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
  }
});
