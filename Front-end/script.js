// PWA App Class
        class RegApp {
            constructor() {
                this.currentUser = null;
                this.isOnline = navigator.onLine;
                this.uploadQueue = JSON.parse(localStorage.getItem('uploadQueue') || '[]');
                this.documents = JSON.parse(localStorage.getItem('documents') || '{}');
                this.init();
            }

            init() {
                this.registerServiceWorker();
                this.setupEventListeners();
                this.updateOnlineStatus();
                this.updateQueueIndicator();
                this.checkDocumentExpiry();
                this.loadSavedData();
            }

            registerServiceWorker() {
                if ('serviceWorker' in navigator) {
                    const swCode = `
                        const CACHE_NAME = 'regapp-v1';
                        const urlsToCache = ['/'];
                        
                        self.addEventListener('install', event => {
                            event.waitUntil(
                                caches.open(CACHE_NAME)
                                    .then(cache => cache.addAll(urlsToCache))
                            );
                        });
                        
                        self.addEventListener('fetch', event => {
                            event.respondWith(
                                caches.match(event.request)
                                    .then(response => {
                                        if (response) return response;
                                        return fetch(event.request);
                                    })
                            );
                        });
                    `;
                    
                    const blob = new Blob([swCode], { type: 'application/javascript' });
                    const swUrl = URL.createObjectURL(blob);
                    
                    navigator.serviceWorker.register(swUrl);
                }
            }

            setupEventListeners() {
                // Online/Offline detection
                window.addEventListener('online', () => {
                    this.isOnline = true;
                    this.updateOnlineStatus();
                    this.processUploadQueue();
                });
                
                window.addEventListener('offline', () => {
                    this.isOnline = false;
                    this.updateOnlineStatus();
                });

                // Login form
                document.getElementById('loginForm').addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.handleLogin();
                });

                // Logout
                document.getElementById('logoutBtn').addEventListener('click', () => {
                    this.logout();
                });

                // Company selection
                document.querySelectorAll('.company-circle').forEach(circle => {
                    circle.addEventListener('click', (e) => {
                        const company = e.currentTarget.dataset.company;
                        const country = e.currentTarget.dataset.country;
                        this.openForm(company, country);
                    });
                });

                // Back to home
                document.getElementById('backToHome').addEventListener('click', () => {
                    this.showHome();
                });

                // Application form
                document.getElementById('applicationForm').addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.handleFormSubmit();
                });

                // USSD fill buttons
                document.querySelectorAll('.ussd-fill').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        this.simulateUSSDFill(e.target.dataset.field);
                    });
                });

                // Document uploads
                document.querySelectorAll('.document-upload').forEach(input => {
                    input.addEventListener('change', (e) => {
                        this.handleDocumentUpload(e);
                    });
                });
            }

            updateOnlineStatus() {
                const indicator = document.getElementById('offlineIndicator');
                if (this.isOnline) {
                    indicator.style.display = 'none';
                } else {
                    indicator.style.display = 'block';
                }
            }

            updateQueueIndicator() {
                const indicator = document.getElementById('queueIndicator');
                const count = document.getElementById('queueCount');
                
                if (this.uploadQueue.length > 0) {
                    count.textContent = `${this.uploadQueue.length} items queued`;
                    indicator.style.display = 'block';
                } else {
                    indicator.style.display = 'none';
                }
            }

            handleLogin() {
                const phone = document.getElementById('phoneNumber').value;
                const pin = document.getElementById('pin').value;
                const errorDiv = document.getElementById('loginError');

                // Simple demo authentication
                if (phone === '+2341234567890' && pin === '1234') {
                    this.currentUser = { phone, name: 'Demo User' };
                    localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
                    this.showHome();
                    errorDiv.classList.add('hidden');
                } else {
                    errorDiv.textContent = 'Invalid credentials. Use demo: +2341234567890, PIN: 1234';
                    errorDiv.classList.remove('hidden');
                }
            }

            logout() {
                this.currentUser = null;
                localStorage.removeItem('currentUser');
                this.showLogin();
            }

            showLogin() {
                document.getElementById('loginPage').classList.remove('hidden');
                document.getElementById('homePage').classList.add('hidden');
                document.getElementById('formPage').classList.add('hidden');
            }

            showHome() {
                document.getElementById('loginPage').classList.add('hidden');
                document.getElementById('homePage').classList.remove('hidden');
                document.getElementById('formPage').classList.add('hidden');
                this.updateDocumentStatus();
            }

            showForm() {
                document.getElementById('loginPage').classList.add('hidden');
                document.getElementById('homePage').classList.add('hidden');
                document.getElementById('formPage').classList.remove('hidden');
            }

            openForm(company, country) {
                const titles = {
                    'cac': 'CAC Nigeria Registration',
                    'cipc': 'CIPC South Africa Registration',
                    'rdb': 'RDB Rwanda Registration',
                    'gra': 'GRA Ghana Registration'
                };
                
                document.getElementById('formTitle').textContent = titles[company] || 'Application Form';
                this.currentCompany = company;
                this.currentCountry = country;
                this.showForm();
                this.loadFormData();
            }

            loadFormData() {
                const savedData = JSON.parse(localStorage.getItem('formData') || '{}');
                const form = document.getElementById('applicationForm');
                
                Object.keys(savedData).forEach(key => {
                    const input = form.querySelector(`[name="${key}"]`);
                    if (input && input.type !== 'file') {
                        input.value = savedData[key];
                    }
                });
            }

            saveFormData() {
                const form = document.getElementById('applicationForm');
                const formData = new FormData(form);
                const data = {};
                
                for (let [key, value] of formData.entries()) {
                    if (value instanceof File) continue; // Skip files
                    data[key] = value;
                }
                
                localStorage.setItem('formData', JSON.stringify(data));
            }

            simulateUSSDFill(fieldName) {
                if (!this.isOnline) {
                    const demoData = {
                        'fullName': 'John Doe',
                        'idNumber': '1234567890123'
                    };
                    
                    const input = document.querySelector(`[name="${fieldName}"]`);
                    if (input && demoData[fieldName]) {
                        input.value = demoData[fieldName];
                        alert(`USSD data filled: ${demoData[fieldName]}`);
                    }
                }
            }

            handleDocumentUpload(event) {
                const file = event.target.files[0];
                if (!file) return;

                const documentType = event.target.name;
                const expiryDays = parseInt(event.target.dataset.expires) || 0;
                
                const documentInfo = {
                    name: file.name,
                    type: documentType,
                    uploadDate: new Date().toISOString(),
                    expiryDate: expiryDays > 0 ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString() : null,
                    status: 'pending'
                };

                if (this.isOnline) {
                    this.uploadDocument(file, documentInfo);
                } else {
                    this.queueDocument(file, documentInfo);
                }
            }

            queueDocument(file, documentInfo) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    const queueItem = {
                        id: Date.now(),
                        file: {
                            name: file.name,
                            type: file.type,
                            data: e.target.result
                        },
                        documentInfo
                    };
                    
                    this.uploadQueue.push(queueItem);
                    localStorage.setItem('uploadQueue', JSON.stringify(this.uploadQueue));
                    this.updateQueueIndicator();
                    
                    alert('Document queued for upload when online');
                };
                reader.readAsDataURL(file);
            }

            uploadDocument(file, documentInfo) {
                // Simulate upload
                setTimeout(() => {
                    documentInfo.status = 'uploaded';
                    this.documents[documentInfo.type] = documentInfo;
                    localStorage.setItem('documents', JSON.stringify(this.documents));
                    alert('Document uploaded successfully');
                    this.updateDocumentStatus();
                }, 1000);
            }

            processUploadQueue() {
                if (this.uploadQueue.length === 0) return;

                this.uploadQueue.forEach(item => {
                    // Simulate processing queued uploads
                    setTimeout(() => {
                        item.documentInfo.status = 'uploaded';
                        this.documents[item.documentInfo.type] = item.documentInfo;
                    }, 500);
                });

                this.uploadQueue = [];
                localStorage.setItem('uploadQueue', JSON.stringify(this.uploadQueue));
                localStorage.setItem('documents', JSON.stringify(this.documents));
                this.updateQueueIndicator();
                this.updateDocumentStatus();
            }

            updateDocumentStatus() {
                const statusDiv = document.getElementById('documentStatus');
                const docs = Object.values(this.documents);
                
                if (docs.length === 0) {
                    statusDiv.innerHTML = '<p class="text-muted">No documents uploaded yet.</p>';
                    return;
                }

                let html = '';
                docs.forEach(doc => {
                    const status = this.getDocumentStatus(doc);
                    html += `
                        <div class="d-flex align-items-center mb-2">
                            <span class="status-indicator status-${status.class}"></span>
                            <span>${doc.type}: ${doc.name}</span>
                            <small class="text-muted ms-auto">${status.text}</small>
                        </div>
                    `;
                });
                
                statusDiv.innerHTML = html;
            }

            getDocumentStatus(doc) {
                if (!doc.expiryDate) {
                    return { class: 'valid', text: 'No expiry' };
                }

                const now = new Date();
                const expiry = new Date(doc.expiryDate);
                const daysUntilExpiry = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

                if (daysUntilExpiry < 0) {
                    return { class: 'expired', text: 'Expired' };
                } else if (daysUntilExpiry <= 7) {
                    return { class: 'expiring', text: `Expires in ${daysUntilExpiry} days` };
                } else {
                    return { class: 'valid', text: `Valid for ${daysUntilExpiry} days` };
                }
            }

            checkDocumentExpiry() {
                Object.values(this.documents).forEach(doc => {
                    const status = this.getDocumentStatus(doc);
                    if (status.class === 'expiring' || status.class === 'expired') {
                        // Would show notification in real app
                        console.log(`Document ${doc.type} needs renewal`);
                    }
                });
            }

            handleFormSubmit() {
                this.saveFormData();
                
                if (this.isOnline) {
                    this.submitApplication();
                } else {
                    this.queueApplication();
                }
            }

            submitApplication() {
                alert('Application submitted successfully!');
                this.showHome();
            }

            queueApplication() {
                alert('Application queued for submission when online');
                this.showHome();
            }

            loadSavedData() {
                const savedUser = localStorage.getItem('currentUser');
                if (savedUser) {
                    this.currentUser = JSON.parse(savedUser);
                    this.showHome();
                } else {
                    this.showLogin();
                }
            }
        }

        // Initialize the app
        document.addEventListener('DOMContentLoaded', () => {
            new RegApp();
        });