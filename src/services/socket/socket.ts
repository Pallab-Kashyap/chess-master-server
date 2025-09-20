import { io } from "../../app";
import { verifyToken } from "../../utils/generateToken";
import { updateSocketId } from "../redis/playerHash";
import { registerGameHandler } from "./gameHandler";
import { registerMatchmakingHandler } from "./matchmakingHandler";
import { TimeManager } from "../time/TimeManager";

export const setupSockets = () => {
  // Initialize TimeManager with Socket.IO instance
  TimeManager.initialize(io);

  io.on("connection", async (socket) => {
    const token = socket.handshake.auth?.token;

    try {
      const payload = verifyToken(token);
      await updateSocketId(payload.userId, socket.id);

      console.log(
        `🔌 User ${payload.userId} connected with socket ${socket.id}`
      );

      // Register game handler with userId
      registerGameHandler(io, socket, payload.userId);

      // Register matchmaking handler with userId
      registerMatchmakingHandler(io, socket, payload.userId);
    } catch (error) {
      console.error("❌ Socket authentication failed:", error);
      socket.disconnect();
      return;
    }

    socket.on("ping", () => {
      socket.emit("pong");
    });

    socket.on("disconnect", (reason) => {
      console.log(`🔌 Socket disconnected: ${reason}`);

      // Handle disconnection for active games
      // Note: In a production system, you might want to track which games
      // the user is currently playing and pause timers for those games
      // For now, we'll rely on the resume mechanism when they rejoin
    });
  });
};
