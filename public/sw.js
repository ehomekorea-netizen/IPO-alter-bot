self.addEventListener('push', function(event) {
  if (event.data) {
    try {
      const data = event.data.json();
      const title = data.title || 'IPO 청약 알림';
      const options = {
        body: data.body || '오늘의 청약 정보가 있습니다.',
        icon: data.icon || '/icon.png',
        badge: '/icon.png',
        data: {
          url: data.url || '/'
        }
      };
      event.waitUntil(self.registration.showNotification(title, options));
    } catch (e) {
      // Plain text fallback if JSON parsing fails
      const text = event.data.text();
      event.waitUntil(
        self.registration.showNotification('IPO 청약 알림', {
          body: text,
          icon: '/icon.png',
          badge: '/icon.png'
        })
      );
    }
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      // If a window is already open, focus it
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
