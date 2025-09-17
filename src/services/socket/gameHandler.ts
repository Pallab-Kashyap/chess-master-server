import { Server, Socket } from "socket.io";
import { MessageHandler } from "./messageHandler";
import { SOCKET_MESSAGE_TYPE } from "../../constants";
import { SocketMoveMessage, MoveDTO, PlayerColor } from "../../types/game";
import { addMoveToGameHash, getGameHash } from "../redis/gameHash";
import {
  socketErrorMessage,
  socketSuccessMessage,
} from "../../utils/socketResponse";
import { validateSocketMoveMessage } from "../../utils/validation";
import APIError from "../../utils/APIError";

export const registerGameHandler = (
  io: Server,
  socket: Socket,
  userId: string
) => {
  const messageHandler = new MessageHandler(io);

  const handleMove = async (data: any) => {
    try {
      // Validate the move data
      const validatedData = validateSocketMoveMessage(data);

      // Get current game state
      const gameState = await getGameHash(validatedData.gameId);
      if (!gameState) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.MOVE,
          socketErrorMessage.send("Game not found")
        );
        return;
      }

      // Find the player making the move
      const player = gameState.playerInfo.find((p) => p.userId === userId);
      if (!player) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.MOVE,
          socketErrorMessage.send("You are not a player in this game")
        );
        return;
      }

      // Create move object
      const move: MoveDTO = {
        move: validatedData.move,
        from: validatedData.from,
        to: validatedData.to,
        timeStamp: Date.now(),
      };

      // Add move to game hash (this validates turn and updates state)
      await addMoveToGameHash(validatedData.gameId, move, player.color);

      // Get updated game state
      const updatedGameState = await getGameHash(validatedData.gameId);

      // Broadcast the move to all players in the game room
      messageHandler.emitToRoom(
        validatedData.gameId,
        SOCKET_MESSAGE_TYPE.MOVE,
        socketSuccessMessage.send(
          {
            move,
            gameState: updatedGameState,
          },
          "Move processed successfully"
        )
      );
    } catch (error) {
      const errorMessage =
        error instanceof APIError
          ? error.message
          : error instanceof Error
          ? error.message
          : "Failed to process move";
      socket.emit(
        SOCKET_MESSAGE_TYPE.MOVE,
        socketErrorMessage.send(errorMessage)
      );
    }
  };

  const handleGameStart = (gameId: string) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.START,
          socketErrorMessage.send("Invalid game ID")
        );
        return;
      }

      // Join the game room
      socket.join(gameId);
      socket.emit(
        SOCKET_MESSAGE_TYPE.START,
        socketSuccessMessage.send({ gameId }, "Joined game room")
      );
    } catch (error) {
      socket.emit(
        SOCKET_MESSAGE_TYPE.START,
        socketErrorMessage.send("Failed to join game")
      );
    }
  };

  const handleRejoin = async (gameId: string) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.REJOIN,
          socketErrorMessage.send("Invalid game ID")
        );
        return;
      }

      const gameState = await getGameHash(gameId);
      if (!gameState) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.REJOIN,
          socketErrorMessage.send("Game not found")
        );
        return;
      }

      // Check if user is part of this game
      const player = gameState.playerInfo.find((p) => p.userId === userId);
      if (!player) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.REJOIN,
          socketErrorMessage.send("You are not a player in this game")
        );
        return;
      }

      // Join the game room
      socket.join(gameId);
      socket.emit(
        SOCKET_MESSAGE_TYPE.REJOIN,
        socketSuccessMessage.send({ gameState }, "Rejoined game successfully")
      );
    } catch (error) {
      socket.emit(
        SOCKET_MESSAGE_TYPE.REJOIN,
        socketErrorMessage.send("Failed to rejoin game")
      );
    }
  };

  // Register event handlers
  socket.on(SOCKET_MESSAGE_TYPE.MOVE, handleMove);
  socket.on(SOCKET_MESSAGE_TYPE.START, handleGameStart);
  socket.on(SOCKET_MESSAGE_TYPE.REJOIN, handleRejoin);
};
