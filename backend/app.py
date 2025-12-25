from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from datetime import datetime, timedelta
import json
import os
from pathlib import Path

app = Flask(__name__)
CORS(app)

# Data storage - Fixed paths
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / 'data'
DATA_DIR.mkdir(exist_ok=True)
WHISPERS_FILE = DATA_DIR / 'whispers.json'
REPLIES_FILE = DATA_DIR / 'replies.json'

# Initialize data files
def init_data():
    if not WHISPERS_FILE.exists():
        WHISPERS_FILE.write_text('[]')
    if not REPLIES_FILE.exists():
        REPLIES_FILE.write_text('[]')

init_data()

# All topics
ALL_TOPICS = [
    'confession', 'life', 'secrets', 'advice', 'love',
    'series-movies', 'politically-incorrect', 'paranormal', 
    'health-fitness', 'vent', 'music', 'fashion', 
    'gaming', 'otaku-stuff', 'random'
]

def load_data(filename):
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading {filename}: {e}")
        return []

def save_data(filename, data):
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"Error saving {filename}: {e}")
        return False

def cleanup_old_whispers():
    try:
        whispers = load_data(WHISPERS_FILE)
        cutoff_time = datetime.utcnow() - timedelta(hours=48)
        
        filtered_whispers = []
        deleted_ids = []
        
        for whisper in whispers:
            created_time = datetime.fromisoformat(whisper['created_at'])
            if created_time > cutoff_time:
                filtered_whispers.append(whisper)
            else:
                deleted_ids.append(whisper['id'])
        
        # Remove replies for deleted whispers
        if deleted_ids:
            replies = load_data(REPLIES_FILE)
            filtered_replies = [r for r in replies if r['whisper_id'] not in deleted_ids]
            save_data(REPLIES_FILE, filtered_replies)
            save_data(WHISPERS_FILE, filtered_whispers)
        
        return True
    except Exception as e:
        print(f"Error in cleanup: {e}")
        return False

# Serve frontend - Fixed path
@app.route('/')
def serve_frontend():
    try:
        return send_from_directory(BASE_DIR / '../frontend', 'index.html')
    except:
        return "Frontend not found", 404

@app.route('/<path:path>')
def serve_static_files(path):
    try:
        return send_from_directory(BASE_DIR / '../frontend', path)
    except:
        return "File not found", 404

# API Routes
@app.route('/api/whispers', methods=['GET'])
def get_whispers():
    try:
        cleanup_old_whispers()
        topic = request.args.get('topic', 'all')
        whispers = load_data(WHISPERS_FILE)
        
        if topic != 'all':
            whispers = [w for w in whispers if w['topic'] == topic]
        
        # Sort by newest first
        whispers.sort(key=lambda x: x['created_at'], reverse=True)
        
        return jsonify({
            'success': True,
            'data': whispers
        })
    except Exception as e:
        print(f"Error in get_whispers: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/whispers/<int:id>', methods=['GET'])
def get_whisper(id):
    try:
        whispers = load_data(WHISPERS_FILE)
        whisper = next((w for w in whispers if w['id'] == id), None)
        
        if not whisper:
            return jsonify({'success': False, 'error': 'Whisper not found'}), 404
        
        return jsonify({
            'success': True,
            'data': whisper
        })
    except Exception as e:
        print(f"Error in get_whisper: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/whispers', methods=['POST'])
def create_whisper():
    try:
        data = request.get_json()
        
        if not data or not data.get('content'):
            return jsonify({
                'success': False,
                'error': 'Content is required'
            }), 400
        
        whispers = load_data(WHISPERS_FILE)
        
        # Generate ID
        max_id = max([w['id'] for w in whispers], default=0)
        
        whisper = {
            'id': max_id + 1,
            'content': data['content'].strip(),
            'topic': data.get('topic', 'random'),
            'is_sensitive': data.get('is_sensitive', False),
            'replies_count': 0,
            'created_at': datetime.utcnow().isoformat()
        }
        
        whispers.append(whisper)
        
        if save_data(WHISPERS_FILE, whispers):
            return jsonify({
                'success': True,
                'data': whisper
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to save whisper'
            }), 500
            
    except Exception as e:
        print(f"Error in create_whisper: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/whispers/<int:id>/replies', methods=['GET'])
def get_replies(id):
    try:
        replies = load_data(REPLIES_FILE)
        whisper_replies = [r for r in replies if r['whisper_id'] == id]
        whisper_replies.sort(key=lambda x: x['created_at'])
        
        return jsonify({
            'success': True,
            'data': whisper_replies
        })
    except Exception as e:
        print(f"Error in get_replies: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/whispers/<int:id>/replies', methods=['POST'])
def create_reply(id):
    try:
        data = request.get_json()
        
        if not data or not data.get('content'):
            return jsonify({
                'success': False,
                'error': 'Content is required'
            }), 400
        
        # Check if whisper exists
        whispers = load_data(WHISPERS_FILE)
        whisper = next((w for w in whispers if w['id'] == id), None)
        
        if not whisper:
            return jsonify({'success': False, 'error': 'Whisper not found'}), 404
        
        replies = load_data(REPLIES_FILE)
        
        # Generate ID
        max_id = max([r['id'] for r in replies], default=0)
        
        reply = {
            'id': max_id + 1,
            'whisper_id': id,
            'content': data['content'].strip(),
            'created_at': datetime.utcnow().isoformat()
        }
        
        replies.append(reply)
        
        if save_data(REPLIES_FILE, replies):
            # Update replies count
            whisper['replies_count'] = len([r for r in replies if r['whisper_id'] == id])
            save_data(WHISPERS_FILE, whispers)
            
            return jsonify({
                'success': True,
                'data': reply
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Failed to save reply'
            }), 500
            
    except Exception as e:
        print(f"Error in create_reply: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Get topics
@app.route('/api/topics', methods=['GET'])
def get_topics():
    return jsonify({
        'success': True,
        'data': ALL_TOPICS
    })

# Health check
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy'})

if __name__ == '__main__':
    print(f"Data directory: {DATA_DIR}")
    print(f"Whispers file: {WHISPERS_FILE}")
    print(f"Replies file: {REPLIES_FILE}")
    app.run(debug=True, port=5000)