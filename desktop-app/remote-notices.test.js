const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { RemoteNotices } = require('./remote-notices');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-test-'));
  const keys = crypto.generateKeyPairSync('ed25519');
  const message = { id: 'risk', version: '1', type: 'disclaimer', title: '风险告知', body: '<script>not executable</script>', expiresAt: '2099-01-01', minVersion: '2.6.0' };
  const sign = feed => { const payload = Buffer.from(JSON.stringify(feed)); return { payload: payload.toString('base64'), signature: crypto.sign(null, payload, keys.privateKey).toString('base64') }; };
  let envelope = sign({ schema: 1, sequence: 1, messages: [message] });
  const options = { dataDir: root, currentVersion: '2.6.1', publicKey: keys.publicKey, fetchImpl: async () => new Response(JSON.stringify(envelope)) };
  try {
    const service = new RemoteNotices(options); await service.check();
    assert.equal(service.pending().length, 1);
    const item = service.pending()[0];
    assert.throws(() => service.acknowledge(item.id, item.version, item.digest, false));
    service.acknowledge(item.id, item.version, item.digest, true);
    assert.equal(new RemoteNotices(options).pending().length, 0);
    assert.throws(() => service.verify({ ...envelope, signature: 'AAAA' }));
    envelope = sign({ schema: 1, sequence: 2, messages: [{ ...message, body: 'changed' }] });
    service.lastCheck = 0; await service.check(); assert.equal(service.pending().length, 1);
    envelope = sign({ schema: 1, sequence: 1, messages: [] });
    service.lastCheck = 0; await service.check(); assert.equal(service.pending().length, 1);
    envelope = sign({ schema: 1, sequence: 3, messages: [{ ...message, expiresAt: '2020-01-01' }] });
    service.lastCheck = 0; await service.check(); assert.equal(service.pending().length, 0);
    assert.throws(() => service.verify(sign({ schema: 1, sequence: 4, messages: [message, message] })));
    options.fetchImpl = async () => { throw Error('offline'); };
    const offline = new RemoteNotices(options); await offline.check(); assert.equal(offline.state.sequence, 3);
    envelope = sign({ schema: 1, sequence: 4, messages: [], updatePolicy: { minimumVersion: '2.6.1', minimumBuild: 2 } });
    service.lastCheck = 0; await service.check();
    assert.equal(service.requiredUpdate(1).minimumBuild, 2);
    assert.equal(service.requiredUpdate(2), null);
    envelope = sign({ schema: 1, sequence: 5, messages: [], updatePolicy: { minimumVersion: '2.6.2', minimumBuild: 0 } });
    service.lastCheck = 0; await service.check(); assert.ok(service.requiredUpdate(99));
    console.log('remote notices tests passed');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
