/**
 * GPT Trade — Facebook Pixel + CAPI
 * Events: PageView, Purchase, Lead, ViewContent
 * Deduplication via event_id
 */

(function() {
  var FB_PIXEL_ID = ''; // Set your pixel ID
  var BACKEND = '';      // Set backend URL for CAPI

  // ═══ PIXEL INIT ═══
  if (FB_PIXEL_ID && typeof fbq !== 'undefined') {
    fbq('init', FB_PIXEL_ID);
    fbq('track', 'PageView');
  }

  // ═══ fbclid storage ═══
  (function() {
    var params = new URLSearchParams(window.location.search);
    var fbclid = params.get('fbclid');
    if (fbclid) {
      var fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      localStorage.setItem('_fbc', fbc);
      document.cookie = '_fbc=' + fbc + ';path=/;max-age=7776000';
    }
  })();

  function getEventId() {
    return 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function getFbc() { return localStorage.getItem('_fbc') || ''; }
  function getFbp() {
    var match = document.cookie.match(/_fbp=([^;]+)/);
    return match ? match[1] : '';
  }

  // ═══ CAPI send ═══
  function sendCAPI(eventName, eventId, userData, customData) {
    if (!BACKEND) return;
    var payload = {
      event_name: eventName,
      event_id: eventId,
      event_source_url: window.location.href,
      fbc: getFbc(),
      fbp: getFbp(),
      external_id: localStorage.getItem('gt_device_id') || ''
    };
    if (userData) {
      if (userData.email) payload.em = userData.email;
      if (userData.phone) payload.ph = userData.phone;
      if (userData.firstName) payload.fn = userData.firstName;
      if (userData.lastName) payload.ln = userData.lastName;
    }
    if (customData) payload.custom_data = customData;
    try {
      fetch(BACKEND + '/api/fb-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function() {});
    } catch(e) {}
  }

  // ═══ PUBLIC API ═══

  // Purchase (PWA installed)
  window.fbTrackPurchase = function() {
    var eid = getEventId();
    if (FB_PIXEL_ID && typeof fbq !== 'undefined') {
      fbq('track', 'Purchase', { value: 1, currency: 'USD' }, { eventID: eid });
    }
    sendCAPI('Purchase', eid, null, { value: 1, currency: 'USD' });
  };

  // Lead (form submitted)
  window.fbTrackLead = function(data) {
    var eid = getEventId();
    if (FB_PIXEL_ID && typeof fbq !== 'undefined') {
      fbq('track', 'Lead', {}, { eventID: eid });
    }
    sendCAPI('Lead', eid, {
      email: data.email || data.f3 || '',
      phone: data.phone || data.f4 || '',
      firstName: data.firstName || data.f1 || '',
      lastName: data.lastName || data.f2 || ''
    });
  };

  // ViewContent (platform page)
  window.fbTrackViewContent = function(contentName) {
    var eid = getEventId();
    if (FB_PIXEL_ID && typeof fbq !== 'undefined') {
      fbq('track', 'ViewContent', { content_name: contentName }, { eventID: eid });
    }
    sendCAPI('ViewContent', eid, null, { content_name: contentName });
  };

})();
