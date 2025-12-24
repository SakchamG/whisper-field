const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL connection - using environment variables
const pool = new Pool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 5432,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection error:', err.message);
    } else {
        console.log('✅ Connected to PostgreSQL database');
        
        // Create tables
        client.query(`
            CREATE TABLE IF NOT EXISTS whispers (
                id SERIAL PRIMARY KEY,
                content TEXT NOT NULL,
                topic VARCHAR(50) NOT NULL CHECK (topic IN ('confession', 'life', 'secrets', 'advice', 'love', 'random')),
                is_sensitive BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP NULL
            )
        `, (err) => {
            if (err) console.error('Error creating whispers table:', err);
            else console.log('✅ Whispers table ready');
        });
        
        client.query(`
            CREATE TABLE IF NOT EXISTS replies (
                id SERIAL PRIMARY KEY,
                whisper_id INT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP NULL,
                FOREIGN KEY (whisper_id) REFERENCES whispers(id) ON DELETE CASCADE
            )
        `, (err) => {
            if (err) console.error('Error creating replies table:', err);
            else console.log('✅ Replies table ready');
        });
        
        release();
    }
});

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        message: 'Whisper Field API is running'
    });
});

// Get all whispers
app.get('/api/whispers', async (req, res) => {
    try {
        const { topic } = req.query;
        let query = 'SELECT * FROM whispers WHERE deleted_at IS NULL';
        let params = [];
        
        if (topic && topic !== 'all') {
            query += ' AND topic = $1';
            params.push(topic);
        }
        
        query += ' ORDER BY created_at DESC';
        
        const result = await pool.query(query, params);
        
        // Get reply counts for each whisper
        const whispersWithReplies = await Promise.all(
            result.rows.map(async (whisper) => {
                const replyResult = await pool.query(
                    'SELECT COUNT(*) as count FROM replies WHERE whisper_id = $1 AND deleted_at IS NULL',
                    [whisper.id]
                );
                return {
                    ...whisper,
                    replies_count: parseInt(replyResult.rows[0].count) || 0
                };
            })
        );
        
        res.json({ success: true, data: whispersWithReplies });
    } catch (error) {
        console.error('Error fetching whispers:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch whispers' });
    }
});

// Get single whisper
app.get('/api/whispers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT * FROM whispers WHERE id = $1 AND deleted_at IS NULL',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Whisper not found' });
        }
        
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Error fetching whisper:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch whisper' });
    }
});

// Create new whisper
app.post('/api/whispers', async (req, res) => {
    try {
        const { content, topic, is_sensitive } = req.body;
        
        if (!content || !topic) {
            return res.status(400).json({ success: false, error: 'Content and topic are required' });
        }
        
        const result = await pool.query(
            'INSERT INTO whispers (content, topic, is_sensitive) VALUES ($1, $2, $3) RETURNING *',
            [content, topic, is_sensitive || false]
        );
        
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Error creating whisper:', error);
        res.status(500).json({ success: false, error: 'Failed to create whisper' });
    }
});

// Get replies for a whisper
app.get('/api/whispers/:id/replies', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'SELECT * FROM replies WHERE whisper_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
            [id]
        );
        
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error fetching replies:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch replies' });
    }
});

// Create reply
app.post('/api/whispers/:id/replies', async (req, res) => {
    try {
        const { id } = req.params;
        const { content } = req.body;
        
        if (!content) {
            return res.status(400).json({ success: false, error: 'Content is required' });
        }
        
        // Check if whisper exists
        const whisperResult = await pool.query(
            'SELECT id FROM whispers WHERE id = $1 AND deleted_at IS NULL',
            [id]
        );
        
        if (whisperResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Whisper not found' });
        }
        
        const result = await pool.query(
            'INSERT INTO replies (whisper_id, content) VALUES ($1, $2) RETURNING *',
            [id, content]
        );
        
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error('Error creating reply:', error);
        res.status(500).json({ success: false, error: 'Failed to create reply' });
    }
});

// Auto-delete old whispers (runs every hour)
setInterval(async () => {
    try {
        const deleteTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
        
        await pool.query(
            'UPDATE whispers SET deleted_at = NOW() WHERE created_at < $1 AND deleted_at IS NULL',
            [deleteTime]
        );
        
        console.log('✅ Auto-delete completed:', new Date().toISOString());
    } catch (error) {
        console.error('❌ Auto-delete failed:', error);
    }
}, 60 * 60 * 1000); // Run every hour

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📝 Health check: http://localhost:${PORT}/api/health`);
    console.log(`📝 API Base: http://localhost:${PORT}/api`);
});