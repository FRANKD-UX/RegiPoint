from flask import Flask, request, jsonify, session, g
from flask_cors import CORS
import sqlite3
import hashlib
import os
from datetime import datetime, timedelta
import json
import base64

# --- App Configuration --- #
app = Flask(__name__)
# CRITICAL: Load secret key from environment variable for security
# IMPORTANT: In your deployment environment, set FLASK_SECRET_KEY to a long, random string.
# Example: export FLASK_SECRET_KEY='your_very_long_and_random_secret_key_here_12345'
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'default-dev-key-change-this-in-production')
CORS(app, supports_credentials=True) # supports_credentials=True is needed for sessions/cookies

# --- Database Configuration --- #
DATABASE = 'regapp.db'
UPLOAD_FOLDER = 'uploads' # Folder to store document files on the server
os.makedirs(UPLOAD_FOLDER, exist_ok=True) # Ensure the upload folder exists

def get_db():
    """Opens a new database connection if there is none yet for the current application context."""
    if 'db' not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row # This allows accessing columns by name, e.g., row['id']
    return g.db

@app.teardown_appcontext
def close_db(exception):
    """Closes the database again at the end of the request."""
    db = g.pop('db', None)
    if db is not None:
        db.close()

def init_db():
    """Initializes the database schema and inserts a demo user."""
    with app.app_context(): # Use app_context to access get_db outside of a request
        db = get_db()
        cursor = db.cursor()
        
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
        
        # FIXED: Storing file_path instead of BLOB for scalability and performance
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY,
                user_id INTEGER,
                document_type TEXT,
                filename TEXT,
                file_path TEXT, -- Store path to file instead of binary data
                upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expiry_date TIMESTAMP,
                status TEXT DEFAULT 'active', -- 'active' or 'replaced'
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')

        # Insert demo user if not already exists
        demo_pin_hash = hashlib.sha256('1234'.encode()).hexdigest()
        cursor.execute('''
            INSERT OR IGNORE INTO users (phone, pin_hash, name) 
            VALUES (?, ?, ?)
        ''', ('+2341234567890', demo_pin_hash, 'Demo User'))

        db.commit()

# CLI command to easily initialize the database (run once after setup)
# Usage: FLASK_APP=app.py flask init-db
@app.cli.command('init-db')
def init_db_command():
    """Clear existing data and create new tables."""
    init_db()
    print('Initialized the database.')

# ------------------- AUTH ROUTES ------------------- #
@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    phone = data.get('phone')
    pin = data.get('pin')
    if not phone or not pin:
        return jsonify({'error': 'Phone and PIN required'}), 400

    pin_hash = hashlib.sha256(pin.encode()).hexdigest()
    db = get_db() # Use get_db()
    user = db.execute('SELECT id, name, phone FROM users WHERE phone = ? AND pin_hash = ?', (phone, pin_hash)).fetchone()

    if user:
        session.clear() # Clear any existing session data
        session['user_id'] = user['id']
        session['user_name'] = user['name']
        return jsonify({'success': True, 'user': {'id': user['id'], 'name': user['name'], 'phone': user['phone']}})
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
    db = get_db() # Use get_db()
    cursor = db.execute('''
        INSERT INTO applications (user_id, company, country, form_data)
        VALUES (?, ?, ?, ?)
    ''', (session['user_id'], data.get('company'), data.get('country'), json.dumps(data.get('form_data', {}))))
    app_id = cursor.lastrowid
    db.commit() # Commit changes to DB
    return jsonify({'success': True, 'application_id': app_id, 'message': 'Application submitted successfully'})

@app.route('/api/applications', methods=['GET'])
def get_applications():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    db = get_db() # Use get_db()
    rows = db.execute('''
        SELECT id, company, country, status, created_at
        FROM applications WHERE user_id = ?
        ORDER BY created_at DESC
    ''', (session['user_id'],)).fetchall()
    
    # Convert rows to list of dictionaries for jsonify
    apps = [{'id': r['id'], 'company': r['company'], 'country': r['country'], 'status': r['status'], 'created_at': r['created_at']} for r in rows]
    return jsonify({'applications': apps})

# ---------------- DOCUMENT ROUTES ---------------- #
@app.route('/api/documents', methods=['POST'])
def upload_document():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    file = request.files.get('file') # Access file via request.files
    document_type = request.form.get('document_type') # Access form fields via request.form
    expiry_days_str = request.form.get('expiry_days') # Get as string first

    if not file or not document_type:
        return jsonify({'error': 'File and document type required'}), 400

    # Sanitize filename to prevent directory traversal issues
    filename = secure_filename(file.filename) if file.filename else 'untitled'
    # Create a unique filename on the server to avoid conflicts
    unique_filename = f"{session['user_id']}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{filename}"
    file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
    file.save(file_path) # Save file to the filesystem

    expiry_date = None
    if expiry_days_str and expiry_days_str.isdigit():
        expiry_date = datetime.now() + timedelta(days=int(expiry_days_str))

    db = get_db() # Use get_db()
    # Mark any previously active document of the same type as 'replaced'
    db.execute('''
        UPDATE documents SET status = 'replaced'
        WHERE user_id = ? AND document_type = ? AND status = 'active'
    ''', (session['user_id'], document_type))
    
    # Insert new document record with the file_path
    cursor = db.execute('''
        INSERT INTO documents (user_id, document_type, filename, file_path, expiry_date)
        VALUES (?, ?, ?, ?, ?)
    ''', (session['user_id'], document_type, unique_filename, file_path, expiry_date))
    doc_id = cursor.lastrowid
    db.commit()
    return jsonify({'success': True, 'document_id': doc_id, 'message': 'Document uploaded successfully'})

