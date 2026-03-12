const sqlite3 = require('sqlite3').verbose();

// Crée ou ouvre la base de données
const db = new sqlite3.Database('./users.db', (err) => {
    if(err) console.error(err.message);
    else console.log('Base de données SQLite connectée');
});

// Table utilisateurs
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT
)`);

// Table messages privés
db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER,
    receiver_id INTEGER,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(receiver_id) REFERENCES users(id)
)`);

module.exports = db;