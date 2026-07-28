const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const source = path.resolve(__dirname, '../../desktop-app/backend/fps-patches');
const output = path.resolve(__dirname, 'assets');
const left = Buffer.from([
  0x91, 0x2a, 0x65, 0xd3, 0x08, 0xfe, 0x49, 0x7c,
  0xbb, 0x14, 0x82, 0x5d, 0xe1, 0x37, 0x6a, 0xc0,
  0x73, 0x99, 0x0f, 0xb4, 0xd8, 0x21, 0x56, 0xea,
  0x3c, 0x8d, 0xf2, 0x47, 0xa5, 0x60, 0x1b, 0xce
]);
const right = Buffer.from([
  0x24, 0xf8, 0x91, 0x06, 0xae, 0x43, 0xdc, 0x19,
  0x70, 0xe5, 0x31, 0x8a, 0x4f, 0xcb, 0x12, 0x95,
  0xb7, 0x05, 0xe3, 0x62, 0x1d, 0xcf, 0x88, 0x34,
  0xda, 0x76, 0x09, 0xbe, 0x53, 0x27, 0xf1, 0x68
]);
const key = Buffer.alloc(32);
for (let i = 0; i < key.length; i += 1) key[i] = left[i] ^ right[i];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
const files = [
  ['patch_original.bin', 'a0.dat'],
  ['patch_180.bin', 'a1.dat'],
  ['patch_240.bin', 'a2.dat'],
  ['patch_300.bin', 'a3.dat']
];
for (const [name, encodedName] of files) {
  const plain = fs.readFileSync(path.join(source, name));
  const iv = crypto.createHash('sha256')
    .update(`lifeafter-frame-core:${name}`, 'utf8')
    .digest()
    .subarray(0, 16);
  const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  fs.writeFileSync(path.join(output, encodedName), Buffer.concat([
    Buffer.from('LAF1', 'ascii'),
    iv,
    encrypted
  ]));
}

key.fill(0);
console.log(`Encrypted frame assets written to ${output}`);
