// Offline release utility. Never package or publish the private key.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const keyPath = path.join(process.env.LOCALAPPDATA, 'LifeAfterReleaseKeys', 'notices-private.pem');
if (process.argv[2] === 'init') {
  if (fs.existsSync(keyPath)) throw Error('Existing private key must not be overwritten');
  const keys = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx' });
  process.stdout.write(keys.publicKey.export({ type: 'spki', format: 'pem' }));
} else {
  const bytes = fs.readFileSync(process.argv[2]);
  const signature = crypto.sign(null, bytes, fs.readFileSync(keyPath));
  process.stdout.write(JSON.stringify({ payload: bytes.toString('base64'), signature: signature.toString('base64') }));
}
