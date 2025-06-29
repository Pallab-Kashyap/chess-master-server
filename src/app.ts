import { createServer } from "http";
import express from "express";
import { Server } from "socket.io";
import dotenv from 'dotenv'

const app = express()
const server = createServer(app);

dotenv.config()

const io = new Server(server, {
  /* options */
});

io.on("connection", (socket) => {
  // ...
});

export default server;
