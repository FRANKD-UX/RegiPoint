from flask import Flask, request, jsonify, session
from flask_cors import CORS
import sqlite3
import hashlib
import os
from datetime import datetime, timedelta
import json
import base64

app = Flask(__name__)
app.secret_key = 'your-secret-key-change-this'
CORS(app)

# ----------------------- DB SETUP ----------------------- #
def init_db():
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            phone TEXT UNIQUE,
            pin_hash TEXT,
            name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            company TEXT,
            country TEXT,
            form_data TEXT,
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            document_type TEXT,
            filename TEXT,
            file_data BLOB,
            upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expiry_date TIMESTAMP,
            status TEXT DEFAULT 'active',
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')

    demo_pin_hash = hashlib.sha256('1234'.encode()).hexdigest()
    cursor.execute('''
        INSERT OR IGNORE INTO users (phone, pin_hash, name) 
        VALUES (?, ?, ?)
    ''', ('+2341234567890', demo_pin_hash, 'Demo User'))

    conn.commit()
    conn.close()

init_db()

# ------------------- AUTH ROUTES ------------------- #
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    phone = data.get('phone')
    pin = data.get('pin')
    if not phone or not pin:
        return jsonify({'error': 'Phone and PIN required'}), 400

    pin_hash = hashlib.sha256(pin.encode()).hexdigest()
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    cursor.execute('SELECT id, name FROM users WHERE phone = ? AND pin_hash = ?', (phone, pin_hash))
    user = cursor.fetchone()
    conn.close()

    if user:
        session['user_id'] = user[0]
        session['user_name'] = user[1]
        return jsonify({'success': True, 'user': {'id': user[0], 'name': user[1], 'phone': phone}})
    else:
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})

# ---------------- APPLICATION ROUTES ---------------- #
@app.route('/api/applications', methods=['POST'])
def submit_application():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    data = request.get_json()
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO applications (user_id, company, country, form_data)
        VALUES (?, ?, ?, ?)
    ''', (session['user_id'], data.get('company'), data.get('country'), json.dumps(data.get('form_data', {}))))
    app_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'success': True, 'application_id': app_id, 'message': 'Application submitted successfully'})

@app.route('/api/applications', methods=['GET'])
def get_applications():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, company, country, status, created_at
        FROM applications WHERE user_id = ?
        ORDER BY created_at DESC
    ''', (session['user_id'],))
    apps = [{'id': r[0], 'company': r[1], 'country': r[2], 'status': r[3], 'created_at': r[4]} for r in cursor.fetchall()]
    conn.close()
    return jsonify({'applications': apps})

# ---------------- DOCUMENT ROUTES ---------------- #
@app.route('/api/documents', methods=['POST'])
def upload_document():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    file = request.files.get('file')
    document_type = request.form.get('document_type')
    expiry_days = request.form.get('expiry_days', type=int)

    if not file or not document_type:
        return jsonify({'error': 'File and document type required'}), 400

    expiry_date = datetime.now() + timedelta(days=expiry_days) if expiry_days else None
    file_data = file.read()

    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    cursor.execute('''
        UPDATE documents SET status = 'replaced'
        WHERE user_id = ? AND document_type = ? AND status = 'active'
    ''', (session['user_id'], document_type))
    cursor.execute('''
        INSERT INTO documents (user_id, document_type, filename, file_data, expiry_date)
        VALUES (?, ?, ?, ?, ?)
    ''', (session['user_id'], document_type, file.filename, file_data, expiry_date))
    doc_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'document_id': doc_id, 'message': 'Document uploaded successfully'})

@app.route('/api/documents', methods=['GET'])
def get_documents():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, document_type, filename, upload_date, expiry_date, status
        FROM documents WHERE user_id = ? AND status = 'active'
        ORDER BY upload_date DESC
    ''', (session['user_id'],))
    
    docs = []
    for row in cursor.fetchall():
        expiry_status = 'valid'
        days_left = None
        if row[4]:
            days_left = (datetime.fromisoformat(row[4]) - datetime.now()).days
            expiry_status = 'expired' if days_left < 0 else 'expiring' if days_left <= 7 else 'valid'
        docs.append({
            'id': row[0], 'document_type': row[1], 'filename': row[2],
            'upload_date': row[3], 'expiry_date': row[4], 'status': row[5],
            'expiry_status': expiry_status, 'days_until_expiry': days_left
        })
    conn.close()
    return jsonify({'documents': docs})

@app.route('/api/documents/<int:document_id>', methods=['GET'])
def download_document(document_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    cursor.execute('''
        SELECT filename, file_data FROM documents WHERE id = ? AND user_id = ?
    ''', (document_id, session['user_id']))
    result = cursor.fetchone()
    conn.close()
    if not result:
        return jsonify({'error': 'Document not found'}), 404
    return jsonify({'filename': result[0], 'data': base64.b64encode(result[1]).decode('utf-8')})

# ---------------- PROCESS QUEUE ---------------- #
@app.route('/api/process-queue', methods=['POST'])
def process_queue():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    data = request.get_json()
    processed = []

    for item in data.get('queue_items', []):
        try:
            conn = sqlite3.connect('regapp.db')
            cursor = conn.cursor()

            if item['type'] == 'document':
                file_data = base64.b64decode(item['file_data'].split(',')[1])
                cursor.execute('''
                    INSERT INTO documents (user_id, document_type, filename, file_data, expiry_date)
                    VALUES (?, ?, ?, ?, ?)
                ''', (session['user_id'], item['document_type'], item['filename'], file_data, item.get('expiry_date')))
            elif item['type'] == 'application':
                cursor.execute('''
                    INSERT INTO applications (user_id, company, country, form_data)
                    VALUES (?, ?, ?, ?)
                ''', (session['user_id'], item['company'], item['country'], json.dumps(item['form_data'])))

            conn.commit()
            conn.close()
            processed.append({'id': item['id'], 'status': 'success'})
        except Exception as e:
            processed.append({'id': item['id'], 'status': 'error', 'message': str(e)})

    return jsonify({'success': True, 'processed_items': processed})

# ------------------- USSD SIMULATION ------------------- #
@app.route('/api/ussd', methods=['POST'])
def ussd_request():
    data = request.get_json()
    field_name = data.get('field_name')

    # --- NEW EXTENDED USSD DATA --- #
    ussd_data = {
        'firstName': 'Thabo', 'lastName': 'Mthembu', 'idNumber': '8501234567089',
        'dateOfBirth': '1985-02-15', 'phone': '+27821234567', 'email': 'thabo.mthembu@email.com',
        'residentialAddress': '123 Nelson Mandela Drive, Sandton', 'city': 'Johannesburg',
        'postalCode': '2196', 'taxNumber': 'TRN1234567890',
        'companyName': 'Ubuntu Tech Solutions', 'alternativeName': 'UTS Holdings',
        'businessDescription': 'Information technology consulting and software development services for SMEs.',
        'businessAddress': '456 Business Park, Rivonia Boulevard, Sandton',
        'shareCapital': '100000'
    }

    if field_name in ussd_data:
        return jsonify({'success': True, 'data': ussd_data[field_name]})
    return jsonify({'error': 'Field not available via USSD'}), 400

# ------------------- REGULATORY BODIES ------------------- #
@app.route('/api/regulatory-bodies', methods=['GET'])
def get_regulatory_bodies():
    # --- NEW ROUTE --- #
    with open('regulatory_bodies.json', 'r') as f:
        regulatory_bodies = json.load(f)
    return jsonify({'regulatory_bodies': regulatory_bodies})

# ------------------- HEALTH CHECK ------------------- #
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
