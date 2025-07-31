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

        // CIDB Profile App Class
        class CIDBProfile {
            constructor() {
                this.profileData = JSON.parse(localStorage.getItem('cidbProfile') || '{}');
                this.projects = JSON.parse(localStorage.getItem('cidbProjects') || '[]');
                this.documents = JSON.parse(localStorage.getItem('cidbDocuments') || '{}');
                this.init();
            }

            init() {
                this.setupEventListeners();
                this.loadProfileData();
                this.updateProgressDisplay();
                this.loadProjects();
            }

            setupEventListeners() {
                // Form submissions
                document.getElementById('personalForm').addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.savePersonalData();
                });

                document.getElementById('companyForm').addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.saveCompanyData();
                });

                document.getElementById('projectForm').addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.addProject();
                });

                // Document uploads
                document.querySelectorAll('.document-upload').forEach(input => {
                    input.addEventListener('change', (e) => {
                        this.handleDocumentUpload(e);
                    });
                });

                // Submit application
                document.getElementById('submitApplication').addEventListener('click', () => {
                    this.submitApplication();
                });

                // Offline work
                document.getElementById('offlineWorkBtn').addEventListener('click', () => {
                    this.enableOfflineWork();
                });

                // Auto-save on input changes
                document.querySelectorAll('input, textarea, select').forEach(input => {
                    input.addEventListener('change', () => {
                        this.autoSave();
                    });
                });
            }

            savePersonalData() {
                const form = document.getElementById('personalForm');
                const formData = new FormData(form);
                const data = {};
                
                for (let [key, value] of formData.entries()) {
                    data[key] = value;
                }
                
                this.profileData.personal = data;
                localStorage.setItem('cidbProfile', JSON.stringify(this.profileData));
                this.updateProgressDisplay();
                alert('Personal details saved successfully!');
            }

            saveCompanyData() {
                const form = document.getElementById('companyForm');
                const formData = new FormData(form);
                const data = {};
                
                // Handle checkboxes for specialties
                const specialties = [];
                document.querySelectorAll('input[name="specialties"]:checked').forEach(cb => {
                    specialties.push(cb.value);
                });
                data.specialties = specialties;
                
                // Handle other fields
                for (let [key, value] of formData.entries()) {
                    if (key !== 'specialties') {
                        data[key] = value;
                    }
                }
                
                this.profileData.company = data;
                localStorage.setItem('cidbProfile', JSON.stringify(this.profileData));
                this.updateProgressDisplay();
                alert('Company details saved successfully!');
            }

            addProject() {
                const form = document.getElementById('projectForm');
                const formData = new FormData(form);
                const project = {};
                
                for (let [key, value] of formData.entries()) {
                    project[key] = value;
                }
                
                project.id = Date.now();
                project.dateAdded = new Date().toISOString();
                
                this.projects.push(project);
                localStorage.setItem('cidbProjects', JSON.stringify(this.projects));
                
                this.loadProjects();
                form.reset();
                alert('Project added successfully!');
            }

            handleDocumentUpload(event) {
                const file = event.target.files[0];
                if (!file) return;

                const documentType = event.target.name;
                
                const documentInfo = {
                    name: file.name,
                    type: documentType,
                    uploadDate: new Date().toISOString(),
                    size: file.size,
                    status: 'uploaded'
                };

                this.documents[documentType] = documentInfo;
                localStorage.setItem('cidbDocuments', JSON.stringify(this.documents));
                
                this.updateProgressDisplay();
                alert(`${file.name} uploaded successfully!`);
            }

            loadProfileData() {
                // Load personal data
                if (this.profileData.personal) {
                    const form = document.getElementById('personalForm');
                    Object.keys(this.profileData.personal).forEach(key => {
                        const input = form.querySelector(`[name="${key}"]`);
                        if (input) {
                            input.value = this.profileData.personal[key];
                        }
                    });
                }

                // Load company data
                if (this.profileData.company) {
                    const form = document.getElementById('companyForm');
                    Object.keys(this.profileData.company).forEach(key => {
                        if (key === 'specialties') {
                            this.profileData.company[key].forEach(specialty => {
                                const checkbox = form.querySelector(`input[value="${specialty}"]`);
                                if (checkbox) checkbox.checked = true;
                            });
                        } else {
                            const input = form.querySelector(`[name="${key}"]`);
                            if (input) {
                                input.value = this.profileData.company[key];
                            }
                        }
                    });
                }
            }

            loadProjects() {
                const projectsList = document.getElementById('projectsList');
                
                if (this.projects.length === 0) {
                    // Keep the sample projects if no real projects exist
                    return;
                }

                // Clear and reload with actual projects
                let html = '';
                this.projects.forEach(project => {
                    html += `
                        <div class="project-card card mb-3">
                            <div class="card-body">
                                <div class="d-flex justify-content-between align-items-start">
                                    <div>
                                        <h6 class="mb-1">${project.projectName}</h6>
                                        <p class="text-muted mb-2">Client: ${project.clientName}</p>
                                        <p class="mb-2">${project.projectDescription}</p>
                                        <small class="text-muted">${new Date(project.startDate).toLocaleDateString()} - ${new Date(project.completionDate).toLocaleDateString()} | ${project.projectType}</small>
                                    </div>
                                    <div class="text-end">
                                        <h6 class="text-success">R${parseInt(project.projectValue).toLocaleString()}</h6>
                                        ${project.contactPerson ? `<small class="text-muted">Contact: ${project.contactPerson}<br>${project.contactPhone || ''}</small>` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>
                    `;
                });
                
                projectsList.innerHTML = html;
            }

            updateProgressDisplay() {
                let completionPercentage = 0;
                let documentsUploaded = 0;
                const totalSections = 4; // personal, company, documents, experience
                const totalDocuments = 12;
                
                // Check personal data completion
                if (this.profileData.personal && Object.keys(this.profileData.personal).length > 5) {
                    completionPercentage += 25;
                }
                
                // Check company data completion
                if (this.profileData.company && Object.keys(this.profileData.company).length > 5) {
                    completionPercentage += 25;
                }
                
                // Check documents
                documentsUploaded = Object.keys(this.documents).length;
                completionPercentage += (documentsUploaded / totalDocuments) * 25;
                
                // Check projects
                if (this.projects.length >= 2) {
                    completionPercentage += 25;
                } else if (this.projects.length >= 1) {
                    completionPercentage += 12.5;
                }
                
                completionPercentage = Math.round(completionPercentage);
                
                // Update header display
                document.getElementById('profileComplete').textContent = `${completionPercentage}%`;
                document.getElementById('documentsCount').textContent = `${documentsUploaded}/${totalDocuments}`;
                document.getElementById('progressText').textContent = `${completionPercentage}%`;
                
                // Update progress circle
                const progressCircle = document.getElementById('progressCircle');
                const degrees = (completionPercentage / 100) * 360;
                progressCircle.style.background = `conic-gradient(#28a745 0deg ${degrees}deg, #e9ecef ${degrees}deg 360deg)`;
                
                // Update profile name if available
                if (this.profileData.personal && this.profileData.personal.firstName && this.profileData.personal.lastName) {
                    document.getElementById('profileName').textContent = 
                        `${this.profileData.personal.firstName} ${this.profileData.personal.lastName}`;
                }

                // Update target grade if available
                if (this.profileData.company && this.profileData.company.targetGrade) {
                    document.getElementById('targetGrade').textContent = `Grade ${this.profileData.company.targetGrade}`;
                }
            }

            autoSave() {
                // Auto-save functionality for better UX
                setTimeout(() => {
                    const personalForm = document.getElementById('personalForm');
                    const companyForm = document.getElementById('companyForm');
                    
                    // Save personal data if form has content
                    if (personalForm.querySelector('input').value) {
                        this.savePersonalData();
                    }
                    
                    // Save company data if form has content
                    if (companyForm.querySelector('input').value) {
                        this.saveCompanyData();
                    }
                }, 1000);
            }

            submitApplication() {
                const completion = parseInt(document.getElementById('profileComplete').textContent);
                
                if (completion < 80) {
                    alert('Please complete at least 80% of your profile before submitting.');
                    return;
                }
                
                // Simulate application submission
                const applicationData = {
                    profile: this.profileData,
                    projects: this.projects,
                    documents: this.documents,
                    submissionDate: new Date().toISOString(),
                    applicationId: 'CIDB-' + Date.now()
                };
                
                localStorage.setItem('cidbApplication', JSON.stringify(applicationData));
                
                alert(`Application submitted successfully!\nApplication ID: ${applicationData.applicationId}\n\nYou will receive confirmation via email within 48 hours.`);
                
                // Redirect back to main app
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 2000);
            }

            enableOfflineWork() {
                alert('Offline work enabled! All your data is automatically saved locally and will sync when you go back online.');
            }
        }

        // Initialize the CIDB Profile app
        document.addEventListener('DOMContentLoaded', () => {
            new CIDBProfile();
        });