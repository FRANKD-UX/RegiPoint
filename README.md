# RegApp - African Regulatory PWA

A minimalistic Progressive Web App designed for low-power devices in Africa to help entrepreneurs submit applications to country-specific regulatory bodies.

## 🚀 Quick Setup (Hackathon Ready)

### Frontend Setup
1. Create a new folder: `regapp-frontend`
2. Copy the HTML file as `index.html`
3. Copy `manifest.json` and `service-worker.js` files
4. Serve using any static server or open `index.html` directly

### Backend Setup
1. Create a new folder: `regapp-backend`
2. Copy `app.py` and `requirements.txt`
3. Run the following commands:

```bash
# Install dependencies
pip install -r requirements.txt

# Run the Flask server
python app.py
```

The backend will run on `http://localhost:5000`

## 📱 Features

### ✅ Implemented
- **Authentication**: Simple phone + PIN login system
- **Company Selection**: Circle-based UI for regulatory bodies (CAC Nigeria, CIPC South Africa, RDB Rwanda, GRA Ghana)
- **Application Forms**: Personal info, company info, and document upload
- **Offline Support**: 
  - Service worker for offline functionality
  - USSD simulation for autofill when offline
  - Document queuing system
- **Document Tracking**: Expiry notifications for certified documents
- **PWA Features**: Installable, works offline, responsive design

### 🔧 Technical Stack
- **Frontend**: HTML5, Bootstrap CSS, Vanilla JavaScript
- **Backend**: Flask (Python)
- **Database**: SQLite (for development)
- **PWA**: Service Worker, Web App Manifest

## 🎯 Demo Credentials
- **Phone**: +2341234567890
- **PIN**: 1234

## 📂 File Structure
```
regapp/
├── frontend/
│   ├── index.html          # Main PWA application
│   ├── manifest.json       # PWA manifest
│   └── service-worker.js   # Offline support
└── backend/
    ├── app.py              # Flask backend
    ├── requirements.txt    # Python dependencies
    └── regapp.db          # SQLite database (auto-created)
```

## 🌍 Supported Countries/Bodies
- **Nigeria**: Corporate Affairs Commission (CAC)
- **South Africa**: Companies and Intellectual Property Commission (CIPC)
- **Rwanda**: Rwanda Development Board (RDB)
- **Ghana**: Ghana Revenue Authority (GRA)

## 🔄 Offline Features

### Document Queuing
- Images are stored locally when offline
- Automatic upload when connection is restored
- Queue indicator shows pending items

### USSD Simulation
- Offline autofill for personal data
- Simulates USSD data retrieval
- Pre-filled demo data for testing

### Service Worker
- Caches app resources for offline use
- Background sync for queued uploads
- Offline detection and indicators

## 📊 Document Expiry Tracking
- **Police Clearance**: 3 months validity
- **Bank Statement**: 1 month validity
- **ID Copy**: No expiry
- **Passport Photo**: No expiry

Visual indicators:
- 🟢 Valid (green)
- 🟡 Expiring soon (yellow, ≤7 days)
- 🔴 Expired (red)

## 🛠️ Development Notes

### Customization
- **Add new regulatory bodies**: Update the company circles in `index.html`
- **Modify form fields**: Edit the form sections in the HTML
- **Change document types**: Update the document upload section
- **Add new countries**: Extend the Flask backend routes

### Production Deployment
1. **Frontend**: Deploy to any static hosting (Netlify, Vercel, etc.)
2. **Backend**: Deploy to Heroku, DigitalOcean, or AWS
3. **Database**: Migrate from SQLite to PostgreSQL for production
4. **HTTPS**: Required for PWA features and service workers

### API Endpoints
- `POST /api/login` - User authentication
- `GET/POST /api/applications` - Submit and retrieve applications
- `GET/POST /api/documents` - Upload and manage documents
- `POST /api/process-queue` - Process offline queue
- `POST /api/ussd` - USSD data simulation

## 🚨 Security Notes
- Change the Flask secret key in production
- Implement proper password hashing
- Add rate limiting for API endpoints
- Use HTTPS in production
- Validate all file uploads

## 📱 PWA Installation
1. Open the app in a mobile browser
2. Look for "Add to Home Screen" prompt
3. Install for native-like experience
4. Works offline after installation

## 🔧 Troubleshooting

### Common Issues
1. **Service Worker not registering**: Ensure HTTPS or localhost
2. **Files not caching**: Check browser console for SW errors
3. **Database errors**: Ensure write permissions for `regapp.db`
4. **CORS issues**: Flask-CORS is included in requirements

### Browser Support
- **Chrome/Edge**: Full support
- **Firefox**: Full support
- **Safari**: Most features (some PWA limitations)
- **Internet Explorer**: Not supported

## 📈 Performance Optimizations
- Minimal CSS/JS for low-power devices
- Compressed images and resources
- Local storage for form data
- Efficient SQLite queries
- Bootstrap CDN for faster loading

## 🔄 Updates and Maintenance
- Update cache version in service worker for updates
- Monitor document expiry dates
- Regular database cleanup
- User feedback collection

---

**Built for Hackathon Speed** 🏃‍♂️
This MVP prioritizes functionality and rapid deployment. All components are modular and copy-paste ready for immediate use in VS Code.