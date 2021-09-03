importScripts('workbox-sw.prod.v2.1.3.js');
importScripts('/javascripts/indexeddb/idb.js');
importScripts('/javascripts/indexeddb/utility.js');

const workboxSW = new self.WorkboxSW();

// installing and activating
self.addEventListener('install', function (event) {
  // console.log('[Service Worker] Installing Service Worker ...', event);
});

self.addEventListener('activate', function (event) {
  // console.log('[Service Worker] Activating Service Worker');
  return self.clients.claim();
});
