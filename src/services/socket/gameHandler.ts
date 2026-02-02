import { Server, Socket } from "socket.io";
import { MessageHandler } from "./messageHandler";
import { SOCKET_MESSAGE_TYPE } from "../../constants";
import {
  SocketMoveMessage,
  MoveDTO,
  PlayerColor,
  PlayerDTO,
  DEFAULT_FEN,
  timeControlToMs,
} from "../../types/game";
import {
  addMoveToGameHash,
  getGameHash,
  updateGameHash,
  createGameHash,
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

      // Initialize Kafka-enhanced chess game service
      const chessGame = await ChessGameService.fromGameId(validatedData.gameId);

      // Validate and make the move (this will also publish Kafka events)
      const moveResult = await chessGame.makeMove(
        validatedData.move,
        player.color
      );

      if (!moveResult.success) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.MOVE,
          socketErrorMessage.send(moveResult.error || "Invalid move")
        );
        return;
      }

      // Create move object with chess.js move details
      console.log(`📝 Creating move object for: ${moveResult.move.san}`);
      const move: MoveDTO = {
        move: moveResult.move.san, // Standard Algebraic Notation
        from: moveResult.move.from,
        to: moveResult.move.to,
        timeStamp: Date.now(),
      };

      // Add move to game hash (this updates Redis state)
      console.log(`💾 Updating Redis with move: ${move.move}`);
      await addMoveToGameHash(validatedData.gameId, move, player.color);
      console.log(`✅ Redis updated with move`);

      // Update time after move
      console.log(`⏰ Updating time after move...`);
      await TimeManager.updateTimeAfterMove(
        validatedData.gameId,
        player.color,
        move.timeStamp
      );
      console.log(`✅ Time updated successfully`);

      // Update game state with new position
      console.log(`🔄 Updating game state with new position...`);
      await updateGameHash(validatedData.gameId, {
        pgn: chessGame.getPGN(),
        turn: chessGame.getTurn(),
      });
      console.log(`✅ Game state updated successfully`);

      // Get updated game state
      console.log(`📊 Retrieving updated game state...`);
      const updatedGameState = await getGameHash(validatedData.gameId);
      console.log(`✅ Game state retrieved successfully`);

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

        // Game will be saved to database via Kafka events processing

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
        console.log(
          `📡 Broadcasting move to game room: ${validatedData.gameId}`
        );
        messageHandler.emitToRoom(
          validatedData.gameId,
          SOCKET_MESSAGE_TYPE.MOVE,
          socketSuccessMessage.send(responseData, "Move processed successfully")
        );
        console.log(`✅ Move broadcast completed`);
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

      // Initialize Kafka-enhanced chess game to get current position
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

      // Handle resignation with Kafka events
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

      // Find the player accepting draw
      const player = gameState.playerInfo.find((p) => p.userId === userId);
      if (!player) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.ACCEPT_DRAW,
          socketErrorMessage.send("You are not a player in this game")
        );
        return;
      }

      // Handle draw acceptance - update game in MongoDB
      await GameModel.findByIdAndUpdate(gameId, {
        status: "completed",
        result: { type: "draw", method: "agreement" },
        endedAt: new Date(),
      });

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

  const handleOfferRematch = async (gameId: string) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.OFFER_REMATCH,
          socketErrorMessage.send("Invalid game ID")
        );
        return;
      }

      // Check if game is completed
      const game = await GameModel.findById(gameId);
      if (!game || game.status !== "completed") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.OFFER_REMATCH,
          socketErrorMessage.send("Game must be completed to offer rematch")
        );
        return;
      }

      // Check if user was a player in this game
      const player = game.players.find(
        (p: any) => p.userId.toString() === userId
      );
      if (!player) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.OFFER_REMATCH,
          socketErrorMessage.send("You are not a player in this game")
        );
        return;
      }

      // Find opponent
      const opponent = game.players.find(
        (p: any) => p.userId.toString() !== userId
      );
      if (!opponent) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.OFFER_REMATCH,
          socketErrorMessage.send("Opponent not found")
        );
        return;
      }

      // Handle rematch offer - simple implementation
      console.log(
        `🔄 Rematch offer from ${userId} to ${opponent.userId.toString()}`
      );

      // Send rematch offer to game room
      messageHandler.emitToRoom(
        gameId,
        SOCKET_MESSAGE_TYPE.OFFER_REMATCH,
        socketSuccessMessage.send(
          {
            offeredBy: player.color,
            gameId: gameId,
            originalGameId: gameId,
          },
          `${player.color} offers a rematch`
        )
      );

      console.log(`🔄 Rematch offered in game ${gameId} by ${player.color}`);
    } catch (error) {
      console.error("❌ Error offering rematch:", error);
      socket.emit(
        SOCKET_MESSAGE_TYPE.OFFER_REMATCH,
        socketErrorMessage.send("Failed to offer rematch")
      );
    }
  };

  const handleAcceptRematch = async (gameId: string) => {
    try {
      if (!gameId || typeof gameId !== "string") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.ACCEPT_REMATCH,
          socketErrorMessage.send("Invalid game ID")
        );
        return;
      }

      // Check if game is completed
      const originalGame = await GameModel.findById(gameId);
      if (!originalGame || originalGame.status !== "completed") {
        socket.emit(
          SOCKET_MESSAGE_TYPE.ACCEPT_REMATCH,
          socketErrorMessage.send("Original game must be completed")
        );
        return;
      }

      // Check if user was a player in the original game
      const player = originalGame.players.find(
        (p: any) => p.userId.toString() === userId
      );
      if (!player) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.ACCEPT_REMATCH,
          socketErrorMessage.send("You are not a player in this game")
        );
        return;
      }

      // Find opponent
      const opponent = originalGame.players.find(
        (p: any) => p.userId.toString() !== userId
      );
      if (!opponent) {
        socket.emit(
          SOCKET_MESSAGE_TYPE.ACCEPT_REMATCH,
          socketErrorMessage.send("Opponent not found")
        );
        return;
      }

      // Create new game for rematch with colors swapped
      const playerInfo: PlayerDTO[] = [
        {
          userId: player.userId.toString(),
          color: player.color === "white" ? "black" : "white", // Swap colors
          preRating: player.preRating,
        },
        {
          userId: opponent.userId.toString(),
          color: opponent.color === "white" ? "black" : "white", // Swap colors
          preRating: opponent.preRating,
        },
      ];

      const newGame = await GameModel.create({
        players: playerInfo,
        variant: originalGame.variant,
        timeControl: originalGame.timeControl,
        pgn: "",
        moves: [],
        initialFen: DEFAULT_FEN,
      });

      if (!newGame) {
        throw APIError.internal("Failed to create rematch game");
      }

      const gameTimeLeft = timeControlToMs(originalGame.timeControl);

      await createGameHash({
        gameId: newGame.id,
        playerInfo,
        timeLeft: gameTimeLeft,
        gameInfo: {
          gameVariant: originalGame.variant,
          gameType: "REMATCH", // Mark as rematch
          timeControl: originalGame.timeControl,
        },
        initialFen: DEFAULT_FEN,
        moves: [],
        pgn: "",
        turn: "white",
        startedAt: Date.now(),
        lastMovePlayedAt: Date.now(),
      });

      // Handle rematch acceptance - simple implementation
      console.log(
        `🔄 Rematch accepted! New game ${newGame.id} created from ${gameId}`
      );

      // Notify both players about the new game
      messageHandler.emitToRoom(
        gameId,
        SOCKET_MESSAGE_TYPE.ACCEPT_REMATCH,
        socketSuccessMessage.send(
          {
            newGameId: newGame.id,
            originalGameId: gameId,
            players: playerInfo,
            timeControl: originalGame.timeControl,
          },
          "Rematch accepted! New game created"
        )
      );

      console.log(
        `🔄 Rematch accepted! New game ${newGame.id} created from ${gameId}`
      );
    } catch (error) {
      console.error("❌ Error accepting rematch:", error);
      socket.emit(
        SOCKET_MESSAGE_TYPE.ACCEPT_REMATCH,
        socketErrorMessage.send("Failed to accept rematch")
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
  socket.on(SOCKET_MESSAGE_TYPE.OFFER_REMATCH, handleOfferRematch);
  socket.on(SOCKET_MESSAGE_TYPE.ACCEPT_REMATCH, handleAcceptRematch);
  socket.on(SOCKET_MESSAGE_TYPE.TIME_UP, handleTimeUp);
  socket.on(SOCKET_MESSAGE_TYPE.REQUEST_TIME_SYNC, handleRequestTimeSync);
};
