/**
 * GPT Trade — Backend Server
 * Express.js + better-sqlite3 + web-push + TG + FB CAPI
 */

const express = require('express');
const cors = require('cors');
const webPush = require('web-push');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));

// ══════════════════════════════════════
//  ENV CONFIG
// ══════════════════════════════════════

const PORT = process.env.PORT || 3000;
const DISK = process.env.RENDER_DISK_PATH || './data';

// Telegram
const TG_BOT = process.env.TG_BOT_TOKEN || '8601777567:AAFyBTaF_uM65ueCJvM4YHCZfu8_7Q08Ezg';
const TG_CHAT = process.env.TG_CHAT_ID || '-1003578369883';
const TG_BUYER = process.env.TG_BUYER || 'PUMBA';
const TG_GEO = process.env.TG_GEO || 'USA';

// Facebook CAPI
const FB_PIXEL_ID = process.env.FB_PIXEL_ID || '1268408938556591';
const FB_ACCESS_TOKEN = process.env.FB_ACCESS_TOKEN || 'EAAJ2FqEUEeIBQ0UGG1MLStHbnINn5em7ePxMeEcfJflvqfCX5vrZBGuNVpukS0aFyGz5uuUsRB1qVc89jVx3ZAToPJUNGtY0Q8bBmG7klKZCXPCZAoDMwrfpDnENbPVP2Kk3mQz797rQiq2oQ5lqPCly0GxAZAuljETiZCfZClaxqf3LBKVp9BooHIYGvlxMQZDZD';

// VAPID keys for web-push
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || 'BCqbWcW6BBT0sspcBLtETn7_KS74MBf6F-LzwiMZQJJI-6cWmRtPqxAVmHNbnOLpBG7Nu657HAC7cnO_ndD57dI';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'RmgN8haNCGEPgepFa8HFtLkeTteIE6tVnDG9mkWxtN0';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:admin@example.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webPush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ══════════════════════════════════════
//  DATABASE
// ══════════════════════════════════════

const fs = require('fs');
if (!fs.existsSync(DISK)) fs.mkdirSync(DISK, { recursive: true });

