const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LanStatusServer, isPrivateIpv4, selectPrivateIpv4 } = require('./lan-status-server');
const { MonitorService } = require('./monitor-service');
const { SettingsStore } = require('./settings-store');

async function testMonitorAdaptiveIntervalsAndSingleFlight() {
  let resolves;
  let captureCount = 0;
  const monitor = new MonitorService({
    capture: () => {
      captureCount += 1;
      return new Promise(resolve => {
        resolves = () => resolve({
          ok: true,
          data: { capturedAt: Date.now(), instances: [{ pid: 1 }] }
        });
      });
    },
    historyStore: { syncInstances() {} }
  });

  assert.equal(monitor.intervalMs(), 15000);
  monitor.setVisible(true);
  assert.equal(monitor.intervalMs(), 2000);
  monitor.setVisible(false);
  monitor.setRemoteClientCount(1);
  assert.equal(monitor.intervalMs(), 5000);

  const first = monitor.refreshNow();
  const second = monitor.refreshNow();
  assert.equal(captureCount, 1, 'overlapping refreshes must share one capture');
  resolves();
  await Promise.all([first, second]);
  assert.equal(monitor.intervalMs(), 3000);
  monitor.setRemoteClientCount(0);
  assert.equal(monitor.intervalMs(), 5000);
}

function testPrivateAddressSelection() {
  assert.equal(isPrivateIpv4('192.168.1.20'), true);
  assert.equal(isPrivateIpv4('10.0.0.8'), true);
  assert.equal(isPrivateIpv4('172.16.2.2'), true);
  assert.equal(isPrivateIpv4('172.32.2.2'), false);
  assert.equal(isPrivateIpv4('8.8.8.8'), false);
  assert.equal(selectPrivateIpv4({
    Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    Public: [{ family: 'IPv4', internal: false, address: '8.8.8.8' }],
    Lan: [{ family: 'IPv4', internal: false, address: '192.168.50.4' }]
  }), '192.168.50.4');
}

async function testPairingAndReadOnlyApi() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'la-lan-test-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'index.html'), '<!doctype html><title>test</title>');
    fs.writeFileSync(path.join(tempDir, 'app.js'), '');
    fs.writeFileSync(path.join(tempDir, 'styles.css'), '');
    const settings = new SettingsStore(path.join(tempDir, 'settings.json'));
    settings.update({ lanEnabled: true });
    const server = new LanStatusServer({
      settingsStore: settings,
      staticDir: tempDir,
      addressProvider: () => '127.0.0.1',
      port: 0,
      statusProvider: () => ({ instances: [{ pid: 10, name: '测试账号' }] }),
      historyProvider: range => ({ range, accounts: [], recent: [] })
    });
    const started = await server.start();
    assert.equal(started.ok, true);
    const baseUrl = server.publicState().url;

    const sessionBefore = await fetch(`${baseUrl}/api/v1/session`);
    assert.equal(sessionBefore.status, 200);
    assert.equal((await sessionBefore.json()).authenticated, false);

    const unauthorized = await fetch(`${baseUrl}/api/v1/status`);
    assert.equal(unauthorized.status, 401);

    const pair = await fetch(`${baseUrl}/api/v1/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: server.publicState().pairingCode,
        name: '测试浏览器'
      })
    });
    assert.equal(pair.status, 200);
    const cookie = pair.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /^la_remote_session=/);

    const authorized = await fetch(`${baseUrl}/api/v1/status`, {
      headers: { Cookie: cookie }
    });
    assert.equal(authorized.status, 200);
    assert.equal((await authorized.json()).data.instances[0].name, '测试账号');

    const history = await fetch(`${baseUrl}/api/v1/history?range=week`, {
      headers: { Cookie: cookie }
    });
    assert.equal(history.status, 200);
    assert.equal((await history.json()).data.range, 'week');
    assert.equal(server.publicState().devices.length, 1);

    server.revokeAllDevices();
    const revoked = await fetch(`${baseUrl}/api/v1/status`, {
      headers: { Cookie: cookie }
    });
    assert.equal(revoked.status, 401);
    await server.stop();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  await testMonitorAdaptiveIntervalsAndSingleFlight();
  testPrivateAddressSelection();
  await testPairingAndReadOnlyApi();
  console.log('background service tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
