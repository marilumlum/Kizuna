const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors")
const path = require("path")

const app = express()
app.use(cors())

const server = http.createServer(app)
const io = new Server(server)

app.use(express.static(path.join(__dirname, "../public")))

io.on("connection", (socket) => {
    console.log("Utilisateur connecté")

    socket.on("message", (data) => {
        io.emit("message", data)
    })

    socket.on("disconnect", () => {
        console.log("Utilisateur déconnecté")
    })
})

server.listen(3000, () => {
    console.log("Serveur Kizuna lancé sur http://localhost:3000")
})