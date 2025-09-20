import { createServer } from "http";
import express, { request, response } from "express";
import { Server } from "socket.io";
import dotenv from 'dotenv'
import errorHandler from "./middlewares/errorHandler";
import cors, {} from 'cors'
import { setupSockets } from "./services/socket/socket";
import userRouter from './routes/userRoutes'

const app = express()
const server = createServer(app);
export const io = new Server(server, {
  cors: {
    origin: "*"
  }
})

setupSockets()



app.use(cors({
  origin: "*"
}))

dotenv.config()

app.get('/', (request, response) => {
  response.send('<h1>hello<h1>')
})

app.use('/api/v1/user', userRouter)



app.use(errorHandler)

export default server;
