const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
};

let pool;

async function initDatabase() {
    try {
        pool = mysql.createPool(dbConfig);
        
        // Test connection
        const connection = await pool.getConnection();
        console.log('✅ Connected to MySQL database');
        connection.release();
        
        // Create tables if they don't exist
        await createTables();
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error);
        return false;
    }
}

async function createTables() {
    try {
        // Create whispers table
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS whispers (
                id INT PRIMARY KEY AUTO_INCREMENT,
                content TEXT NOT NULL,
                topic ENUM('confession', 'life', 'secrets', 'advice', 'love', 'random') NOT NULL,
                is_sensitive BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP NULL,
                INDEX idx_topic (topic),
                INDEX idx_created (created_at)
            )
        `);
        
        // Create replies table
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS replies (
                id INT PRIMARY KEY AUTO_INCREMENT,
                whisper_id INT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                deleted_at TIMESTAMP NULL,
                FOREIGN KEY (whisper_id) REFERENCES whispers(id) ON DELETE CASCADE,
                INDEX idx_whisper (whisper_id)
            )
        `);
        
        console.log('✅ Tables created/verified');
    } catch (error) {
        console.error('❌ Error creating tables:', error);
    }
}

// API Routes

// Get whispers
app.get('/api/whispers', async (req, res) => {
    try {
        const { topic } = req.query;
        let query = 'SELECT * FROM whispers WHERE deleted_at IS NULL';
        const params = [];
        
        if (topic && topic !== 'all') {
            query += ' AND topic = ?';
            params.push(topic);
        }
        
        query += ' ORDER BY created_at DESC';
        
        const [rows] = await pool.execute(query, params);
        
        // Get reply count
        for (let whisper of rows) {
            const [replyRows] = await pool.execute(
                'SELECT COUNT(*) as count FROM replies WHERE whisper_id = ? AND deleted_at IS NULL',
                [whisper.id]
            );
            whisper.replies_count = replyRows[0].count;
        }
        
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Error fetching whispers:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch whispers' });
    }
});

// Get single whisper
app.get('/api/whispers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute(
            'SELECT * FROM whispers WHERE id = ? AND deleted_at IS NULL',
            [id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Whisper not found' });
        }
        
        res.json({ success: true, data: rows[0] });
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
        
        const [result] = await pool.execute(
            'INSERT INTO whispers (content, topic, is_sensitive) VALUES (?, ?, ?)',
            [content, topic, is_sensitive || false]
        );
        
        const [rows] = await pool.execute(
            'SELECT * FROM whispers WHERE id = ?',
            [result.insertId]
        );
        
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Error creating whisper:', error);
        res.status(500).json({ success: false, error: 'Failed to create whisper' });
    }
});

// Get replies
app.get('/api/whispers/:id/replies', async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.execute(
            'SELECT * FROM replies WHERE whisper_id = ? AND deleted_at IS NULL ORDER BY created_at ASC',
            [id]
        );
        
        res.json({ success: true, data: rows });
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
        
        const [whisperRows] = await pool.execute(
            'SELECT id FROM whispers WHERE id = ? AND deleted_at IS NULL',
            [id]
        );
        
        if (whisperRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Whisper not found' });
        }
        
        const [result] = await pool.execute(
            'INSERT INTO replies (whisper_id, content) VALUES (?, ?)',
            [id, content]
        );
        
        const [rows] = await pool.execute(
            'SELECT * FROM replies WHERE id = ?',
            [result.insertId]
        );
        
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Error creating reply:', error);
        res.status(500).json({ success: false, error: 'Failed to create reply' });
    }
});

// Auto-delete function
async function autoDeleteOldWhispers() {
    try {
        const deleteTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
        
        await pool.execute(
            'UPDATE whispers SET deleted_at = NOW() WHERE created_at < ? AND deleted_at IS NULL',
            [deleteTime]
        );
        
        console.log('✅ Auto-delete completed');
    } catch (error) {
        console.error('❌ Auto-delete failed:', error);
    }
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
async function startServer() {
    const dbConnected = await initDatabase();
    
    if (!dbConnected) {
        console.error('Failed to connect to database. Exiting...');
        process.exit(1);
    }
    
    // Schedule auto-delete every hour
    setInterval(autoDeleteOldWhispers, 60 * 60 * 1000);
    
    // Run on startup
    autoDeleteOldWhispers();
    
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📝 API available at http://localhost:${PORT}/api`);
    });
}

startServer();