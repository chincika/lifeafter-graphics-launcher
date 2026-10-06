const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isNewerVersion } = require('./update-service');

const FEED_URL = 'https://github.com/chincika/lifeafter-graphics-launcher/releases/download/launcher-notices/notices.json';
const MAX_BYTES = 128 * 1024;
const NOTICE_CHECK_INTERVAL_MS = 60 * 1000;
class RemoteNotices {
  constructor({ dataDir, publicKey, currentVersion, fetchImpl = fetch, now = Date.now }) {
    this.file = path.join(dataDir, 'remote-notices.json');
    this.publicKey = publicKey; this.version = currentVersion; this.fetch = fetchImpl; this.now = now;
    this.state = { envelope: null, acknowledged: {}, sequence: 0 };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved.envelope) this.verify(saved.envelope);
      this.state = saved;
    } catch {}
    this.lastCheck = -Infinity; this.inFlight = null; this.etag = '';
  }
  verify(envelope) {
    if (!envelope || typeof envelope.payload !== 'string' || typeof envelope.signature !== 'string') throw Error('公告格式无效');
    const bytes = Buffer.from(envelope.payload, 'base64');
    if (bytes.length > MAX_BYTES || !crypto.verify(null, bytes, this.publicKey, Buffer.from(envelope.signature, 'base64'))) throw Error('公告签名无效');
    const feed = JSON.parse(bytes.toString('utf8'));
    if (feed.schema !== 1 || !Number.isSafeInteger(feed.sequence) || feed.sequence < 1 || !Array.isArray(feed.messages) || feed.messages.length > 50) throw Error('公告清单无效');
    if (feed.updatePolicy && (!/^\d+\.\d+\.\d+$/.test(feed.updatePolicy.minimumVersion) ||
        !Number.isSafeInteger(feed.updatePolicy.minimumBuild) || feed.updatePolicy.minimumBuild < 0)) throw Error('强制更新策略无效');
    const identities = new Set();
    for (const item of feed.messages) {
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) || !/^[a-zA-Z0-9_.-]{1,80}$/.test(item.version) ||
          !['notice', 'risk', 'disclaimer'].includes(item.type) || typeof item.title !== 'string' || item.title.length > 120 ||
          typeof item.body !== 'string' || item.body.length > 12000 || !Number.isFinite(Date.parse(item.expiresAt)) ||
          (item.startsAt && !Number.isFinite(Date.parse(item.startsAt))) ||
          (item.minVersion && !/^\d+\.\d+\.\d+$/.test(item.minVersion)) ||
          (item.maxVersion && !/^\d+\.\d+\.\d+$/.test(item.maxVersion))) throw Error('公告内容无效');
      const identity = `${item.id}:${item.version}`;
      if (identities.has(identity)) throw Error('重复公告编号'); identities.add(identity);
    }
    return feed;
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
  async check() {
    if (this.inFlight) return this.inFlight;
    if (this.now() - this.lastCheck < NOTICE_CHECK_INTERVAL_MS) return;
    this.lastCheck = this.now();
    this.inFlight = (async () => {
      try {
        const response = await this.fetch(FEED_URL, {
          signal: AbortSignal.timeout(8000), cache: 'no-store',
          headers: this.etag ? { 'If-None-Match': this.etag } : {}
        });
        if (response.status === 304) return;
        if (!response.ok) return;
        let size = 0; const chunks = [];
        for await (const chunk of response.body) {
          size += chunk.length; if (size > MAX_BYTES * 2) throw Error('公告文件过大'); chunks.push(Buffer.from(chunk));
        }
        const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const feed = this.verify(envelope);
        if (feed.sequence <= this.state.sequence) {
          if (feed.sequence === this.state.sequence && envelope.payload === this.state.envelope?.payload) this.etag = response.headers.get('etag') || '';
          return;
        }
        const previous = this.state;
        this.state = { ...previous, envelope, sequence: feed.sequence };
        try { this.save(); } catch (error) { this.state = previous; throw error; }
        this.etag = response.headers.get('etag') || '';
      } catch { /* Offline or invalid feeds never replace the last verified cache. */ }
    })();
    try { await this.inFlight; } finally { this.inFlight = null; }
  }
  messages() {
    if (!this.state.envelope) return [];
    return this.verify(this.state.envelope).messages.filter(item =>
      Date.parse(item.expiresAt) > this.now() && (!item.startsAt || Date.parse(item.startsAt) <= this.now()) &&
      (!item.minVersion || !isNewerVersion(item.minVersion, this.version)) &&
      (!item.maxVersion || !isNewerVersion(this.version, item.maxVersion))
    ).map(item => ({ ...item, digest: crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex') }));
  }
  requiredUpdate(build) {
    if (!this.state.envelope) return null;
    const policy = this.verify(this.state.envelope).updatePolicy;
    if (!policy) return null;
    return isNewerVersion(policy.minimumVersion, this.version) ||
      (policy.minimumVersion === this.version && build < policy.minimumBuild) ? policy : null;
  }
  pending() { return this.messages().filter(item => this.state.acknowledged[`${item.id}:${item.version}`]?.digest !== item.digest); }
  acknowledge(id, version, digest, agreed) {
    const item = this.messages().find(item => item.id === id && item.version === version && item.digest === digest);
    if (!item || (item.type === 'disclaimer' && agreed !== true)) throw Error('请阅读并同意当前免责声明');
    const previous = this.state;
    this.state = { ...previous, acknowledged: { ...previous.acknowledged, [`${id}:${version}`]: { digest, agreed: agreed === true, at: new Date(this.now()).toISOString() } } };
    try { this.save(); } catch (error) { this.state = previous; throw error; }
  }
}
module.exports = { RemoteNotices, NOTICE_CHECK_INTERVAL_MS };
