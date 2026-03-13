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

// middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// sessions
const sessionMiddleware = session({
    secret: "kizuna_secret",
    resave: false,
    saveUninitialized: true
});

app.use(sessionMiddleware);
io.use(sharedsession(sessionMiddleware, { autoSave: true }));

// servir les fichiers publics
app.use(express.static(path.join(__dirname, "../public")));

// page par défaut → login
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/login.html"));
});

// base de données
const db = new sqlite3.Database("./server/users.db", (err) => {
    if (err) console.log(err);
    else console.log("Database connected");
});

db.serialize(() => {

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id INTEGER,
        receiver_id INTEGER,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

});

// SIGNUP
app.post("/signup", async (req, res) => {

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.json({ error: "Tous les champs sont obligatoires" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
        "INSERT INTO users (username,email,password) VALUES (?,?,?)",
        [username, email, hashedPassword],
        function (err) {

            if (err) {

                if (err.message.includes("users.email")) {
                    return res.json({ error: "Email déjà utilisé" });
                }

                if (err.message.includes("users.username")) {
                    return res.json({ error: "Pseudo déjà pris" });
                }

                return res.json({ error: "Erreur inscription" });
            }

            res.json({ message: "Inscription réussie" });

        }
    );

});

// LOGIN
app.post("/login", (req, res) => {

    const { username, password } = req.body;

    db.get(
        "SELECT * FROM users WHERE username=?",
        [username],
        async (err, user) => {

            if (!user) {
                return res.json({ error: "Utilisateur introuvable" });
            }

            const match = await bcrypt.compare(password, user.password);

            if (!match) {
                return res.json({ error: "Mot de passe incorrect" });
            }

            req.session.userId = user.id;
            req.session.username = user.username;

            res.json({ message: "Connexion réussie" });

        }
    );

});

// LISTE UTILISATEURS
app.get("/users", (req, res) => {

    const currentUser = req.session.userId || 0;

    db.all(
        "SELECT id,username FROM users WHERE id != ?",
        [currentUser],
        (err, rows) => {

            if (err) return res.json([]);

            res.json(rows);

        }
    );

});

// MESSAGES
app.get("/messages/:id", (req, res) => {

    const userId = req.session.userId;
    const otherId = req.params.id;

    db.all(
        `SELECT * FROM messages
         WHERE (sender_id=? AND receiver_id=?)
         OR (sender_id=? AND receiver_id=?)
         ORDER BY timestamp`,
        [userId, otherId, otherId, userId],
        (err, rows) => {

            if (err) return res.json([]);

            res.json(rows);

        }
    );

});

// SOCKET CHAT
io.on("connection", (socket) => {

    const userId = socket.handshake.session.userId;

    if (!userId) return;

    socket.on("private message", (msg) => {

        db.run(
            "INSERT INTO messages (sender_id,receiver_id,content) VALUES (?,?,?)",
            [userId, msg.receiverId, msg.content],
            function () {

                io.emit("private message", {
                    senderId: userId,
                    receiverId: msg.receiverId,
                    content: msg.content
                });

            }
        );

    });

});

// démarrer serveur
server.listen(PORT, () => {
    console.log("Kizuna server running on port " + PORT);
});