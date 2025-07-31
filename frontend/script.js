// frontend/script.js (Final Version for Single-Server Deployment)

// --- Database Helper for IndexedDB ---
// A more robust way to handle offline data than localStorage for Service Workers.
class DBHelper {
    constructor(dbName = 'RegAppDB', storeName = 'uploadQueue') {
        this.dbName = dbName;
        this.storeName = storeName;
        this.dbPromise = this.openDb();
    }

    openDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onerror = () => reject("Error opening DB");
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id' });
                }
            };
        });
    }

    async addToQueue(item) {
        const db = await this.dbPromise;
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put(item);
        return tx.done;
    }

    async getQueue() {
        const db = await this.dbPromise;
        return db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAll();
    }

    async clearQueue() {
        const db = await this.dbPromise;
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).clear();
        return tx.done;
    }
}


// --- Main PWA Application Class ---
class RegApp {
    constructor() {
        this.currentUser = null;
        this.isOnline = navigator.onLine;
        this.dbHelper = new DBHelper();
        
        // =================================================================== #
        // THE ONLY CHANGE NEEDED FOR THE SINGLE-SERVER SETUP IS THIS ONE LINE:
        this.API_BASE_URL = '/api'; // This is now a relative path.
        // =================================================================== #

        this.init();
    }

    async init() {
        this.registerServiceWorker();
        this.setupEventListeners();
        this.updateOnlineStatus();
        await this.updateQueueIndicator();
        await this.checkLoginStatus();
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js')
              .then(reg => {
                console.log('Service Worker registered successfully.');
                navigator.serviceWorker.addEventListener('message', event => {
                    if (event.data && event.data.type === 'QUEUE_PROCESSED') {
                        console.log('Queue processed, refreshing documents.');
                        this.fetchDocuments();
                        this.updateQueueIndicator();
                    }
                });
              })
              .catch(err => console.error('Service Worker registration failed:', err));
        }
    }

    setupEventListeners() {
        window.addEventListener('online', () => { this.isOnline = true; this.updateOnlineStatus(); });
        window.addEventListener('offline', () => { this.isOnline = false; this.updateOnlineStatus(); });
        document.getElementById('loginForm').addEventListener('submit', (e) => { e.preventDefault(); this.handleLogin(); });
        document.getElementById('logoutBtn').addEventListener('click', () => { this.logout(); });
        document.getElementById('backToHome').addEventListener('click', () => { this.showHome(); });
        document.getElementById('applicationForm').addEventListener('submit', (e) => { e.preventDefault(); this.handleFormSubmit(); });
        document.querySelectorAll('.company-circle').forEach(circle => {
            circle.addEventListener('click', (e) => { this.openForm(e.currentTarget.dataset.company, e.currentTarget.dataset.country); });
        });
        document.getElementById('ussdAutofillBtn').addEventListener('click', () => { this.simulateUSSDFill(); });
        document.querySelectorAll('.document-upload').forEach(input => {
            input.addEventListener('change', (e) => { this.handleDocumentUpload(e); });
        });
    }

    updateOnlineStatus() {
        document.getElementById('offlineIndicator').style.display = this.isOnline ? 'none' : 'block';
    }

    async updateQueueIndicator() {
        const queue = await this.dbHelper.getQueue();
        const indicator = document.getElementById('queueIndicator');
        const count = document.getElementById('queueCount');
        if (queue.length > 0) {
            count.textContent = `${queue.length} items queued`;
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    }
    
    // --- API-Driven Methods ---
    // All fetch calls will now correctly use the relative '/api' path.

    async handleLogin() {
        const phone = document.getElementById('phoneNumber').value;
        const pin = document.getElementById('pin').value;
        const errorDiv = document.getElementById('loginError');

        try {
            const response = await fetch(`${this.API_BASE_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, pin }),
                credentials: 'include' // Still good practice for sessions
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Login failed');
            
            this.currentUser = data.user;
            errorDiv.classList.add('hidden');
            this.showHome();
            await this.fetchDocuments();
        } catch (error) {
            errorDiv.textContent = error.message;
            errorDiv.classList.remove('hidden');
        }
    }

    async logout() {
        await fetch(`${this.API_BASE_URL}/logout`, { method: 'POST', credentials: 'include' });
        this.currentUser = null;
        this.showLogin();
    }
    
    async checkLoginStatus() {
        try {
            const response = await fetch(`${this.API_BASE_URL}/documents`, { credentials: 'include' });
            if (!response.ok) throw new Error('Not logged in');
            const data = await response.json();
            this.showHome();
            this.updateDocumentStatus(data.documents);
        } catch(e) {
            this.showLogin();
        }
    }

    async handleDocumentUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const documentInfo = { type: event.target.name, expiryDays: parseInt(event.target.dataset.expires) || 0 };

        if (this.isOnline) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('document_type', documentInfo.type);
            formData.append('expiry_days', String(documentInfo.expiryDays));
            
            try {
                const response = await fetch(`${this.API_BASE_URL}/documents`, {
                    method: 'POST', body: formData, credentials: 'include'
                });
                if (!response.ok) throw new Error('Upload failed');
                alert('Document uploaded successfully');
                await this.fetchDocuments();
            } catch (error) {
                alert(error.message);
            }
        } else {
            await this.queueDocument(file, documentInfo);
        }
    }
    
    async queueDocument(file, documentInfo) {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const queueItem = {
                id: `doc_${Date.now()}`, type: 'document', user_id: this.currentUser.id,
                file: { name: file.name, type: file.type, data: reader.result },
                documentInfo
            };
            await this.dbHelper.addToQueue(queueItem);
            await this.updateQueueIndicator();
            await this.registerBackgroundSync();
            alert('You are offline. Document has been queued for upload.');
        };
    }

    async fetchDocuments() {
        try {
            const response = await fetch(`${this.API_BASE_URL}/documents`, { credentials: 'include' });
            if (!response.ok) throw new Error('Could not fetch documents');
            const data = await response.json();
            this.updateDocumentStatus(data.documents);
        } catch (error) {
            console.error(error);
        }
    }

    updateDocumentStatus(documents = []) {
        const statusDiv = document.getElementById('documentStatus');
        if (documents.length === 0) {
            statusDiv.innerHTML = '<p class="text-muted">No documents uploaded yet.</p>';
            return;
        }
        let html = '';
        documents.forEach(doc => {
            const statusClass = doc.expiry_status === 'expired' ? 'expired' : doc.expiry_status === 'expiring' ? 'expiring' : 'valid';
            const statusText = doc.expiry_status === 'expired' ? 'Expired' : doc.expiry_status === 'expiring' ? `Expires in ${doc.days_until_expiry} days` : 'Valid';
            html += `
                <div class="d-flex align-items-center mb-2">
                    <span class="status-indicator status-${statusClass}"></span>
                    <span>${doc.document_type}: ${doc.filename}</span>
                    <small class="text-muted ms-auto">${statusText}</small>
                </div>`;
        });
        statusDiv.innerHTML = html;
    }

    async handleFormSubmit() {
        const form = document.getElementById('applicationForm');
        const formData = new FormData(form);
        const data = {};
        for (let [key, value] of formData.entries()) {
            if (!(value instanceof File)) { data[key] = value; }
        }
        const submissionData = {
            company: this.currentCompany, country: this.currentCountry, form_data: data
        };

        if (this.isOnline) {
             try {
                const response = await fetch(`${this.API_BASE_URL}/applications`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(submissionData), credentials: 'include'
                });
                if (!response.ok) throw new Error('Application submission failed.');
                alert('Application submitted successfully!');
                this.showHome();
            } catch (error) {
                alert(error.message);
            }
        } else {
             const queueItem = {
                id: `app_${Date.now()}`, type: 'application', user_id: this.currentUser.id,
                ...submissionData
             };
             await this.dbHelper.addToQueue(queueItem);
             await this.updateQueueIndicator();
             await this.registerBackgroundSync();
             alert('You are offline. Application queued for submission.');
             this.showHome();
        }
    }
    
    async registerBackgroundSync() {
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            const registration = await navigator.serviceWorker.ready;
            try {
                await registration.sync.register('background-sync');
                console.log('Background sync registered');
            } catch (err) {
                console.error('Background sync could not be registered!', err);
            }
        }
    }

    // --- Unchanged Methods ---
    // (These functions from your original script did not need any changes)
    showLogin() {
        document.getElementById('loginPage').classList.remove('hidden');
        document.getElementById('homePage').classList.add('hidden');
        document.getElementById('formPage').classList.add('hidden');
    }
    showHome() {
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('homePage').classList.remove('hidden');
        document.getElementById('formPage').classList.add('hidden');
    }
    showForm() {
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('homePage').classList.add('hidden');
        document.getElementById('formPage').classList.remove('hidden');
    }
    openForm(company, country) {
        this.currentCompany = company;
        this.currentCountry = country;
        // ... (The rest of your openForm logic is fine)
        this.showForm();
    }
    async simulateUSSDFill() {
        try {
            const response = await fetch(`${this.API_BASE_URL}/ussd`, { method: 'POST', credentials: 'include' });
            const data = await response.json();
            if (!response.ok) throw new Error('USSD fill failed');
            
            const form = document.getElementById('applicationForm');
            Object.keys(data.data).forEach(key => {
                const input = form.querySelector(`[name="${key}"]`);
                if (input) { input.value = data.data[key]; }
            });
            alert('Form auto-filled with demo USSD data.');
        } catch (error) {
            alert(error.message);
        }
    }
}


// --- CIDB Profile Class (Unchanged for this fix) ---
class CIDBProfile {
    // ... all your existing CIDBProfile code can remain here ...
}


// --- Smart Initializer (Unchanged) ---
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('loginPage')) {
        new RegApp();
    }
    if (document.getElementById('personalForm')) {
        // new CIDBProfile(); // You can uncomment this when working on the profile page
    }
});