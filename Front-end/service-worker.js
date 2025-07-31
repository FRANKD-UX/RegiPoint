const CACHE_NAME = 'regapp-v1';
const urlsToCache = [
  '/',
  '/index.html',
  'https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.0/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.0/js/bootstrap.bundle.min.js'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve cached content when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        if (response) {
          return response;
        }
        return fetch(event.request).catch(() => {
          // If both cache and network fail, return offline page
          if (event.request.destination === 'document') {
            return caches.match('/');
          }
        });
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Background sync for queued uploads
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(processUploadQueue());
  }
});

async function processUploadQueue() {
  try {
    // Get queued items from IndexedDB or localStorage
    const queueItems = JSON.parse(localStorage.getItem('uploadQueue') || '[]');
    
    for (const item of queueItems) {
      try {
        // Process each queued item
        if (item.type === 'document') {
          await uploadQueuedDocument(item);
        } else if (item.type === 'application') {
          await submitQueuedApplication(item);
        }
      } catch (error) {
        console.error('Failed to process queue item:', error);
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

async function uploadQueuedDocument(item) {
  const formData = new FormData();
  
  // Convert base64 back to file
  const response = await fetch(item.file.data);
  const blob = await response.blob();
  const file = new File([blob], item.file.name, { type: item.file.type });
  
  formData.append('file', file);
  formData.append('document_type', item.documentInfo.type);
  
  if (item.documentInfo.expiryDate) {
    const expiryDays = Math.ceil((new Date(item.documentInfo.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
    formData.append('expiry_days', expiryDays.toString());
  }
  
  return fetch('/api/documents', {
    method: 'POST',
    body: formData
  });
}

async function submitQueuedApplication(item) {
  return fetch('/api/applications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(item.data)
  });
}