const db = new Database(path.join(DISK, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT UNIQUE NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id TEXT UNIQUE,
    first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
    buyer TEXT, geo TEXT,
    device_info TEXT DEFAULT '{}',
    geo_info TEXT DEFAULT '{}',
    utm TEXT DEFAULT '{}',
    is_pwa INTEGER DEFAULT 0,
    page_time INTEGER DEFAULT 0,
    referrer TEXT DEFAULT '',
    landing TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    status TEXT DEFAULT 'new',
    status_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event TEXT NOT NULL,
    device_id TEXT, session_id TEXT,
    is_pwa INTEGER DEFAULT 0, page TEXT,
    data TEXT DEFAULT '{}',
    user_agent TEXT, screen TEXT, lang TEXT, referrer TEXT,
    ts TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS push_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    image TEXT DEFAULT '',
    url TEXT DEFAULT '/',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS blacklisted_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT UNIQUE NOT NULL,
    label TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ══════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════

function getClientIP(req) {
  let ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || '';
  // Normalize IPv6-mapped IPv4 (::ffff:1.2.3.4 → 1.2.3.4)
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function sha256(val) {
  return val ? crypto.createHash('sha256').update(val.trim().toLowerCase()).digest('hex') : '';
}

function isBlacklisted(ip) {
  // Check both raw and normalized
  const row = db.prepare('SELECT 1 FROM blacklisted_ips WHERE ip = ? OR ip = ?').get(ip, '::ffff:' + ip);
  return !!row;
}

function getBlacklistedDeviceIds() {
  const ips = db.prepare('SELECT ip FROM blacklisted_ips').all().map(r => r.ip);
  if (!ips.length) return [];
  const deviceIds = new Set();
  for (const ip of ips) {
    // Match both formats in stored data
    const rows = db.prepare(`SELECT DISTINCT device_id FROM events WHERE 
      json_extract(data, '$.ip') = ? OR json_extract(data, '$.ip') = ? OR json_extract(data, '$.ip') = ?`
    ).all(ip, '::ffff:' + ip, ip.replace(/^::ffff:/, ''));
    rows.forEach(r => { if (r.device_id) deviceIds.add(r.device_id); });
  }
  return [...deviceIds];
}

function getPeriodFilter(period) {
  const now = new Date();
  switch (period) {
    case 'today': {
      const d = now.toISOString().slice(0, 10);
      return { where: `created_at >= '${d}'`, label: 'Today' };
    }
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      const d = y.toISOString().slice(0, 10);
      const t = now.toISOString().slice(0, 10);
      return { where: `created_at >= '${d}' AND created_at < '${t}'`, label: 'Yesterday' };
    }
    case '7d': {
      const d = new Date(now); d.setDate(d.getDate() - 7);
      return { where: `created_at >= '${d.toISOString().slice(0, 10)}'`, label: 'Last 7 Days' };
    }
    case '30d': {
      const d = new Date(now); d.setDate(d.getDate() - 30);
      return { where: `created_at >= '${d.toISOString().slice(0, 10)}'`, label: 'Last 30 Days' };
    }
    case 'month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 1);
      return { where: `created_at >= '${first.toISOString().slice(0, 10)}' AND created_at < '${last.toISOString().slice(0, 10)}'`, label: 'Prev Month' };
    }
    case 'year': {
      return { where: `created_at >= '${now.getFullYear()}-01-01'`, label: 'Year' };
    }
    case 'all':
    default:
      return { where: '1=1', label: 'All Time' };
  }
}

// ══════════════════════════════════════
//  TELEGRAM
// ══════════════════════════════════════

async function sendToTelegram(lead, geoInfo) {
  if (!TG_BOT || !TG_CHAT) return;
  const pwa = lead.is_pwa ? '✅ Да' : '❌ Нет';
  const country = geoInfo?.country_name || geoInfo?.country || '?';
  const ip = geoInfo?.ip || '?';
  const tz = geoInfo?.timezone || '?';

  const lines = [
    `🔔 NEW LEAD — GPT Trade`,
    ``,
    `👤 ДАННЫЕ`,
    `├ Имя: ${lead.first_name || ''} ${lead.last_name || ''}`,
    `├ Email: ${lead.email || '—'}`,
    `├ Phone: ${lead.phone || '—'}`,
    `├ Buyer: ${lead.buyer || TG_BUYER}`,
    `└ Geo: ${lead.geo || TG_GEO}`,
    ``,
    `📊 UTM МЕТКИ`,
    `└ ${formatUTM(lead.utm)}`,
    ``,
    `🖥 УСТРОЙСТВО`,
    `├ PWA: ${pwa}`,
    `└ UA: ${(lead.user_agent || '').slice(0, 80)}`,
    ``,
    `🌐 СЕССИЯ`,
    `├ IP: ${ip}`,
    `├ Страна: ${country}`,
    `├ Timezone: ${tz}`,
    `├ Referrer: ${lead.referrer || '—'}`,
    `└ Landing: ${lead.landing || '—'}`,
    ``,
    `⏰ РЕГИСТРАЦИЯ`,
    `├ Дата: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`,
    `└ Ref: ${lead.lead_id}`
  ];

  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TG_CHAT, text: lines.join('\n'), parse_mode: undefined })
    });
  } catch (e) {
    console.error('TG send error:', e.message);
  }
}

function formatUTM(utm) {
  if (!utm || typeof utm === 'string') {
    try { utm = JSON.parse(utm || '{}'); } catch { return 'Нет UTM'; }
  }
  const parts = [];
  if (utm.utm_source) parts.push(`source: ${utm.utm_source}`);
  if (utm.utm_medium) parts.push(`medium: ${utm.utm_medium}`);
  if (utm.utm_campaign) parts.push(`campaign: ${utm.utm_campaign}`);
  if (utm.utm_content) parts.push(`content: ${utm.utm_content}`);
  if (utm.utm_term) parts.push(`term: ${utm.utm_term}`);
  return parts.length ? parts.join(' / ') : 'Нет UTM';
}

// ══════════════════════════════════════
//  PUSH ENDPOINTS
// ══════════════════════════════════════

app.post('/api/subscribe', (req, res) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'No endpoint' });
    db.prepare('INSERT OR REPLACE INTO subs (endpoint, data) VALUES (?, ?)').run(endpoint, JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/unsubscribe', (req, res) => {
  try {
    const { endpoint } = req.body;
    db.prepare('DELETE FROM subs WHERE endpoint = ?').run(endpoint);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/send', async (req, res) => {
  const { title, body, image, url } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body required' });

  const subs = db.prepare('SELECT * FROM subs').all();
  let sent = 0, errors = 0;
  const toDelete = [];

  for (const sub of subs) {
    try {
      const pushData = JSON.parse(sub.data);
      await webPush.sendNotification(pushData, JSON.stringify({ title, body, image: image || '', url: url || '/' }));
      sent++;
    } catch (e) {
      errors++;
      if (e.statusCode === 404 || e.statusCode === 410) {
        toDelete.push(sub.endpoint);
      }
    }
  }

  // Cleanup dead subs
  if (toDelete.length) {
    const del = db.prepare('DELETE FROM subs WHERE endpoint = ?');
    for (const ep of toDelete) del.run(ep);
  }

  res.json({ ok: true, sent, errors, cleaned: toDelete.length, total: subs.length });
});

