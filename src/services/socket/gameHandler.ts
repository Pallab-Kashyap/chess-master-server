import { Server, Socket } from "socket.io";
import { MessageHandler } from "./messageHandler";
import { SOCKET_MESSAGE_TYPE } from "../../constants";
import { SocketMoveMessage, MoveDTO, PlayerColor } from "../../types/game";
import {
  addMoveToGameHash,
  getGameHash,
  updateGameHash,
} from "../redis/gameHash";
import {
  socketErrorMessage,
  socketSuccessMessage,
} from "../../utils/socketResponse";
import { validateSocketMoveMessage } from "../../utils/validation";
import APIError from "../../utils/APIError";
import { ChessGameService } from "../chess/ChessGameService";
import GameModel from "../../models/game";
import { TimeManager } from "../time/TimeManager";

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

      // Initialize chess game service
      const chessGame = await ChessGameService.fromGameId(validatedData.gameId);

      // Validate and make the move
      const moveResult = chessGame.makeMove(validatedData.move, player.color);

      if (!moveResult.success) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.MOVE,
          socketErrorMessage.send(moveResult.error || "Invalid move")
        );
        return;
      }

      // Create move object with chess.js move details
      const move: MoveDTO = {
        move: moveResult.move.san, // Standard Algebraic Notation
        from: moveResult.move.from,
        to: moveResult.move.to,
        timeStamp: Date.now(),
      };

      // Add move to game hash (this updates Redis state)
      await addMoveToGameHash(validatedData.gameId, move, player.color);

      // Update time after move
      await TimeManager.updateTimeAfterMove(
        validatedData.gameId,
        player.color,
        move.timeStamp
      );

      // Update game state with new position
      await updateGameHash(validatedData.gameId, {
        pgn: chessGame.getPGN(),
        turn: chessGame.getTurn(),
      });

      // Get updated game state
      const updatedGameState = await getGameHash(validatedData.gameId);

      // Prepare response data
      const responseData = {
        move: moveResult.move,
        gameState: updatedGameState,
        fen: chessGame.getFEN(),
        pgn: chessGame.getPGN(),
        turn: chessGame.getTurn(),
        inCheck: moveResult.gameStatus?.inCheck || false,
        legalMoves: chessGame.getLegalMoves(),
      };

      // Check if game is over
      if (moveResult.gameStatus?.isGameOver) {
        // Stop the game timer
        TimeManager.stopGameTimer(validatedData.gameId);

        // Save game to database
        await chessGame.saveGameToDatabase();

        // Broadcast game over
        messageHandler.emitToRoom(
          validatedData.gameId,
          SOCKET_MESSAGE_TYPE.GAME_OVER,
          socketSuccessMessage.send(
            {
              ...responseData,
              result: moveResult.gameStatus.result,
              winner: moveResult.gameStatus.winner,
              reason: moveResult.gameStatus.reason,
            },
            `Game Over: ${moveResult.gameStatus.reason}`
          )
        );
      } else {
        // Broadcast the move to all players in the game room
        messageHandler.emitToRoom(
          validatedData.gameId,
          SOCKET_MESSAGE_TYPE.MOVE,
          socketSuccessMessage.send(responseData, "Move processed successfully")
        );
      }
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

  const handleGameStart = async (gameId: string) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.START,
          socketErrorMessage.send("Invalid game ID")
        );
        return;
      }

      // Get game from database to fetch rating changes
      const game = await GameModel.findById(gameId);
      const ratingChanges = game?.ratingChanges || null;

      // Join the game room
      socket.join(gameId);

      // Start the game timer
      await TimeManager.startGameTimer(gameId);

      socket.emit(
        SOCKET_MESSAGE_TYPE.START,
        socketSuccessMessage.send(
          {
            gameId,
            ratingChanges: ratingChanges,
          },
          "Joined game room"
        )
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

      // Get game from database to fetch rating changes
      const game = await GameModel.findById(gameId);
      const ratingChanges = game?.ratingChanges || null;

      // Initialize chess game to get current position
      const chessGame = await ChessGameService.fromGameId(gameId);

      // Join the game room
      socket.join(gameId);

      // Resume timer if game is still active
      if (!gameState.gameOver) {
        await TimeManager.resumeGameTimer(gameId);
      }

      socket.emit(
        SOCKET_MESSAGE_TYPE.REJOIN,
        socketSuccessMessage.send(
          {
            gameState,
            fen: chessGame.getFEN(),
            pgn: chessGame.getPGN(),
            turn: chessGame.getTurn(),
            legalMoves: chessGame.getLegalMoves(),
            gameStatus: chessGame.getGameStatus(),
            ratingChanges: ratingChanges,
          },
          "Rejoined game successfully"
        )
      );
    } catch (error) {
      socket.emit(
        SOCKET_MESSAGE_TYPE.REJOIN,
        socketErrorMessage.send("Failed to rejoin game")
      );
    }
  };

  const handleResign = async (gameId: string) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.RESIGN,
          socketErrorMessage.send("Invalid game ID")
        );
        return;
      }

      const gameState = await getGameHash(gameId);
      if (!gameState) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.RESIGN,
          socketErrorMessage.send("Game not found")
        );
        return;
      }

      // Find the player resigning
      const player = gameState.playerInfo.find((p) => p.userId === userId);
      if (!player) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.RESIGN,
          socketErrorMessage.send("You are not a player in this game")
        );
        return;
      }

      // Handle resignation
      const chessGame = await ChessGameService.fromGameId(gameId);
      await chessGame.handleResignation(player.color);

      // Stop the game timer
      TimeManager.stopGameTimer(gameId);

      // Broadcast resignation to all players
      messageHandler.emitToRoom(
        gameId,
        SOCKET_MESSAGE_TYPE.GAME_OVER,
        socketSuccessMessage.send(
          {
            winner: player.color === "white" ? "black" : "white",
            reason: "resignation",
            resignedPlayer: player.color,
          },
          `${player.color} resigned`
        )
      );
    } catch (error) {
      socket.emit(
        SOCKET_MESSAGE_TYPE.RESIGN,
        socketErrorMessage.send("Failed to resign")
      );
    }
  };

  const handleOfferDraw = async (gameId: string) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.OFFER_DRAW,
          socketErrorMessage.send("Invalid game ID")
        );
        return;
      }

      const gameState = await getGameHash(gameId);
      if (!gameState) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.OFFER_DRAW,
          socketErrorMessage.send("Game not found")
        );
        return;
      }

      // Find the player offering draw
      const player = gameState.playerInfo.find((p) => p.userId === userId);
      if (!player) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.OFFER_DRAW,
          socketErrorMessage.send("You are not a player in this game")
        );
        return;
      }

      // Find opponent
      const opponent = gameState.playerInfo.find((p) => p.userId !== userId);
      if (!opponent) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.OFFER_DRAW,
          socketErrorMessage.send("Opponent not found")
        );
        return;
      }

      // Send draw offer to opponent
      messageHandler.emitToRoom(
        gameId,
        SOCKET_MESSAGE_TYPE.OFFER_DRAW,
        socketSuccessMessage.send(
          {
            offeredBy: player.color,
            gameId: gameId,
          },
          `${player.color} offers a draw`
        )
      );
    } catch (error) {
      socket.emit(
        SOCKET_MESSAGE_TYPE.OFFER_DRAW,
        socketErrorMessage.send("Failed to offer draw")
      );
    }
  };

  const handleAcceptDraw = async (gameId: string) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.ACCEPT_DRAW,
          socketErrorMessage.send("Invalid game ID")
        );
        return;
      }

      const gameState = await getGameHash(gameId);
      if (!gameState) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.ACCEPT_DRAW,
          socketErrorMessage.send("Game not found")
        );
        return;
      }

      // Use ChessGameService to handle draw by agreement (includes rating calculations)
      const chessGame = await ChessGameService.fromGameId(gameId);
      await chessGame.handleDrawByAgreement();

      // Stop the game timer
      TimeManager.stopGameTimer(gameId);

      // Broadcast draw acceptance
      messageHandler.emitToRoom(
        gameId,
        SOCKET_MESSAGE_TYPE.GAME_OVER,
        socketSuccessMessage.send(
          {
            result: "1/2-1/2",
            winner: null,
            reason: "agreement",
          },
          "Game drawn by agreement"
        )
      );
    } catch (error) {
      socket.emit(
        SOCKET_MESSAGE_TYPE.ACCEPT_DRAW,
        socketErrorMessage.send("Failed to accept draw")
      );
    }
  };

  const handleTimeUp = async (data: any) => {
    try {
      const { gameId, playerColor } = data;

      if (!gameId || !playerColor) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.TIME_UP,
          socketErrorMessage.send(
            "Invalid data: gameId and playerColor required"
          )
        );
        return;
      }

      if (!["white", "black"].includes(playerColor)) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.TIME_UP,
          socketErrorMessage.send("Invalid player color")
        );
        return;
      }

      // Handle client reporting time up
      await TimeManager.handleClientTimeUpReport(gameId, userId, playerColor);
    } catch (error) {
      socket.emit(
        SOCKET_MESSAGE_TYPE.TIME_UP,
        socketErrorMessage.send("Failed to process time up")
      );
    }
  };

  const handleRequestTimeSync = async (gameId: string) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.REQUEST_TIME_SYNC,
          socketErrorMessage.send("Invalid game ID")
        );
        return;
      }

      // Sync time with client
      await TimeManager.syncTimeWithClient(gameId, socket.id);
    } catch (error) {
      socket.emit(
        SOCKET_MESSAGE_TYPE.REQUEST_TIME_SYNC,
        socketErrorMessage.send("Failed to sync time")
      );
    }
  };

  // Register event handlers
  socket.on(SOCKET_MESSAGE_TYPE.MOVE, handleMove);
  socket.on(SOCKET_MESSAGE_TYPE.START, handleGameStart);
  socket.on(SOCKET_MESSAGE_TYPE.REJOIN, handleRejoin);
  socket.on(SOCKET_MESSAGE_TYPE.RESIGN, handleResign);
  socket.on(SOCKET_MESSAGE_TYPE.OFFER_DRAW, handleOfferDraw);
  socket.on(SOCKET_MESSAGE_TYPE.ACCEPT_DRAW, handleAcceptDraw);
  socket.on(SOCKET_MESSAGE_TYPE.TIME_UP, handleTimeUp);
  socket.on(SOCKET_MESSAGE_TYPE.REQUEST_TIME_SYNC, handleRequestTimeSync);
};
