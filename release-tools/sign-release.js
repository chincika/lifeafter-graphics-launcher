const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const [exePath, version, outputDirectory] = process.argv.slice(2);
const keyPath = process.env.LIFEAFTER_RELEASE_PRIVATE_KEY;
if (!exePath || !version || !outputDirectory || !keyPath) {
  throw new Error(
    'Usage: LIFEAFTER_RELEASE_PRIVATE_KEY=<path> node sign-release.js <exe> <version> <output-dir>'
  );
}
const executable = path.resolve(exePath);
const output = path.resolve(outputDirectory);
const payload = fs.readFileSync(executable);
const sha256 = crypto.createHash('sha256').update(payload).digest('hex').toUpperCase();
const manifest = {
  schema: 1,
  tag: `v${version}`,
  version,
  asset: {
    name: path.basename(executable),
    size: payload.length,
    sha256
  },
  publishedAt: new Date().toISOString()
};
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
const privateKey = fs.readFileSync(path.resolve(keyPath), 'utf8');
const signature = crypto.sign(null, manifestBytes, privateKey).toString('base64');

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'release-manifest.json'), manifestBytes);
fs.writeFileSync(path.join(output, 'release-manifest.sig'), `${signature}\n`, 'utf8');
fs.writeFileSync(
  path.join(output, 'SHA256SUMS.txt'),
  `${sha256}  ${path.basename(executable)}\n`,
  'utf8'
);
console.log(`Signed release manifest for ${path.basename(executable)} (${sha256})`);