// ══════════════════════════════════════
//  LEADS ENDPOINTS
// ══════════════════════════════════════

app.post('/api/lead', async (req, res) => {
  try {
    const d = req.body;
    const geoInfo = d.geo_info || {};

    db.prepare(`INSERT OR IGNORE INTO leads
      (lead_id, first_name, last_name, email, phone, buyer, geo, device_info, geo_info, utm, is_pwa, page_time, referrer, landing, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      d.lead_id, d.first_name, d.last_name, d.email, d.phone,
      d.buyer || TG_BUYER, d.geo || TG_GEO,
      JSON.stringify(d.device_info || {}),
      JSON.stringify(geoInfo),
      JSON.stringify(d.utm || {}),
      d.is_pwa ? 1 : 0,
      d.page_time || 0,
      d.referrer || '', d.landing || '', d.user_agent || ''
    );

    // Forward to Telegram
    sendToTelegram(d, geoInfo);

    res.json({ ok: true, lead_id: d.lead_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/leads', (req, res) => {
  try {
    let sql = 'SELECT * FROM leads WHERE 1=1';
    const params = [];
    if (req.query.buyer) { sql += ' AND buyer = ?'; params.push(req.query.buyer); }
    if (req.query.geo) { sql += ' AND geo = ?'; params.push(req.query.geo); }
    if (req.query.status) { sql += ' AND status = ?'; params.push(req.query.status); }
    sql += ' ORDER BY id DESC';
    if (req.query.limit) { sql += ' LIMIT ?'; params.push(parseInt(req.query.limit)); }
    res.json(db.prepare(sql).all(...params));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/lead/status', (req, res) => {
  try {
    const { lead_id, status } = req.body;
    db.prepare('UPDATE leads SET status = ?, status_updated_at = datetime(?) WHERE lead_id = ?')
      .run(status, new Date().toISOString(), lead_id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  ANALYTICS ENDPOINTS
// ══════════════════════════════════════

app.post('/api/track', (req, res) => {
  try {
    // Handle both application/json and text/plain (sendBeacon)
    let d = req.body;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
    const ip = getClientIP(req);

    // Filter blacklisted IPs
    if (isBlacklisted(ip)) return res.json({ ok: true, filtered: true });

    // Inject IP into data
    let data = d.data || {};
    if (typeof data === 'string') try { data = JSON.parse(data); } catch { data = {}; }
    data.ip = ip;

    db.prepare(`INSERT INTO events (event, device_id, session_id, is_pwa, page, data, user_agent, screen, lang, referrer, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      d.event, d.deviceId, d.sessionId, d.isPWA ? 1 : 0, d.page,
      JSON.stringify(data),
      d.userAgent, d.screen, d.lang, d.referrer, d.timestamp
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analytics', (req, res) => {
  try {
    const period = req.query.period || '7d';
    const { where, label } = getPeriodFilter(period);

    // Build blacklist exclusion
    const blDevices = getBlacklistedDeviceIds();
    const blIPs = db.prepare('SELECT ip FROM blacklisted_ips').all().map(r => r.ip);
    let blWhere = '';
    if (blDevices.length) {
      blWhere += ` AND device_id NOT IN (${blDevices.map(d => `'${d}'`).join(',')})`;
    }
    if (blIPs.length) {
      const ipConditions = blIPs.map(ip => {
        const clean = ip.replace(/^::ffff:/, '');
        return `json_extract(data,'$.ip') != '${clean}' AND json_extract(data,'$.ip') != '::ffff:${clean}' AND json_extract(data,'$.ip') != '${ip}'`;
      }).join(' AND ');
      blWhere += ` AND (${ipConditions})`;
    }

    const ew = `${where}${blWhere}`; // events filter
    const lw = `${where} AND status != 'test'`; // leads filter

    // Overview
    const overview = {
      visitors: db.prepare(`SELECT COUNT(DISTINCT device_id) as c FROM events WHERE event='page_view' AND ${ew}`).get().c,
      pageViews: db.prepare(`SELECT COUNT(*) as c FROM events WHERE event='page_view' AND ${ew}`).get().c,
      gateShown: db.prepare(`SELECT COUNT(*) as c FROM events WHERE event='install_gate_shown' AND ${ew}`).get().c,
      installClicks: db.prepare(`SELECT COUNT(*) as c FROM events WHERE event='install_click' AND ${ew}`).get().c,
      pwaInstalls: db.prepare(`SELECT COUNT(*) as c FROM events WHERE event='pwa_installed' AND ${ew}`).get().c,
      pwaOpens: db.prepare(`SELECT COUNT(*) as c FROM events WHERE event='pwa_open' AND ${ew}`).get().c,
      totalLeads: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE ${lw}`).get().c,
      videoPlays: db.prepare(`SELECT COUNT(*) as c FROM events WHERE event='video_play' AND ${ew}`).get().c,
      videoDone: db.prepare(`SELECT COUNT(*) as c FROM events WHERE event='video_complete' AND ${ew}`).get().c,
      pushSubs: db.prepare('SELECT COUNT(*) as c FROM subs').get().c,
      avgTime: db.prepare(`SELECT AVG(json_extract(data,'$.timeSpent')) as a FROM events WHERE event='page_exit' AND ${ew}`).get().a || 0,
      sessions: db.prepare(`SELECT COUNT(DISTINCT session_id) as c FROM events WHERE ${ew}`).get().c,
    };

    // Funnel (from leads table for accuracy)
    const funnel = {
      gateShown: overview.gateShown,
      installClick: overview.installClicks,
      pwaInstalled: overview.pwaInstalls,
      pwaOpen: overview.pwaOpens,
      nameFilled: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE first_name IS NOT NULL AND first_name != '' AND ${lw}`).get().c,
      phoneFilled: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE phone IS NOT NULL AND phone != '' AND ${lw}`).get().c,
      leadComplete: overview.totalLeads,
      videoPlay: overview.videoPlays,
      videoDone: overview.videoDone,
    };

    // Timeline
    let timeline;
    if (period === 'year') {
      timeline = db.prepare(`SELECT strftime('%Y-%m', created_at) as date, 
        COUNT(CASE WHEN event='page_view' THEN 1 END) as views
        FROM events WHERE ${ew} GROUP BY date ORDER BY date`).all();
      const leadsTimeline = db.prepare(`SELECT strftime('%Y-%m', created_at) as date, COUNT(*) as leads 
        FROM leads WHERE ${lw} GROUP BY date`).all();
      const lMap = Object.fromEntries(leadsTimeline.map(r => [r.date, r.leads]));
      timeline = timeline.map(r => ({ ...r, leads: lMap[r.date] || 0 }));
    } else {
      timeline = db.prepare(`SELECT date(created_at) as date, 
        COUNT(CASE WHEN event='page_view' THEN 1 END) as views
        FROM events WHERE ${ew} GROUP BY date ORDER BY date`).all();
      const leadsTimeline = db.prepare(`SELECT date(created_at) as date, COUNT(*) as leads 
        FROM leads WHERE ${lw} GROUP BY date`).all();
      const lMap = Object.fromEntries(leadsTimeline.map(r => [r.date, r.leads]));
      timeline = timeline.map(r => ({ ...r, leads: lMap[r.date] || 0 }));
    }

    // Geo
    const geo = db.prepare(`SELECT geo, COUNT(*) as count FROM leads WHERE ${lw} GROUP BY geo ORDER BY count DESC`).all();

    // Devices
    const devices = db.prepare(`SELECT 
      CASE 
        WHEN user_agent LIKE '%iPhone%' OR user_agent LIKE '%iPad%' THEN 'iOS'
        WHEN user_agent LIKE '%Android%' THEN 'Android'
        ELSE 'Desktop'
      END as device,
      COUNT(*) as count
      FROM events WHERE event='page_view' AND ${ew} GROUP BY device ORDER BY count DESC`).all();

    // Lead statuses
    const statuses = db.prepare(`SELECT status, COUNT(*) as count FROM leads WHERE ${lw} GROUP BY status`).all();

    res.json({ period: label, overview, funnel, timeline, geo, devices, statuses });
  } catch (e) {
    console.error('Analytics error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    res.json({
      subs: db.prepare('SELECT COUNT(*) as c FROM subs').get().c,
      leads: db.prepare("SELECT COUNT(*) as c FROM leads WHERE status != 'test'").get().c,
      events: db.prepare('SELECT COUNT(*) as c FROM events').get().c,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  FB CAPI PROXY
// ══════════════════════════════════════

app.post('/api/fb-event', async (req, res) => {
  if (!FB_PIXEL_ID || !FB_ACCESS_TOKEN) return res.json({ ok: false, reason: 'FB not configured' });

  try {
    const d = req.body;
    const ip = getClientIP(req);
    const ua = req.headers['user-agent'] || '';

    const userData = {};
    if (d.em) userData.em = [sha256(d.em)];
    if (d.ph) userData.ph = [sha256(d.ph)];
    if (d.fn) userData.fn = [sha256(d.fn)];
    if (d.ln) userData.ln = [sha256(d.ln)];
    userData.client_ip_address = ip;
    userData.client_user_agent = ua;
    if (d.fbc) userData.fbc = d.fbc;
    if (d.fbp) userData.fbp = d.fbp;
    if (d.external_id) userData.external_id = [sha256(d.external_id)];

    const eventData = {
      event_name: d.event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id: d.event_id,
      event_source_url: d.event_source_url,
      action_source: 'website',
      user_data: userData,
    };
    if (d.custom_data) eventData.custom_data = d.custom_data;

    const fbRes = await fetch(
      `https://graph.facebook.com/v21.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [eventData] }),
      }
    );
    const fbData = await fbRes.json();
    res.json({ ok: true, fb: fbData });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
//  PUSH TEMPLATES
// ══════════════════════════════════════

app.get('/api/templates', (req, res) => {
  res.json(db.prepare('SELECT * FROM push_templates ORDER BY id DESC').all());
});

app.post('/api/templates', (req, res) => {
  try {
    const { name, title, body, image, url } = req.body;
    if (!name || !title || !body) return res.status(400).json({ error: 'name, title, body required' });
    const r = db.prepare('INSERT INTO push_templates (name, title, body, image, url) VALUES (?, ?, ?, ?, ?)')
      .run(name, title, body, image || '', url || '/');
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/templates/:id', (req, res) => {
  db.prepare('DELETE FROM push_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ══════════════════════════════════════
//  IP BLACKLIST
// ══════════════════════════════════════

app.get('/api/blacklist', (req, res) => {
  res.json(db.prepare('SELECT * FROM blacklisted_ips ORDER BY id DESC').all());
});

app.post('/api/blacklist', (req, res) => {
  try {
    const { ip, label } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip required' });
    db.prepare('INSERT OR IGNORE INTO blacklisted_ips (ip, label) VALUES (?, ?)').run(ip, label || '');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/blacklist/:id', (req, res) => {
  db.prepare('DELETE FROM blacklisted_ips WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/my-ip', (req, res) => {
  res.json({ ip: getClientIP(req) });
});

// ══════════════════════════════════════
//  RESET / RESTORE STATS
// ══════════════════════════════════════

app.post('/api/reset-stats', (req, res) => {
  if (req.body.confirm !== 'подтвердить') return res.status(400).json({ error: 'Confirmation required' });
  try {
    db.exec('DROP TABLE IF EXISTS events_backup');
    db.exec('CREATE TABLE events_backup AS SELECT * FROM events');
    const count = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
    db.exec('DELETE FROM events');
    res.json({ ok: true, backed_up: count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/restore-stats', (req, res) => {
  try {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events_backup'").get();
    if (!exists) return res.status(400).json({ error: 'No backup found' });
    db.exec('INSERT INTO events SELECT * FROM events_backup');
    db.exec('DROP TABLE events_backup');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/backup-status', (req, res) => {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events_backup'").get();
  if (!exists) return res.json({ hasBackup: false });
  const count = db.prepare('SELECT COUNT(*) as c FROM events_backup').get().c;
  res.json({ hasBackup: true, count });
});

// ══════════════════════════════════════
//  ADMIN & HEALTH
// ══════════════════════════════════════

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/', (req, res) => {
  const stats = {
    status: 'ok',
    brand: 'GPT Trade',
    subs: db.prepare('SELECT COUNT(*) as c FROM subs').get().c,
    leads: db.prepare('SELECT COUNT(*) as c FROM leads').get().c,
    events: db.prepare('SELECT COUNT(*) as c FROM events').get().c,
    uptime: Math.floor(process.uptime()) + 's',
  };
  res.json(stats);
});

// ══════════════════════════════════════
//  START
// ══════════════════════════════════════

app.listen(PORT, () => {
  console.log(`\n🚀 GPT Trade Backend running on port ${PORT}`);
  console.log(`📊 Admin: http://localhost:${PORT}/admin`);
  console.log(`💾 DB: ${path.join(DISK, 'app.db')}`);
  console.log(`📱 TG: ${TG_BOT ? 'configured' : '⚠️ not set'}`);
  console.log(`📈 FB: ${FB_PIXEL_ID ? 'configured' : '⚠️ not set'}`);
  console.log(`🔔 VAPID: ${VAPID_PUBLIC ? 'configured' : '⚠️ not set'}\n`);
});
