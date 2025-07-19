import { createServer } from "http";
import express, { request, response } from "express";
import { Server } from "socket.io";
import dotenv from 'dotenv'

const app = express()
const server = createServer(app);

dotenv.config()

app.get('/', (request, response) => {
  response.send('<h1>hellow<h1>')
})

const io = new Server(server, {
  /* options */
});

io.on("connection", (socket) => {
  // ...
});

export default server;
