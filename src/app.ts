import { createServer } from "http";
import express, { request, response } from "express";
import { Server } from "socket.io";
import dotenv from "dotenv";
import errorHandler from "./middlewares/errorHandler";
import cors from "cors";
import { setupSockets } from "./services/socket/socket";
import userRouter from "./routes/userRoutes";
import gameRouter from "./routes/gameRoutes";
import ratingRouter from "./routes/ratingRoutes";

const app = express();
const server = createServer(app);
export const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// Initialize sockets asynchronously
export const initializeSockets = async () => {
  await setupSockets();
};

app.use(express.json());

app.use(
  cors({
    origin: "*",
  }),
);

dotenv.config();

app.get("/", (request, response) => {
  response.send("<h1>Chess Server API<h1>");
});

app.use("/api/v1/user", userRouter);
app.use("/api/v1/game", gameRouter);
app.use("/api/v1/rating", ratingRouter);

app.use(errorHandler);

export default server;
