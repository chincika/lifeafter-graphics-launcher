const { app, net } = require('electron');
const { UpdateService } = require('./update-service');
const packageInfo = require('./package.json');

app.whenReady().then(async () => {
  const service = new UpdateService({
    currentVersion: packageInfo.version,
    repo: 'chincika/lifeafter-graphics-launcher',
    dataDir: app.getPath('temp'),
    fetchImpl: (...args) => net.fetch(...args)
  });
  const result = await service.check();
  if (!result.ok) throw new Error(result.error);
  process.stdout.write(`${JSON.stringify({
    currentVersion: packageInfo.version,
    updateAvailable: result.updateAvailable,
    state: service.publicState()
  }, null, 2)}\n`);
  app.quit();
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  app.exit(1);
});
