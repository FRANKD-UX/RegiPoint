const CACHE_NAME = 'regapp-v3-api'; // New version name to force update
const API_BASE_URL = 'http://localhost:5000/api'; // Must match the frontend
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/script.js',
  'https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.0/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.0/js/bootstrap.bundle.min.js'
];

// --- IndexedDB Helper (needed for the Service Worker context) ---
// This is a minimal version. In a real app, this would be in a shared script.
const dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('RegAppDB', 1);
    request.onerror = () => reject("Error opening DB");
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('uploadQueue')) {
            db.createObjectStore('uploadQueue', { keyPath: 'id' });
        }
    };
});

// --- Service Worker Lifecycle Events ---

self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    // Strategy: Network falling back to Cache.
    // For API calls, always try the network first.
    if (event.request.url.startsWith(API_BASE_URL)) {
        event.respondWith(
            fetch(event.request).catch(() => {
                // If an API call fails, return a generic error response.
                return new Response(JSON.stringify({ error: 'API is offline' }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // For non-API requests (app shell files), use Cache falling back to Network.
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});


// --- Background Sync Event ---

self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    console.log('Service Worker: Background sync triggered!');
    event.waitUntil(processQueue());
  }
});

async function processQueue() {
    const db = await dbPromise;
    const tx = db.transaction('uploadQueue', 'readonly');
    const store = tx.objectStore('uploadQueue');
    const queueItems = await store.getAll();

    if (queueItems.length === 0) {
        console.log('Service Worker: Upload queue is empty.');
        return;
    }

    console.log('Service Worker: Processing', queueItems.length, 'items from the queue.');
    
    try {
        // Send the entire queue to the backend in one go.
        const response = await fetch(`${API_BASE_URL}/process-queue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queue_items: queueItems })
        });

        if (!response.ok) {
            throw new Error('Server failed to process the queue.');
        }

        const result = await response.json();

        // If server call is successful, clear the queue.
        console.log('Service Worker: Queue successfully processed by server.', result);
        const writeTx = db.transaction('uploadQueue', 'readwrite');
        await writeTx.objectStore('uploadQueue').clear();
        await writeTx.done;
        
        // Notify open clients that the sync is complete so they can refresh UI.
        const clients = await self.clients.matchAll();
        clients.forEach(client => client.postMessage({ type: 'QUEUE_PROCESSED' }));

    } catch (error) {
        console.error('Service Worker: Failed to process queue.', error);
        // Optional: Do not clear the queue if the server fails, so it can be retried.
    }
}