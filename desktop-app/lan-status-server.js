const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const COOKIE_NAME = 'la_remote_session';
const PAIRING_LIFETIME_MS = 5 * 60 * 1000;
const HEARTBEAT_MS = 20 * 1000;

function isPrivateIpv4(address) {
  if (!address || address === '127.0.0.1') return false;
  if (address.startsWith('10.') || address.startsWith('192.168.')) return true;
  const match = address.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function selectPrivateIpv4(networkInterfaces = os.networkInterfaces()) {
  for (const entries of Object.values(networkInterfaces)) {
    for (const item of entries || []) {
      if (
        item &&
        item.family === 'IPv4' &&
        !item.internal &&
        isPrivateIpv4(item.address)
      ) {
        return item.address;
      }
    }
  }
  return '';
}

function json(response, statusCode, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders
  });
  response.end(body);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

class LanStatusServer {
  constructor(options) {
    this.settingsStore = options.settingsStore;
    this.staticDir = options.staticDir;
    this.statusProvider = options.statusProvider;
    this.historyProvider = options.historyProvider;
    this.addressProvider = options.addressProvider || selectPrivateIpv4;
    this.portOverride = options.port;
    this.onClientCountChanged = options.onClientCountChanged || (() => {});
    this.onStateChanged = options.onStateChanged || (() => {});
    this.server = null;
    this.address = '';
    this.port = 0;
    this.pairingCode = '';
    this.pairingExpiresAt = 0;
    this.sseClients = new Set();
    this.attempts = new Map();
    this.heartbeatTimer = null;
  }

  publicState() {
    const settings = this.settingsStore.get();
    return {
      enabled: settings.lanEnabled,
      running: Boolean(this.server?.listening),
      address: this.address,
      port: this.port || settings.lanPort,
      url: this.address && (this.port || settings.lanPort)
        ? `http://${this.address}:${this.port || settings.lanPort}`
        : '',
      pairingCode: this.pairingCode,
      pairingExpiresAt: this.pairingExpiresAt,
      clientCount: this.sseClients.size,
      devices: settings.trustedDevices.map(item => ({
        id: item.id,
        name: item.name,
        address: item.address,
        createdAt: item.createdAt,
        lastSeenAt: item.lastSeenAt
      }))
    };
  }

  rotatePairingCode() {
    this.pairingCode = String(crypto.randomInt(100000, 1000000));
    this.pairingExpiresAt = Date.now() + PAIRING_LIFETIME_MS;
    this.onStateChanged(this.publicState());
    return this.publicState();
  }

