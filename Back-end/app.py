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

# Database setup
def init_db():
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    
    # Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            phone TEXT UNIQUE,
            pin_hash TEXT,
            name TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Applications table
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
    
    # Documents table
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
    
    # Create demo user
    demo_pin_hash = hashlib.sha256('1234'.encode()).hexdigest()
    cursor.execute('''
        INSERT OR IGNORE INTO users (phone, pin_hash, name) 
        VALUES (?, ?, ?)
    ''', ('+2341234567890', demo_pin_hash, 'Demo User'))
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_db()

# Authentication routes
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
        return jsonify({
            'success': True,
            'user': {'id': user[0], 'name': user[1], 'phone': phone}
        })
    else:
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({'success': True})

# Application routes
@app.route('/api/applications', methods=['POST'])
def submit_application():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    user_id = session['user_id']
    company = data.get('company')
    country = data.get('country')
    form_data = json.dumps(data.get('form_data', {}))
    
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO applications (user_id, company, country, form_data)
        VALUES (?, ?, ?, ?)
    ''', (user_id, company, country, form_data))
    
    application_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return jsonify({
        'success': True,
        'application_id': application_id,
        'message': 'Application submitted successfully'
    })

@app.route('/api/applications', methods=['GET'])
def get_applications():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, company, country, status, created_at
        FROM applications WHERE user_id = ?
        ORDER BY created_at DESC
    ''', (user_id,))
    
    applications = []
    for row in cursor.fetchall():
        applications.append({
            'id': row[0],
            'company': row[1],
            'country': row[2],
            'status': row[3],
            'created_at': row[4]
        })
    
    conn.close()
    return jsonify({'applications': applications})

# Document routes
@app.route('/api/documents', methods=['POST'])
def upload_document():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    document_type = request.form.get('document_type')
    expiry_days = request.form.get('expiry_days', type=int)
    
    if not file or not document_type:
        return jsonify({'error': 'File and document type required'}), 400
    
    # Calculate expiry date
    expiry_date = None
    if expiry_days:
        expiry_date = datetime.now() + timedelta(days=expiry_days)
    
    # Store file data
    file_data = file.read()
    
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    
    # Check if document type already exists and mark as replaced
    cursor.execute('''
        UPDATE documents SET status = 'replaced' 
        WHERE user_id = ? AND document_type = ? AND status = 'active'
    ''', (user_id, document_type))
    
    # Insert new document
    cursor.execute('''
        INSERT INTO documents (user_id, document_type, filename, file_data, expiry_date)
        VALUES (?, ?, ?, ?, ?)
    ''', (user_id, document_type, file.filename, file_data, expiry_date))
    
    document_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return jsonify({
        'success': True,
        'document_id': document_id,
        'message': 'Document uploaded successfully'
    })

@app.route('/api/documents', methods=['GET'])
def get_documents():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    cursor.execute('''
        SELECT id, document_type, filename, upload_date, expiry_date, status
        FROM documents WHERE user_id = ? AND status = 'active'
        ORDER BY upload_date DESC
    ''', (user_id,))
    
    documents = []
    for row in cursor.fetchall():
        expiry_status = 'valid'
        days_until_expiry = None
        
        if row[4]:  # expiry_date
            expiry_date = datetime.fromisoformat(row[4])
            days_until_expiry = (expiry_date - datetime.now()).days
            
            if days_until_expiry < 0:
                expiry_status = 'expired'
            elif days_until_expiry <= 7:
                expiry_status = 'expiring'
        
        documents.append({
            'id': row[0],
            'document_type': row[1],
            'filename': row[2],
            'upload_date': row[3],
            'expiry_date': row[4],
            'status': row[5],
            'expiry_status': expiry_status,
            'days_until_expiry': days_until_expiry
        })
    
    conn.close()
    return jsonify({'documents': documents})

@app.route('/api/documents/<int:document_id>', methods=['GET'])
def download_document(document_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    user_id = session['user_id']
    
    conn = sqlite3.connect('regapp.db')
    cursor = conn.cursor()
    cursor.execute('''
        SELECT filename, file_data FROM documents 
        WHERE id = ? AND user_id = ?
    ''', (document_id, user_id))
    
    result = cursor.fetchone()
    conn.close()
    
    if not result:
        return jsonify({'error': 'Document not found'}), 404
    
    filename, file_data = result
    
    return jsonify({
        'filename': filename,
        'data': base64.b64encode(file_data).decode('utf-8')
    })

# Queue processing route
@app.route('/api/process-queue', methods=['POST'])
def process_queue():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    data = request.get_json()
    queue_items = data.get('queue_items', [])
    
    processed_items = []
    
    for item in queue_items:
        try:
            # Process each queued item
            if item.get('type') == 'document':
                # Handle document upload from queue
                file_data = base64.b64decode(item['file_data'].split(',')[1])
                
                conn = sqlite3.connect('regapp.db')
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO documents (user_id, document_type, filename, file_data, expiry_date)
                    VALUES (?, ?, ?, ?, ?)
                ''', (
                    session['user_id'],
                    item['document_type'],
                    item['filename'],
                    file_data,
                    item.get('expiry_date')
                ))
                conn.commit()
                conn.close()
                
            elif item.get('type') == 'application':
                # Handle application submission from queue
                conn = sqlite3.connect('regapp.db')
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO applications (user_id, company, country, form_data)
                    VALUES (?, ?, ?, ?)
                ''', (
                    session['user_id'],
                    item['company'],
                    item['country'],
                    json.dumps(item['form_data'])
                ))
                conn.commit()
                conn.close()
            
            processed_items.append({
                'id': item['id'],
                'status': 'success'
            })
            
        except Exception as e:
            processed_items.append({
                'id': item['id'],
                'status': 'error',
                'message': str(e)
            })
    
    return jsonify({
        'success': True,
        'processed_items': processed_items
    })

# USSD simulation route
@app.route('/api/ussd', methods=['POST'])
def ussd_request():
    data = request.get_json()
    field_name = data.get('field_name')
    phone = data.get('phone')
    
    # Simulate USSD data retrieval
    ussd_data = {
        'fullName': 'John Doe',
        'idNumber': '1234567890123',
        'address': '123 Main Street, Lagos, Nigeria'
    }
    
    if field_name in ussd_data:
        return jsonify({
            'success': True,
            'data': ussd_data[field_name]
        })
    else:
        return jsonify({'error': 'Field not available via USSD'}), 400

# Health check
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)