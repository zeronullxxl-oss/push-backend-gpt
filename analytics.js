/**
 * GPT Trade — Analytics
 * Auto-tracks page views, PWA events, funnel steps
 * Manual API: trackInstallClick, trackFunnelStep, trackVideoPlay, etc.
 */

(function() {
  var BACKEND = 'https://push-backend-gpt.onrender.com';

  // ═══ IDs ═══
  function getDeviceId() {
    var id = localStorage.getItem('gt_device_id');
    if (!id) { id = 'dev_' + Math.random().toString(36).slice(2, 12); localStorage.setItem('gt_device_id', id); }
    return id;
  }
  function getSessionId() {
    var id = sessionStorage.getItem('gt_session_id');
    if (!id) { id = 'ses_' + Math.random().toString(36).slice(2, 12); sessionStorage.setItem('gt_session_id', id); }
    return id;
  }

  var deviceId = getDeviceId();
  var sessionId = getSessionId();
  var isPWA = window.matchMedia('(display-mode:standalone)').matches || navigator.standalone === true;

  // ═══ SEND ═══
  function track(event, data) {
    if (!BACKEND) return;
    var payload = {
      event: event,
      deviceId: deviceId,
      sessionId: sessionId,
      isPWA: isPWA,
      page: window.location.pathname,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      screen: screen.width + 'x' + screen.height,
      lang: navigator.language,
      referrer: document.referrer || '',
      data: data || {}
    };
    try {
      fetch(BACKEND + '/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function() {});
    } catch(e) {}
  }

  function beacon(event, data) {
    if (!BACKEND) return;
    var payload = {
      event: event, deviceId: deviceId, sessionId: sessionId,
      isPWA: isPWA, page: window.location.pathname,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      screen: screen.width + 'x' + screen.height,
      lang: navigator.language, referrer: document.referrer || '',
      data: data || {}
    };
    try {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(BACKEND + '/api/track', blob);
    } catch(e) {}
  }

  // ═══ DEDUP ═══
  function trackOnce(event, data) {
    var key = 'gt_ev_' + event;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    track(event, data);
  }
  function trackOnceDevice(event, data) {
    var key = 'gt_dev_' + event;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    track(event, data);
  }

  // ═══ AUTO EVENTS ═══
  // Page view — every load (normal analytics)
  track('page_view');

  // PWA open — once per session
  if (isPWA) trackOnce('pwa_open');

  // Install gate shown — once per device (not per refresh)
  var isMobile = /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
  if (isMobile && !isPWA) trackOnceDevice('install_gate_shown');

  // beforeinstallprompt
  window.addEventListener('beforeinstallprompt', function() {
    track('install_prompt_available');
  });

  // appinstalled — once per device
  window.addEventListener('appinstalled', function() {
    trackOnceDevice('pwa_installed');
  });

  // PWA resumed — max once per 5 min
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && isPWA) {
      var key = 'gt_resumed_ts';
      var last = parseInt(sessionStorage.getItem(key) || '0');
      if (Date.now() - last > 300000) {
        sessionStorage.setItem(key, Date.now().toString());
        track('pwa_resumed');
      }
    }
  });

  // Page exit with time spent
  var pageStart = Date.now();
  window.addEventListener('beforeunload', function() {
    var timeSpent = Math.round((Date.now() - pageStart) / 1000);
    beacon('page_exit', { timeSpent: timeSpent });
  });

  // ═══ MANUAL API ═══
  window.trackInstallClick = function() {
    trackOnceDevice('install_click');
  };

  window.trackFunnelStep = function(step, data) {
    track(step, data || {});
  };

  window.trackVideoPlay = function() {
    track('video_play');
  };

  window.trackVideoComplete = function() {
    track('video_complete');
  };

  window.trackPlatformAction = function(action, data) {
    track('platform_' + action, data || {});
  };

})();
