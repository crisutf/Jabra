const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 80;
const ROOT = __dirname;
const COUNTS_FILE = path.join(ROOT, 'json', 'playcounts.server.json');
const DEVICES_FILE = path.join(ROOT, 'json', 'devices.server.json');

// Ensure files exist
if (!fs.existsSync(COUNTS_FILE)) fs.writeFileSync(COUNTS_FILE, JSON.stringify({}), 'utf8');
if (!fs.existsSync(DEVICES_FILE)) fs.writeFileSync(DEVICES_FILE, JSON.stringify({}), 'utf8');

app.use(express.json());
// REMOVE early static; keep trust proxy once near the top
app.set('trust proxy', true); // {{ edit_1 }} trust proxy for x-forwarded-for

// Existing play count API
app.post('/api/play', (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'missing id' });

  const data = JSON.parse(fs.readFileSync(COUNTS_FILE, 'utf8'));
  data[id] = (data[id] || 0) + 1;
  fs.writeFileSync(COUNTS_FILE, JSON.stringify(data), 'utf8');
  res.json({ ok: true, id, count: data[id] });
});

app.get('/api/top', (req, res) => {
  const data = JSON.parse(fs.readFileSync(COUNTS_FILE, 'utf8'));
  const entries = Object.entries(data);
  if (!entries.length) return res.json({ id: null, count: 0 });
  entries.sort((a, b) => b[1] - a[1]);
  const [id, count] = entries[0];
  res.json({ id, count });
});

// {{ edit_2 }} device status API with robust IP detection
app.post('/api/status', (req, res) => {
  const { deviceId, songId, isPlaying, title, artist } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: 'missing deviceId' });

  const ipRaw = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const ip = (Array.isArray(ipRaw) ? ipRaw[0] : String(ipRaw))
    .split(',')[0]
    .replace('::ffff:', '')
    .replace('::1', '127.0.0.1');

  const store = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
  store[deviceId] = {
    deviceId,
    ip,
    isPlaying: !!isPlaying,
    song: songId ? { id: songId, title: title || null, artist: artist || null } : null,
    updatedAt: Date.now(),
    ua: req.headers['user-agent'] || ''
  };

  fs.writeFileSync(DEVICES_FILE, JSON.stringify(store), 'utf8');
  res.json({ ok: true });
});

// {{ edit_3 }} Devices list (keep entries for 10 minutes)
app.get('/api/devices', (req, res) => {
  const store = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
  const now = Date.now();
  const filtered = Object.values(store).filter(d => now - (d.updatedAt || 0) < 10 * 60 * 1000);
  res.json(filtered);
});

// Root route: include tv in file map
// Root route: serve the redirect page so client decides target (desktop/mobile/tv)
app.get('/', (req, res) => {
  // {{ edit_1 }} serve index.html to run redirect logic
  res.sendFile(path.join(ROOT, 'index.html'));
});

// Keep static after "/" so our router handles the root
app.use(express.static(ROOT));

// {{ edit_4 }} Set preferred layout cookie: allow 'tv'
app.post('/api/layout', (req, res) => {
  const { layout } = req.body || {};
  if (!['desktop', 'mobile', 'tv'].includes(layout)) return res.status(400).json({ error: 'invalid layout' });
  res.setHeader('Set-Cookie', `layout=${layout}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`);
  res.json({ ok: true, layout });
});

// {{ edit_5 }} Optional: clear layout and redirect to "/"
app.get('/clear-layout', (req, res) => {
  res.setHeader('Set-Cookie', `layout=; Path=/; Max-Age=0; SameSite=Lax`);
  res.redirect('/');
});

// DELETE duplicated middleware and routes that appeared below:
// - app.use(express.static(ROOT));
// - app.set('trust proxy', true);
// - /api/play
// - /api/top
// - /api/status
// - /api/devices
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});