  async start() {
    if (this.server?.listening) return { ok: true, data: this.publicState() };
    this.address = this.addressProvider();
    if (!this.address) {
      return { ok: false, error: '没有找到可用的家庭或专用网络 IPv4 地址' };
    }
    this.port = Number.isInteger(this.portOverride)
      ? this.portOverride
      : this.settingsStore.get().lanPort;
    this.rotatePairingCode();
    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response).catch(error => {
        if (!response.headersSent) {
          json(response, 500, { ok: false, error: '本地状态服务发生错误' });
        } else {
          response.end();
        }
        this.onStateChanged({ ...this.publicState(), error: error.message });
      });
    });
    this.server.on('clientError', (_error, socket) => socket.destroy());
    try {
      await new Promise((resolve, reject) => {
        const onError = error => {
          this.server?.off('listening', onListening);
          reject(error);
        };
        const onListening = () => {
          this.server?.off('error', onError);
          resolve();
        };
        this.server.once('error', onError);
        this.server.once('listening', onListening);
        this.server.listen(this.port, this.address);
      });
      this.port = this.server.address().port;
    } catch (error) {
      this.server = null;
      return { ok: false, error: `无法启动局域网状态服务：${error.message}` };
    }
    this.heartbeatTimer = setInterval(() => this.broadcast('heartbeat', {
      generatedAt: Date.now()
    }), HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
    this.onStateChanged(this.publicState());
    return { ok: true, data: this.publicState() };
  }

  async stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const client of this.sseClients) client.response.end();
    this.sseClients.clear();
    this.onClientCountChanged(0);
    const current = this.server;
    this.server = null;
    if (current) {
      await new Promise(resolve => current.close(() => resolve()));
    }
    this.address = '';
    this.port = 0;
    this.onStateChanged(this.publicState());
  }

  pushSnapshot(snapshot) {
    if (!this.server?.listening || !this.sseClients.size) return;
    this.broadcast('snapshot', this.statusProvider(snapshot));
  }

  broadcast(eventName, value) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const client of [...this.sseClients]) {
      try {
        client.response.write(payload);
      } catch {
        this.removeClient(client);
      }
    }
  }

  removeClient(client) {
    if (!this.sseClients.delete(client)) return;
    try {
      client.response.end();
    } catch {
    }
    this.onClientCountChanged(this.sseClients.size);
    this.onStateChanged(this.publicState());
  }

  validateHost(request) {
    const host = String(request.headers.host || '').toLowerCase();
    const allowed = new Set([
      `${this.address}:${this.port}`.toLowerCase(),
      `127.0.0.1:${this.port}`,
      `localhost:${this.port}`
    ]);
    return allowed.has(host);
  }

  parseCookies(request) {
    const result = {};
    for (const part of String(request.headers.cookie || '').split(';')) {
      const index = part.indexOf('=');
      if (index <= 0) continue;
      result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
    return result;
  }

  authenticate(request) {
    const rawToken = this.parseCookies(request)[COOKIE_NAME];
    if (!rawToken || rawToken.length > 256) return null;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const settings = this.settingsStore.get();
    const device = settings.trustedDevices.find(item => safeEqual(item.tokenHash, tokenHash));
    if (!device) return null;
    return this.settingsStore.touchDevice(
      device.id,
      String(request.socket.remoteAddress || '').replace(/^::ffff:/, '')
    ) || device;
  }

  async readJsonBody(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8192) throw new Error('请求内容过大');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  }

  canAttempt(address) {
    const now = Date.now();
    const recent = (this.attempts.get(address) || []).filter(value => now - value < 60 * 1000);
    if (recent.length >= 8) return false;
    recent.push(now);
    this.attempts.set(address, recent);
    return true;
  }

  async pair(request, response) {
    const remoteAddress = request.socket.remoteAddress || '';
    if (!this.canAttempt(remoteAddress)) {
      json(response, 429, { ok: false, error: '配对尝试过于频繁，请稍后再试' });
      return;
    }
    const body = await this.readJsonBody(request);
    const codeValid = Date.now() <= this.pairingExpiresAt &&
      safeEqual(String(body.code || '').replace(/\s/g, ''), this.pairingCode);
    if (!codeValid) {
      json(response, 403, { ok: false, error: '配对码无效或已过期' });
      return;
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const device = {
      id: crypto.randomUUID(),
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
      name: String(body.name || request.headers['user-agent'] || '浏览器设备').slice(0, 80),
      address: remoteAddress.replace(/^::ffff:/, '').slice(0, 80),
      createdAt: Date.now(),
      lastSeenAt: Date.now()
    };
    const settings = this.settingsStore.get();
    const trustedDevices = [...settings.trustedDevices, device].slice(-20);
    this.settingsStore.update({ trustedDevices });
    this.rotatePairingCode();
    json(response, 200, { ok: true }, {
      'Set-Cookie': `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`
    });
  }

  serveFile(response, fileName, contentType) {
    const filePath = path.join(this.staticDir, fileName);
    try {
      const data = fs.readFileSync(filePath);
      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.length,
        'Cache-Control': fileName === 'index.html' ? 'no-store' : 'public, max-age=3600',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer'
      });
      response.end(data);
    } catch {
      json(response, 404, { ok: false, error: '资源不存在' });
    }
  }

  async handleRequest(request, response) {
    if (!this.validateHost(request)) {
      json(response, 403, { ok: false, error: '不允许的主机地址' });
      return;
    }
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      this.serveFile(response, 'index.html', 'text/html; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/app.js') {
      this.serveFile(response, 'app.js', 'text/javascript; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/styles.css') {
      this.serveFile(response, 'styles.css', 'text/css; charset=utf-8');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/session') {
      json(response, 200, {
        ok: true,
        authenticated: Boolean(this.authenticate(request)),
        pairingRequired: true
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/pair') {
      await this.pair(request, response);
      return;
    }
    const device = this.authenticate(request);
    if (!device) {
      json(response, 401, { ok: false, error: '设备尚未配对' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/status') {
      json(response, 200, { ok: true, data: this.statusProvider() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/history') {
      const range = ['day', 'week', 'month', 'total'].includes(url.searchParams.get('range'))
        ? url.searchParams.get('range')
        : 'day';
      json(response, 200, { ok: true, data: this.historyProvider(range) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff'
      });
      const client = { response, deviceId: device.id };
      this.sseClients.add(client);
      this.onClientCountChanged(this.sseClients.size);
      this.onStateChanged(this.publicState());
      response.write(`event: snapshot\ndata: ${JSON.stringify(this.statusProvider())}\n\n`);
      request.on('close', () => this.removeClient(client));
      return;
    }
    json(response, 404, { ok: false, error: '接口不存在' });
  }

  revokeDevice(id) {
    const settings = this.settingsStore.get();
    const trustedDevices = settings.trustedDevices.filter(item => item.id !== id);
    if (trustedDevices.length === settings.trustedDevices.length) return false;
    this.settingsStore.update({ trustedDevices });
    for (const client of [...this.sseClients]) {
      if (client.deviceId === id) this.removeClient(client);
    }
    this.onStateChanged(this.publicState());
    return true;
  }

  revokeAllDevices() {
    this.settingsStore.update({ trustedDevices: [] });
    for (const client of [...this.sseClients]) this.removeClient(client);
    this.onStateChanged(this.publicState());
  }
}

module.exports = {
  LanStatusServer,
  isPrivateIpv4,
  selectPrivateIpv4
};
