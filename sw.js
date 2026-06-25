/* Forest Hill boards — service worker for Web Push (issue a18f9eae).
   Canonical source: FIX CLAUDE/dashboards/mobile/sw.js — deployed to the PUBLIC repo
   rebeccaph91/fh-boards root (served at /fh-boards/sw.js, scope /fh-boards/).
   CONTAINS NO SECRETS. The VAPID *public* key lives in index.html (public by design);
   the VAPID *private* key never leaves the server (edge secret). This file only RECEIVES
   pushes the server already sent and renders them — it holds no keys at all. */
'use strict';
const SW_VERSION = '99a2fa1e-1';   // bump to force-activate a new service worker

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

// Tapping the notification focuses an open BOARDS tab (deep-linked) or opens one. The board runs on the
// SHARED rebeccaph91.github.io origin, so we must NOT grab just any window — only windows under /fh-boards/.
const APP_ORIGIN = 'https://rebeccaph91.github.io';
const APP_BASE   = APP_ORIGIN + '/fh-boards/';
// Clamp any payload/server-supplied target to within /fh-boards/ (keep its hash); else fall back to root.
// A RELATIVE target (no scheme, not protocol-relative) resolves against the SW scope (= APP_BASE = /fh-boards/),
// so it is inherently in-scope — we keep it AS SENT (e.g. './#followups' stays './#followups') after rejecting
// any '..' traversal that could climb out of /fh-boards/. Only ABSOLUTE targets need origin+scope validation,
// which uses URL when present. This is URL-free for the common deep-link path, so it also works where URL is
// unavailable (the a18f9eae sw.js test sandbox), where the old code silently fell back to root and dropped the hash.
function clampTarget(raw) {
  if (typeof raw !== 'string' || !raw) return APP_BASE;
  if (raw.charAt(0) === '#') return APP_BASE + raw;                 // bare hash -> anchor on base
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);              // http:, javascript:, data: ...
  const protoRel  = raw.slice(0, 2) === '//';                      // //evil.com/...
  if (!hasScheme && !protoRel) {                                    // relative -> in-scope by construction
    return raw.indexOf('..') === -1 ? raw : APP_BASE;              // ...unless it path-traverses out
  }
  if (typeof URL === 'function') {                                 // absolute -> validate origin + scope
    try {
      const u = new URL(raw, APP_BASE);
      if (u.origin === APP_ORIGIN && u.pathname.indexOf('/fh-boards/') === 0) return raw;
    } catch (e) {}
  }
  return APP_BASE;
}
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = clampTarget((event.notification.data && event.notification.data.url) || APP_BASE);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (typeof c.url === 'string' && c.url.indexOf('/fh-boards/') !== -1 && 'focus' in c) {
        try { if ('navigate' in c && target) await c.navigate(target); } catch (e) {}
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});

/* pushsubscriptionchange (issue 99a2fa1e): the push service can silently rotate/expire a subscription.
   Re-subscribe with the SAME VAPID public key, then get the new subscription persisted via the authed
   dash_push_subscribe RPC. The SW has no Supabase session, so it postMessages an open /fh-boards/ client;
   if none is open it stashes the subscription in Cache for the page to drain on next authed load. */
const VAPID_PUBLIC = 'BDNKaeyr2QWObmUy7LNeOFnyz3zRr3CpdI8EdwiY2t5Axljq3nO_sHGDjR4bio0M8QWsqKvhNdGg4iUgKXnY0Ik';
const PUSH_STASH_CACHE = 'fh-push-stash';
const PUSH_STASH_URL   = '/fh-boards/__push_resub';   // synthetic cache key; never fetched over the network
function vapidKeyToU8(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    let sub = null;
    try {
      sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: (event.newSubscription && event.newSubscription.options &&
                               event.newSubscription.options.applicationServerKey) || vapidKeyToU8(VAPID_PUBLIC)
      });
    } catch (e) { return; }
    if (!sub) return;
    const j = sub.toJSON(); j.resubscribed_at = new Date().toISOString();
    const msg = { type: 'push-resubscribed', sub: j };
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const boards = clients.filter((c) => typeof c.url === 'string' && c.url.indexOf('/fh-boards/') !== -1);
    if (boards.length) { for (const c of boards) { try { c.postMessage(msg); } catch (e) {} } return; }
    try {
      const cache = await caches.open(PUSH_STASH_CACHE);
      await cache.put(PUSH_STASH_URL, new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } }));
    } catch (e) {}
  })());
});