from werkzeug.utils import secure_filename # Added for secure_filename

@app.route('/api/documents', methods=['GET'])
def get_documents():
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db() # Use get_db()
    # IMPORTANT: Do not select 'file_data' BLOB here. We just need metadata.
    rows = db.execute('''
        SELECT id, document_type, filename, upload_date, expiry_date, status
        FROM documents WHERE user_id = ? AND status = 'active'
        ORDER BY upload_date DESC
    ''', (session['user_id'],)).fetchall()
    
    docs = []
    for row in rows:
        # Convert sqlite3.Row object to a dictionary for easier manipulation and JSON serialization
        doc_dict = dict(row) 
        
        # Calculate expiry status
        expiry_status = 'valid'
        days_left = None
        if doc_dict['expiry_date']:
            # Ensure expiry_date is parsed correctly
            expiry_dt = datetime.fromisoformat(str(doc_dict['expiry_date'])) # Convert string to datetime object
            days_left = (expiry_dt - datetime.now()).days
            expiry_status = 'expired' if days_left < 0 else 'expiring' if days_left <= 7 else 'valid'
        
        doc_dict['expiry_status'] = expiry_status
        doc_dict['days_until_expiry'] = days_left
        docs.append(doc_dict)
    
    return jsonify({'documents': docs})

