-- Create database
CREATE DATABASE IF NOT EXISTS whisper_field;
USE whisper_field;

-- Create whispers table
CREATE TABLE whispers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    content TEXT NOT NULL,
    topic ENUM('confession', 'life', 'secrets', 'advice', 'love', 'random') NOT NULL,
    is_sensitive BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL
);

-- Create replies table
CREATE TABLE replies (
    id INT PRIMARY KEY AUTO_INCREMENT,
    whisper_id INT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMP NULL,
    FOREIGN KEY (whisper_id) REFERENCES whispers(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX idx_whispers_topic ON whispers(topic);
CREATE INDEX idx_whispers_created ON whispers(created_at);
CREATE INDEX idx_replies_whisper ON replies(whisper_id);
CREATE INDEX idx_whispers_deleted ON whispers(deleted_at);

-- Insert sample data (optional)
INSERT INTO whispers (content, topic, is_sensitive) VALUES
('Sometimes I wonder if anyone would notice if I disappeared for a week.', 'life', FALSE),
('I secretly enjoy watching the rain more than going to parties.', 'confession', FALSE),
('TW: Anxiety. Sometimes my thoughts get so loud I can hear anything else.', 'secrets', TRUE),
('Advice: Write letters to your future self.', 'advice', FALSE),
('I still think about that stranger who smiled at me three years ago.', 'love', FALSE),
('If the moon had a sound, what would it be?', 'random', FALSE);

-- Insert sample replies
INSERT INTO replies (whisper_id, content) VALUES
(1, 'I would notice. We all leave ripples.'),
(1, 'This hits close to home.'),
(3, 'You''re not alone. One breath at a time.'),
(4, 'Started doing this last year. Can confirm it''s magical.');