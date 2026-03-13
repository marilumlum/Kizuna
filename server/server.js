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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// session
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

// fichiers publics
app.use(express.static(path.join(__dirname, "../public")));

// database
const db = new sqlite3.Database("./server/users.db");

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
        content TEXT
    )`);

});

// signup
app.post("/signup", async (req, res) => {

    const { username, email, password } = req.body;

    const hashed = await bcrypt.hash(password, 10);

    db.run(
        "INSERT INTO users (username,email,password) VALUES (?,?,?)",
        [username, email, hashed],
        function(err){

            if(err){
                return res.json({error:"Utilisateur ou email déjà utilisé"});
            }

            res.json({message:"Compte créé"});
        }
    );

});

// login
app.post("/login", (req, res) => {

    const { username, password } = req.body;

    db.get(
        "SELECT * FROM users WHERE username=?",
        [username],
        async (err,user)=>{

            if(!user){
                return res.json({error:"Utilisateur introuvable"});
            }

            const match = await bcrypt.compare(password,user.password);

            if(!match){
                return res.json({error:"Mot de passe incorrect"});
            }

            req.session.userId = user.id;

            res.json({message:"Connexion réussie"});
        }
    );

});

// utilisateurs
app.get("/users",(req,res)=>{

    db.all("SELECT id,username FROM users",(err,rows)=>{

        res.json(rows || []);

    });

});

// messages
app.get("/messages/:id",(req,res)=>{

    const userId=req.session.userId;
    const other=req.params.id;

    db.all(
        `SELECT * FROM messages
         WHERE (sender_id=? AND receiver_id=?)
         OR (sender_id=? AND receiver_id=?)`,
        [userId,other,other,userId],
        (err,rows)=>{

            res.json(rows || []);

        }
    );

});

// socket
io.on("connection",(socket)=>{

    const userId = socket.handshake.session.userId;

    if(!userId) return;

    socket.on("private message",(msg)=>{

        db.run(
            "INSERT INTO messages (sender_id,receiver_id,content) VALUES (?,?,?)",
            [userId,msg.receiverId,msg.content]
        );

        io.emit("private message",msg);

    });

});

server.listen(PORT,()=>{
    console.log("Kizuna server running on port "+PORT);
});