import { io } from "../../app";
import { verifyToken } from "../../utils/generateToken";
import { updateSocketId } from "../redis/playerHash";
import { registerGameHandler } from "./gameHandler";

export const setupSockets = () => {
  io.on("connection", async (socket) => {
    const token = socket.handshake.auth?.token

    try {
        const payload = verifyToken(token)
        await updateSocketId(payload.userId, socket.id);
    } catch (error) {

            socket.disconnect();
    }

    registerGameHandler(io, socket)

    socket.on("ping", () => {
      socket.emit("pong");
    });
  });
};
