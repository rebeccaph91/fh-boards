/* Forest Hill boards — service worker for Web Push (issue a18f9eae).
   Canonical source: FIX CLAUDE/dashboards/mobile/sw.js — deployed to the PUBLIC repo
   rebeccaph91/fh-boards root (served at /fh-boards/sw.js, scope /fh-boards/).
   CONTAINS NO SECRETS. The VAPID *public* key lives in index.html (public by design);
   the VAPID *private* key never leaves the server (edge secret). This file only RECEIVES
   pushes the server already sent and renders them — it holds no keys at all. */
'use strict';
const SW_VERSION = 'a18f9eae-1';   // bump to force-activate a new service worker

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// The push payload is server-authored JSON: {title, body, url, tag, count}.
// Render via showNotification (text fields only — never HTML), so nothing the skills
// or the server emit can inject markup into the OS notification.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const title = (typeof d.title === 'string' && d.title) ? d.title : 'Forest Hill boards';
  // tag groups notifications: explicit d.tag wins; else derive per-board from the deep-link hash
  let tag = 'fh-boards';
  if (typeof d.tag === 'string' && d.tag) tag = d.tag;
  else if (typeof d.url === 'string') { const m = d.url.match(/#(\w+)/); if (m) tag = 'fh-' + m[1]; }
  const opts = {
    body: (typeof d.body === 'string') ? d.body : '',
    tag:  tag,  // per-board (so Updates/Follow-ups/Workshop don't clobber each other's notification)
    renotify: true,
    icon: 'icon.png',
    badge: 'icon.png',
    data: { url: (typeof d.url === 'string' && d.url) ? d.url : './' }
  };
  event.waitUntil(self.registration.showNotification(title, opts));
});

// Tapping the notification focuses an open boards tab (deep-linked) or opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      // focus any already-open boards window; nudge it to the right board via hash
      if ('focus' in c) {
        try { if ('navigate' in c && target) await c.navigate(target); } catch (e) {}
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
