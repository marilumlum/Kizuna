const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const http = require("http");
const socketIO = require("socket.io");
const sharedsession = require("express-socket.io-session");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sessions
const sessionMiddleware = session({
    secret: "kizuna_secret",
    resave: false,
    saveUninitialized: true
});
app.use(sessionMiddleware);
io.use(sharedsession(sessionMiddleware, { autoSave: true }));

// PAGE PAR DÉFAUT → LOGIN
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/login.html"));
});

// Fichiers statiques
app.use(express.static(path.join(__dirname, "../public")));

// Database
const db = new sqlite3.Database("./server/users.db", (err) => {
    if (err) console.log(err);
    else console.log("Database connected");
});

db.serialize(() => {
    // Users
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password TEXT
    )`);

    // Messages
    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Friends
    db.run(`CREATE TABLE IF NOT EXISTS friends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        friend_id INTEGER,
        status TEXT
    )`);
});

// SIGNUP
app.post("/signup", async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.json({ error: "Tous les champs sont obligatoires" });

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
        "INSERT INTO users (username,email,password) VALUES (?,?,?)",
        [username, email, hashedPassword],
        function(err) {
            if (err) {
                if (err.message.includes("users.email")) return res.json({ error: "Email déjà utilisé" });
                if (err.message.includes("users.username")) return res.json({ error: "Pseudo déjà pris" });
                return res.json({ error: "Erreur inscription" });
            }
            res.json({ message: "Inscription réussie" });
        }
    );
});

// LOGIN
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username=?", [username], async (err, user) => {
        if (!user) return res.json({ error: "Utilisateur introuvable" });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.json({ error: "Mot de passe incorrect" });
        req.session.userId = user.id;
        req.session.username = user.username;
        res.json({ message: "Connexion réussie" });
    });
});

// Liste des utilisateurs (hors session actuelle)
app.get("/users", (req, res) => {
    const currentUser = req.session.userId || 0;
    db.all("SELECT id,username FROM users WHERE id != ?", [currentUser], (err, rows) => {
        res.json(rows || []);
    });
});

// FRIEND REQUESTS

// Envoyer une demande d'ami
app.post("/friend-request", (req, res) => {
    const userId = req.session.userId;
    const friendId = req.body.friendId;

    if (!userId || !friendId) return res.json({ error: "Utilisateur manquant" });

    db.get(
        "SELECT * FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)",
        [userId, friendId, friendId, userId],
        (err, row) => {
            if (row) return res.json({ error: "Demande déjà envoyée ou déjà amis" });

            db.run(
                "INSERT INTO friends (user_id, friend_id, status) VALUES (?,?,?)",
                [userId, friendId, "pending"],
                function(err){
                    if(err) return res.json({ error: "Impossible d'envoyer la demande" });
                    res.json({ message: "Demande envoyée" });
                }
            );
        }
    );
});

// Voir les demandes reçues
app.get("/friend-requests", (req,res)=>{
    const userId = req.session.userId;
    db.all(
        "SELECT f.id,f.user_id,u.username FROM friends f JOIN users u ON f.user_id=u.id WHERE f.friend_id=? AND f.status='pending'",
        [userId], (err, rows)=>{
            res.json(rows || []);
        });
});

// Accepter une demande d'ami
app.post("/friend-accept", (req,res)=>{
    const userId = req.session.userId;
    const requestId = req.body.requestId;
    db.run("UPDATE friends SET status='accepted' WHERE id=? AND friend_id=?", [requestId,userId], function(err){
        if(err) return res.json({ error: "Impossible d'accepter la demande" });
        res.json({ message: "Ami ajouté" });
    });
});

// Supprimer un ami
app.post("/friend-delete", (req,res)=>{
    const userId = req.session.userId;
    const friendId = req.body.friendId;

    db.run("DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)",
        [userId, friendId, friendId, userId], function(err){
            if(err) return res.json({ error: "Impossible de supprimer l'ami" });
            res.json({ message: "Ami supprimé" });
        });
});

// Liste des amis
app.get("/friends", (req,res)=>{
    const userId = req.session.userId;
    db.all(
        `SELECT u.id,u.username FROM friends f 
         JOIN users u ON (u.id=f.friend_id OR u.id=f.user_id) 
         WHERE f.status='accepted' AND (f.user_id=? OR f.friend_id=?) AND u.id!=?`,
        [userId,userId,userId], (err,rows)=>{
            res.json(rows || []);
        }
    );
});

// MESSAGES (amis seulement)
app.get("/messages/:id", (req, res) => {
    const userId = req.session.userId;
    const otherId = req.params.id;
    // Vérifier qu'ils sont amis
    db.get(
        "SELECT * FROM friends WHERE status='accepted' AND ((user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?))",
        [userId, otherId, otherId, userId], 
        (err,row)=>{
            if(!row) return res.json({ error: "Vous n'êtes pas amis" });

            db.all(
                `SELECT * FROM messages
                 WHERE (sender_id=? AND receiver_id=?)
                 OR (sender_id=? AND receiver_id=?)
                 ORDER BY timestamp`,
                [userId, otherId, otherId, userId],
                (err, rows) => {
                    res.json(rows || []);
                }
            );
        }
    );
});

// SOCKET CHAT (amis seulement)
io.on("connection", (socket) => {
    const userId = socket.handshake.session.userId;
    if (!userId) return;

    socket.on("private message", (msg) => {
        db.get(
            "SELECT * FROM friends WHERE status='accepted' AND ((user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?))",
            [userId, msg.receiverId, msg.receiverId, userId],
            (err,row)=>{
                if(!row) return; // pas ami → message refusé

                db.run(
                    "INSERT INTO messages (sender_id,receiver_id,content) VALUES (?,?,?)",
                    [userId, msg.receiverId, msg.content]
                );

                io.emit("private message", {
                    senderId: userId,
                    receiverId: msg.receiverId,
                    content: msg.content
                });
            }
        );
    });
});

// Démarrer serveur
server.listen(PORT, () => {
    console.log("Kizuna server running on port " + PORT);
});