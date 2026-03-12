const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const sharedSession = require("express-socket.io-session");
const bcrypt = require('bcrypt');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// ------------------ Middleware ------------------
const sessionMiddleware = session({
    secret: 'kizuna_secret_key',
    resave: false,
    saveUninitialized: true
});

app.use(sessionMiddleware);
io.use(sharedSession(sessionMiddleware, { autoSave:true }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ------------------ ROUTES ------------------

// Inscription
app.post('/signup', async (req, res) => {

    const { username, email, password } = req.body;

    if(!username || !email || !password){
        return res.json({ error: "Tous les champs sont obligatoires" });
    }

    try{

        // Hash du mot de passe
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run(
            'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
            [username, email, hashedPassword],
            function(err){

                if(err){

                    // Email déjà utilisé
                    if(err.message.includes("users.email")){
                        return res.json({
                            error: "Cet email est déjà utilisé"
                        });
                    }

                    // Username déjà utilisé
                    if(err.message.includes("users.username")){
                        return res.json({
                            error: "Ce pseudo est déjà pris"
                        });
                    }

                    // Autre erreur SQL
                    return res.json({
                        error: err.message
                    });

                }

                // Succès
                return res.json({
                    message: "Inscription réussie"
                });

            }
        );

    }catch(error){

        return res.json({
            error: "Erreur serveur"
        });

    }

});

// Connexion
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if(err) return res.status(400).json({ error: err.message });
        if(!user) return res.status(400).json({ error: 'Utilisateur non trouvé' });

        const match = await bcrypt.compare(password, user.password);
        if(match){
            req.session.userId = user.id;
            res.json({ message: 'Connexion réussie !', userId: user.id, username: user.username });
        } else {
            res.status(400).json({ error: 'Mot de passe incorrect' });
        }
    });
});

// Liste des utilisateurs (contacts)
app.get('/users', (req, res) => {
    const currentUserId = req.session.userId;
    if(!currentUserId) return res.status(401).json({ error: "Non connecté" });

    db.all('SELECT id, username FROM users WHERE id != ?', [currentUserId], (err, rows) => {
        if(err) return res.status(400).json({ error: err.message });
        res.json(rows);
    });
});

// Messages entre deux utilisateurs
app.get('/messages/:receiverId', (req, res) => {
    const senderId = req.session.userId;
    const receiverId = req.params.receiverId;
    if(!senderId) return res.status(401).json({ error: "Non connecté" });

    db.all(
        'SELECT * FROM messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY created_at ASC',
        [senderId, receiverId, receiverId, senderId],
        (err, rows) => {
            if(err) return res.status(400).json({ error: err.message });
            res.json(rows);
        }
    );
});

// ------------------ CHAT PRIVÉ ------------------
const connectedUsers = {}; // userId => socket

io.on('connection', socket => {
    const userId = socket.handshake.session.userId;
    if(!userId) return;

    connectedUsers[userId] = socket;

    socket.on('private message', ({receiverId, content}) => {
        // Sauvegarder dans la DB
        db.run(
            'INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)',
            [userId, receiverId, content],
            function(err){
                if(err) console.log(err);
            }
        );

        // Envoyer au destinataire si connecté
        const receiverSocket = connectedUsers[receiverId];
        if(receiverSocket){
            receiverSocket.emit('private message', {
                senderId: userId,
                content,
                created_at: new Date()
            });
        }
        // Émettre aussi à l’expéditeur pour affichage immédiat
        socket.emit('private message', {
            senderId: userId,
            content,
            created_at: new Date()
        });
    });

    socket.on('disconnect', () => {
        delete connectedUsers[userId];
    });
});

// ------------------ LANCEMENT SERVEUR ------------------
server.listen(PORT, () => {
    console.log(`Serveur Kizuna lancé sur http://localhost:${PORT}`);
});