@app.route('/api/documents/<int:document_id>', methods=['GET'])
def download_document(document_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    db = get_db() # Use get_db()
    # Select the file_path now
    result = db.execute('''
        SELECT filename, file_path FROM documents WHERE id = ? AND user_id = ?
    ''', (document_id, session['user_id'])).fetchone()
    
    if not result:
        return jsonify({'error': 'Document not found'}), 404
    
    file_path = result['file_path']
    filename = result['filename']

    # Read the file data from the file system
    try:
        with open(file_path, 'rb') as f:
            file_data = f.read()
    except FileNotFoundError:
        return jsonify({'error': 'File not found on server storage'}), 500

    # Return base64 encoded data, as the frontend expects it this way
    return jsonify({'filename': filename, 'data': base64.b64encode(file_data).decode('utf-8')})

# ---------------- PROCESS QUEUE (Backend API for Service Worker) ---------------- #
@app.route('/api/process-queue', methods=['POST'])
def process_queue():
    # This endpoint is designed to receive queued items from the Service Worker
    # when the PWA comes back online with background sync.
    
    # Note: Service Workers generally don't have session data. Authentication
    # for background sync usually involves a token, but for this simple app,
    # we'll assume the user is logged in *or* that the data contains user_id.
    # For a robust solution, consider JWT for background sync authentication.
    
    data = request.get_json()
    queue_items = data.get('queue_items', [])
    processed_results = []
    db = get_db() # Use get_db()

    for item in queue_items:
        try:
            # Re-check user_id if not authenticated in session (e.g., if SW initiated)
            # For simplicity, we'll use session['user_id'] here, implying this route
            # is called by the main thread after login, or SW gets user_id from stored data.
            user_id = session.get('user_id') 
            if not user_id:
                # If SW is handling and user_id isn't in session, it needs to be in item data
                user_id = item.get('user_id') # Assume user_id passed in queued item for SW context
                if not user_id:
                    processed_results.append({'id': item['id'], 'status': 'error', 'message': 'User ID missing for queued item'})
                    continue


            if item['type'] == 'document':
                # Decode base64 data and save the file
                file_data_b64 = item['file']['data'] # Access nested file data
                _, b64_encoded_data = file_data_b64.split(',', 1) # Split 'data:image/png;base64,' part
                file_content = base64.b64decode(b64_encoded_data)
                
                filename = secure_filename(item['file']['name'])
                unique_filename = f"{user_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{filename}"
                file_path = os.path.join(UPLOAD_FOLDER, unique_filename)
                
                with open(file_path, 'wb') as f:
                    f.write(file_content)

                expiry_date = None
                if item['documentInfo']['expiryDate']:
                    # Convert ISO string to datetime object
                    expiry_date = datetime.fromisoformat(item['documentInfo']['expiryDate'].replace('Z', '+00:00')) # Handle Z for UTC

                db.execute('''
                    UPDATE documents SET status = 'replaced'
                    WHERE user_id = ? AND document_type = ? AND status = 'active'
                ''', (user_id, item['documentInfo']['type'])) # Use documentInfo.type
                
                db.execute('''
                    INSERT INTO documents (user_id, document_type, filename, file_path, expiry_date, status)
                    VALUES (?, ?, ?, ?, ?, 'active')
                ''', (user_id, item['documentInfo']['type'], unique_filename, file_path, expiry_date))

            elif item['type'] == 'application':
                db.execute('''
                    INSERT INTO applications (user_id, company, country, form_data)
                    VALUES (?, ?, ?, ?)
                ''', (user_id, item['company'], item['country'], json.dumps(item['form_data'])))

            db.commit()
            processed_results.append({'id': item['id'], 'status': 'success'})

        except Exception as e:
            db.rollback() # Rollback on error
            processed_results.append({'id': item['id'], 'status': 'error', 'message': str(e)})

    return jsonify({'success': True, 'processed_items': processed_results})

# ------------------- USSD SIMULATION ------------------- #
@app.route('/api/ussd', methods=['POST'])
def ussd_request():
    data = request.get_json()
    # The frontend is sending specific field names now to fill individual fields
    field_name = data.get('field_name') 
    
    # If frontend sends specific field names, return that data
    if field_name:
        ussd_data_single_field = {
            'firstName': 'Thabo', 'lastName': 'Mthembu', 'idNumber': '8501234567089',
            'dateOfBirth': '1985-02-15', 'phone': '+27821234567', 'email': 'thabo.mthembu@email.com',
            'residentialAddress': '123 Nelson Mandela Drive, Sandton', 'city': 'Johannesburg',
            'postalCode': '2196', 'taxNumber': 'TRN1234567890',
            'companyName': 'Ubuntu Tech Solutions', 'alternativeName': 'UTS Holdings',
            'businessDescription': 'Information technology consulting and software development services for SMEs.',
            'businessAddress': '456 Business Park, Rivonia Boulevard, Sandton',
            'shareCapital': '100000'
        }
        if field_name in ussd_data_single_field:
            return jsonify({'success': True, 'data': ussd_data_single_field[field_name]})
        return jsonify({'error': 'Field not available via USSD or invalid field name'}), 400

    # If no specific field name, assume a full autofill request (as in the new frontend)
    ussd_data_full_fill = {
        'firstName': 'Thabo', 'lastName': 'Mthembu', 'idNumber': '8501234567089',
        'dateOfBirth': '1985-02-15', 'phone': '+27821234567', 'email': 'thabo.mthembu@email.com',
        'residentialAddress': '123 Nelson Mandela Drive, Sandton', 'city': 'Johannesburg',
        'postalCode': '2196', 'taxNumber': 'TRN1234567890',
        'companyName': 'Ubuntu Tech Solutions', 'alternativeName': 'UTS Holdings',
        'businessType': 'private-company', # Example for select
        'industrySector': 'information', # Example for select
        'businessDescription': 'Information technology consulting and software development services for SMEs.',
        'businessAddress': '456 Business Park, Rivonia Boulevard, Sandton',
        'expectedTurnover': '1m-5m', # Example for select
        'numberOfEmployees': '6-20', # Example for select
        'shareCapital': '100000',
        'numberOfShareholders': '2',
        'preferredBank': 'standard-bank', # Example for select
        'accountType': 'business-current' # Example for select
    }
    return jsonify({'success': True, 'data': ussd_data_full_fill})


# ------------------- REGULATORY BODIES (Placeholder for future use if needed) ------------------- #
# This route was in your original, but not used by the current frontend design.
# It's kept for completeness. You would need a regulatory_bodies.json file.
@app.route('/api/regulatory-bodies', methods=['GET'])
def get_regulatory_bodies():
    # Example placeholder: This would typically load from a static JSON file or database
    regulatory_bodies_data = {
        "nigeria": ["CAC", "FIRS"],
        "south-africa": ["CIPC", "SARS", "SARB", "FSCA", "DTIC"],
        "rwanda": ["RDB"],
        "ghana": ["GRA"]
    }
    return jsonify({'regulatory_bodies': regulatory_bodies_data})
    # If you have regulatory_bodies.json, uncomment these lines and ensure file exists:
    # with open('regulatory_bodies.json', 'r') as f:
    #     regulatory_bodies = json.load(f)
    # return jsonify({'regulatory_bodies': regulatory_bodies})

# ------------------- HEALTH CHECK ------------------- #
@app.route('/api/health', methods=['GET'])
def health_check():
    # Simple health check to see if the server is running
    return jsonify({'status': 'healthy', 'timestamp': datetime.now().isoformat()})

if __name__ == '__main__':
    # How to run this Flask app for the first time:
    # 1. Open your terminal in the directory containing app.py
    # 2. Set environment variables (for security and app entry point):
    #    export FLASK_APP=app.py
    #    export FLASK_SECRET_KEY='YOUR_VERY_LONG_AND_RANDOM_KEY_HERE'
    # 3. Initialize the database (this creates regapp.db and the tables):
    #    flask init-db
    # 4. Run the application:
    #    flask run --host=0.0.0.0 --port=5000
    
    app.run(debug=True, host='0.0.0.0', port=5000)