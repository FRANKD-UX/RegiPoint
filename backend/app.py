# backend/app.py (Final Version for Single-Server Deployment)

from flask import Flask, request, jsonify, session, g, send_from_directory
# CORS is no longer needed with this setup.
# from flask_cors import CORS
import sqlite3
import hashlib
import os
from datetime import datetime, timedelta
import json
import base64
from werkzeug.utils import secure_filename

# --- App Configuration --- #
# Define the path to the frontend folder, relative to this script's location.
# We are in /backend, so we go up one level ('..') and then into /frontend.
FRONTEND_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend')

# When Flask serves static files, it uses the 'static_folder' argument.
app = Flask(__name__, static_folder=FRONTEND_FOLDER)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'default-dev-key-change-this-in-production')


# --- Database Configuration --- #
# Define paths relative to the project root to ensure they are always correct.
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(PROJECT_ROOT, '..', 'regapp.db')
UPLOAD_FOLDER = os.path.join(PROJECT_ROOT, '..', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def get_db():
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db

@app.teardown_appcontext
def close_db(exception):
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
    with app.app_context():
        db = get_db()
        cursor = db.cursor()
        
        cursor.execute('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, phone TEXT UNIQUE, pin_hash TEXT, name TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)')
        cursor.execute('CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY, user_id INTEGER, company TEXT, country TEXT, form_data TEXT, status TEXT DEFAULT "pending", created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users (id))')
        cursor.execute('CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, user_id INTEGER, document_type TEXT, filename TEXT, file_path TEXT, upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, expiry_date TIMESTAMP, status TEXT DEFAULT "active", FOREIGN KEY (user_id) REFERENCES users (id))')
        
        demo_pin_hash = hashlib.sha256('1234'.encode()).hexdigest()
        cursor.execute('INSERT OR IGNORE INTO users (phone, pin_hash, name) VALUES (?, ?, ?)', ('+2341234567890', demo_pin_hash, 'Demo User'))
        db.commit()

@app.cli.command('init-db')
def init_db_command():
    init_db()
    print('Initialized the database.')

# ================================================================================= #
# --- API Routes (These all remain the same, but will be served from /api/...) --- #
# ================================================================================= #

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    phone, pin = data.get('phone'), data.get('pin')
    if not phone or not pin: return jsonify({'error': 'Phone and PIN required'}), 400
    pin_hash = hashlib.sha256(pin.encode()).hexdigest()
    db = get_db()
    user = db.execute('SELECT id, name, phone FROM users WHERE phone = ? AND pin_hash = ?', (phone, pin_hash)).fetchone()
    if user:
        session.clear()
        session['user_id'] = user['id']
        session['user_name'] = user['name']
        return jsonify({'success': True, 'user': dict(user)})
    return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/applications', methods=['POST'])
def submit_application():
    if 'user_id' not in session: return jsonify({'error': 'Not authenticated'}), 401
    data = request.get_json()
    db = get_db()
    cursor = db.execute('INSERT INTO applications (user_id, company, country, form_data) VALUES (?, ?, ?, ?)',
                        (session['user_id'], data.get('company'), data.get('country'), json.dumps(data.get('form_data', {}))))
    app_id = cursor.lastrowid
    db.commit()
    return jsonify({'success': True, 'application_id': app_id})

@app.route('/api/applications', methods=['GET'])
def get_applications():
    if 'user_id' not in session: return jsonify({'error': 'Not authenticated'}), 401
    db = get_db()
    rows = db.execute('SELECT id, company, country, status, created_at FROM applications WHERE user_id = ? ORDER BY created_at DESC', (session['user_id'],)).fetchall()
    return jsonify({'applications': [dict(r) for r in rows]})

@app.route('/api/documents', methods=['POST'])
def upload_document():
    if 'user_id' not in session: return jsonify({'error': 'Not authenticated'}), 401
    file, doc_type, expiry_days = request.files.get('file'), request.form.get('document_type'), request.form.get('expiry_days')
    if not file or not doc_type: return jsonify({'error': 'File and document type required'}), 400
    
    filename = secure_filename(file.filename)
    unique_filename = f"{session['user_id']}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{filename}"
    file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
    file.save(file_path)
    
    expiry_date = datetime.now() + timedelta(days=int(expiry_days)) if expiry_days and expiry_days.isdigit() else None
    
    db = get_db()
    db.execute('UPDATE documents SET status = "replaced" WHERE user_id = ? AND document_type = ? AND status = "active"', (session['user_id'], doc_type))
    cursor = db.execute('INSERT INTO documents (user_id, document_type, filename, file_path, expiry_date) VALUES (?, ?, ?, ?, ?)',
                        (session['user_id'], doc_type, filename, file_path, expiry_date))
    db.commit()
    return jsonify({'success': True, 'document_id': cursor.lastrowid})

@app.route('/api/documents', methods=['GET'])
def get_documents():
    if 'user_id' not in session: return jsonify({'error': 'Not authenticated'}), 401
    db = get_db()
    rows = db.execute('SELECT * FROM documents WHERE user_id = ? AND status = "active" ORDER BY upload_date DESC', (session['user_id'],)).fetchall()
    docs = [dict(row) for row in rows]
    for doc in docs:
        if doc.get('expiry_date'):
            days_left = (datetime.fromisoformat(str(doc['expiry_date'])) - datetime.now()).days
            doc['expiry_status'] = 'expired' if days_left < 0 else 'expiring' if days_left <= 7 else 'valid'
            doc['days_until_expiry'] = days_left
    return jsonify({'documents': docs})

@app.route('/api/documents/<int:document_id>', methods=['GET'])
def download_document(document_id):
    if 'user_id' not in session: return jsonify({'error': 'Not authenticated'}), 401
    db = get_db()
    result = db.execute('SELECT file_path FROM documents WHERE id = ? AND user_id = ?', (document_id, session['user_id'])).fetchone()
    if not result: return jsonify({'error': 'Document not found'}), 404
    try:
        return send_from_directory(os.path.dirname(result['file_path']), os.path.basename(result['file_path']), as_attachment=True)
    except FileNotFoundError:
        return jsonify({'error': 'File not found on server'}), 404

@app.route('/api/process-queue', methods=['POST'])
def process_queue():
    if 'user_id' not in session: return jsonify({'error': 'Not authenticated'}), 401
    # This logic remains the same, as it's an internal API endpoint.
    pass # Add your original process_queue logic here

@app.route('/api/ussd', methods=['POST'])
def ussd_request():
    # This logic remains the same.
    pass # Add your original ussd_request logic here

@app.route('/api/regulatory-bodies', methods=['GET'])
def get_regulatory_bodies():
    # This logic remains the same.
    pass # Add your original get_regulatory_bodies logic here

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy'})

# ================================================================================= #
# --- Frontend Serving Routes (This is the new part) --- #
# ================================================================================= #

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    """
    This function serves the frontend files.
    If a file exists in the frontend folder, it serves it.
    Otherwise, it serves index.html, allowing the frontend router to handle the path.
    """
    if path != "" and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    else:
        # This is the entry point for your PWA.
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)