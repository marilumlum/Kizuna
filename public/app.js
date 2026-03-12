const socket = io()

function sendMessage(){

const input = document.getElementById("messageInput")

if(input.value.trim() === "") return

socket.emit("message", input.value)

input.value = ""

}

socket.on("message",(msg)=>{

const div = document.createElement("div")

div.textContent = msg

document.getElementById("messages").appendChild(div)

})