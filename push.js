/**
 * GPT Trade — Push Notifications
 * Requests permission after 3 sec, subscribes via VAPID
 */

(function() {
  var BACKEND = '';          // Set backend URL
  var VAPID_PUBLIC = '';     // Set VAPID public key

  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!BACKEND || !VAPID_PUBLIC) return;

  // Only in PWA mode or after 3 sec delay
  var isPWA = window.matchMedia('(display-mode:standalone)').matches || navigator.standalone === true;

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function subscribe() {
    navigator.serviceWorker.ready.then(function(registration) {
      return registration.pushManager.getSubscription().then(function(existing) {
        if (existing) return existing;
        return registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
        });
      });
    }).then(function(subscription) {
      var subJson = subscription.toJSON();
      subJson.deviceId = localStorage.getItem('gt_device_id') || '';
      fetch(BACKEND + '/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subJson)
      }).catch(function() {});
    }).catch(function(e) {
      console.log('Push subscription failed:', e);
    });
  }

  // Request with 3 sec delay
  setTimeout(function() {
    if (Notification.permission === 'granted') {
      subscribe();
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(function(perm) {
        if (perm === 'granted') subscribe();
      });
    }
  }, 3000);

})();
