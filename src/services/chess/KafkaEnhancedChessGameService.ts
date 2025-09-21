import { Chess } from "chess.js";
import {
  GameHashDTO,
  MoveDTO,
  PlayerColor,
  GameResult,
  Winner,
} from "../../types/game";
import { getGameHash, updateGameHash } from "../redis/gameHash";
import GameModel from "../../models/game";
import APIError from "../../utils/APIError";
import { RatingService } from "../rating/RatingService";
import GameEventBatchProcessor from "../kafka/GameEventBatchProcessor";
import {
  GAME_EVENT_TYPES,
  GameStartedEvent,
  MoveMadeEvent,
  GameEndedEvent,
  PlayerResignedEvent,
  DrawAcceptedEvent,
  RematchOfferedEvent,
  RematchAcceptedEvent,
  TimeUpdateEvent,
} from "../../types/kafka";
import { RESULT_TYPES } from "../../constants";

export class KafkaEnhancedChessGameService {
  private chess: Chess;
  private gameId: string;
  private eventProcessor: GameEventBatchProcessor;

  constructor(gameId: string, fen?: string) {
    this.gameId = gameId;
    this.chess = new Chess(fen);
    this.eventProcessor = new GameEventBatchProcessor();
  }

  /**
   * Initialize chess game from Redis game state
   */
  static async fromGameId(
    gameId: string
  ): Promise<KafkaEnhancedChessGameService> {
    const gameState = await getGameHash(gameId);
    if (!gameState) {
      throw APIError.notFound("Game not found");
    }

    // Create chess instance with current position
    const chess = new KafkaEnhancedChessGameService(
      gameId,
      gameState.initialFen
    );

    // Replay all moves to get to current position
    for (const move of gameState.moves) {
      chess.chess.move(move.move);
    }

    return chess;
  }

  /**
   * Create a new game and publish game started event
   */
  static async createGame(
    gameId: string,
    whitePlayerId: string,
    blackPlayerId: string,
    timeControl: { time: number; increment: number },
    initialFen?: string
  ): Promise<KafkaEnhancedChessGameService> {
    const gameService = new KafkaEnhancedChessGameService(gameId, initialFen);

    // Publish game started event to Kafka
    const gameStartedEvent: GameStartedEvent = {
      type: GAME_EVENT_TYPES.GAME_STARTED,
      gameId,
      players: {
        white: whitePlayerId,
        black: blackPlayerId,
      },
      timeControl,
      initialFen: initialFen || gameService.chess.fen(),
      timestamp: Date.now(),
    };

    await gameService.eventProcessor.addEvent(gameId, gameStartedEvent, "HIGH");

    console.log(`🎮 Game ${gameId} created and published to Kafka`);
    return gameService;
  }

  /**
   * Validate and make a move with Kafka event publishing
   */
  async makeMove(
    move: string,
    playerColor: PlayerColor,
    timeLeft?: { white: number; black: number }
  ): Promise<{
    success: boolean;
    move?: any;
    error?: string;
    gameStatus?: {
      isGameOver: boolean;
      result?: GameResult;
      winner?: Winner;
      reason?: string;
      inCheck?: boolean;
      inCheckmate?: boolean;
      inStalemate?: boolean;
      isDraw?: boolean;
    };
  }> {
    try {
      // Check if it's the correct player's turn
      const currentTurn = this.chess.turn() === "w" ? "white" : "black";
      if (currentTurn !== playerColor) {
        return {
          success: false,
          error: "It's not your turn",
        };
      }

      // Attempt to make the move
      const chessMove = this.chess.move(move);
      if (!chessMove) {
        return {
          success: false,
          error: "Invalid move",
        };
      }

      // Get current game status
      const gameStatus = this.getGameStatus();
      const moveNumber = this.chess.history().length;

      // Create move event for Kafka
      const moveMadeEvent: MoveMadeEvent = {
        type: GAME_EVENT_TYPES.MOVE_MADE,
        gameId: this.gameId,
        move: {
          move: chessMove.san,
          from: chessMove.from,
          to: chessMove.to,
          piece: chessMove.piece,
          captured: chessMove.captured,
          promotion: chessMove.promotion,
          san: chessMove.san,
        },
        player: playerColor,
        fen: this.chess.fen(),
        pgn: this.chess.pgn(),
        moveNumber,
        timeLeft: timeLeft || { white: 0, black: 0 },
        timestamp: Date.now(),
      };

      // Determine priority based on game state and time control
      const priority = this.getMoveEventPriority(timeLeft, gameStatus);

      // Publish move event to Kafka
      await this.eventProcessor.addEvent(this.gameId, moveMadeEvent, priority);

      // If game is over, publish game ended event
      if (gameStatus.isGameOver) {
        await this.publishGameEndedEvent(gameStatus, timeLeft);
      }

      console.log(
        `♟️ Move ${moveNumber} by ${playerColor} published to Kafka (priority: ${priority})`
      );

      return {
        success: true,
        move: chessMove,
        gameStatus,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Invalid move",
      };
    }
  }

  /**
   * Handle player resignation with Kafka event
   */
  async handlePlayerResignation(resignedPlayer: PlayerColor): Promise<void> {
    const resignedEvent: PlayerResignedEvent = {
      type: GAME_EVENT_TYPES.PLAYER_RESIGNED,
      gameId: this.gameId,
      resignedPlayer,
      timestamp: Date.now(),
    };

    // Resign events are high priority
    await this.eventProcessor.addEvent(this.gameId, resignedEvent, "HIGH");

    console.log(`🏳️ Player ${resignedPlayer} resignation published to Kafka`);
  }

  /**
   * Handle draw acceptance with Kafka event
   */
  async handleDrawAcceptance(acceptedBy: PlayerColor): Promise<void> {
    const drawAcceptedEvent: DrawAcceptedEvent = {
      type: GAME_EVENT_TYPES.DRAW_ACCEPTED,
      gameId: this.gameId,
      acceptedBy,
      timestamp: Date.now(),
    };

    // Draw events are high priority
    await this.eventProcessor.addEvent(this.gameId, drawAcceptedEvent, "HIGH");

    console.log(`🤝 Draw acceptance by ${acceptedBy} published to Kafka`);
  }

  /**
   * Publish time update events (for bullet/blitz games)
   */
  async publishTimeUpdate(
    timeLeft: { white: number; black: number },
    currentTurn: PlayerColor
  ): Promise<void> {
    const timeUpdateEvent: TimeUpdateEvent = {
      type: GAME_EVENT_TYPES.TIME_UPDATE,
      gameId: this.gameId,
      timeLeft,
      currentTurn,
      timestamp: Date.now(),
    };

    // Time updates are low priority unless it's a critical time situation
    const priority = this.getTimeUpdatePriority(timeLeft);

    await this.eventProcessor.addEvent(this.gameId, timeUpdateEvent, priority);
  }

  /**
   * Get current game status
   */
  private getGameStatus(): {
    isGameOver: boolean;
    result?: GameResult;
    winner?: Winner;
    reason?: string;
    inCheck?: boolean;
    inCheckmate?: boolean;
    inStalemate?: boolean;
    isDraw?: boolean;
  } {
    const isGameOver = this.chess.isGameOver();

    const status: {
      isGameOver: boolean;
      result?: GameResult;
      winner?: Winner;
      reason?: string;
      inCheck?: boolean;
      inCheckmate?: boolean;
      inStalemate?: boolean;
      isDraw?: boolean;
    } = {
      isGameOver,
      inCheck: this.chess.inCheck(),
      inCheckmate: this.chess.isCheckmate(),
      inStalemate: this.chess.isStalemate(),
      isDraw: this.chess.isDraw(),
    };

    if (isGameOver) {
      if (this.chess.isCheckmate()) {
        const winner = this.chess.turn() === "w" ? "black" : "white";
        status.result = winner === "white" ? "1-0" : "0-1";
        status.winner = winner;
        status.reason = "checkmate";
      } else if (this.chess.isStalemate()) {
        status.result = "1/2-1/2";
        status.winner = null;
        status.reason = "stalemate";
      } else if (this.chess.isDraw()) {
        status.result = "1/2-1/2";
        status.winner = null;
        status.reason = "draw";
      }
    }

    return status;
  }

  /**
   * Publish game ended event
   */
  private async publishGameEndedEvent(
    gameStatus: any,
    timeLeft?: { white: number; black: number }
  ): Promise<void> {
    if (!gameStatus.isGameOver) return;

    // Calculate rating changes (this would typically be done by RatingService)
    // For now, we'll skip this to keep the example simple

    const gameEndedEvent: GameEndedEvent = {
      type: GAME_EVENT_TYPES.GAME_ENDED,
      gameId: this.gameId,
      result: {
        winner: gameStatus.winner,
        reason: this.mapReasonToResultType(gameStatus.reason),
      },
      finalFen: this.chess.fen(),
      finalPgn: this.chess.pgn(),
      duration: Date.now(), // This should be calculated from game start
      timestamp: Date.now(),
    };

    // Game end events are always high priority
    await this.eventProcessor.addEvent(this.gameId, gameEndedEvent, "HIGH");

    console.log(`🏁 Game ${this.gameId} ended and published to Kafka`);
  }

  /**
   * Determine move event priority based on time control and game state
   */
  private getMoveEventPriority(
    timeLeft?: { white: number; black: number },
    gameStatus?: any
  ): "HIGH" | "MEDIUM" | "LOW" {
    // High priority for game ending moves
    if (gameStatus?.isGameOver) {
      return "HIGH";
    }

    // High priority for low time situations (under 30 seconds)
    if (timeLeft && (timeLeft.white < 30000 || timeLeft.black < 30000)) {
      return "HIGH";
    }

    // Medium priority for bullet games (under 5 minutes each)
    if (timeLeft && timeLeft.white + timeLeft.black < 600000) {
      return "MEDIUM";
    }

    // Default to medium priority
    return "MEDIUM";
  }

  /**
   * Determine time update priority
   */
  private getTimeUpdatePriority(timeLeft: {
    white: number;
    black: number;
  }): "HIGH" | "MEDIUM" | "LOW" {
    // High priority if either player has less than 10 seconds
    if (timeLeft.white < 10000 || timeLeft.black < 10000) {
      return "HIGH";
    }

    // Medium priority if either player has less than 1 minute
    if (timeLeft.white < 60000 || timeLeft.black < 60000) {
      return "MEDIUM";
    }

    // Low priority for normal time situations
    return "LOW";
  }

  /**
   * Map game end reason to RESULT_TYPES
   */
  private mapReasonToResultType(reason?: string): RESULT_TYPES {
    switch (reason) {
      case "checkmate":
        return RESULT_TYPES.CHECKMATE;
      case "stalemate":
        return RESULT_TYPES.STALEMATE;
      case "draw":
        return RESULT_TYPES.DRAW;
      default:
        return RESULT_TYPES.ON_GOING;
    }
  }

  /**
   * Handle rematch offer with Kafka event publishing
   */
  async handleRematchOffer(
    offeredBy: string,
    opponentId: string
  ): Promise<void> {
    console.log(`🔄 Processing rematch offer in game ${this.gameId}`);

    const rematchEvent: RematchOfferedEvent = {
      type: GAME_EVENT_TYPES.REMATCH_OFFERED,
      gameId: this.gameId,
      offeredBy,
      opponentId,
      timestamp: Date.now(),
    };

    // Add to batch processor for reliable delivery
    await this.eventProcessor.addEvent(this.gameId, rematchEvent, "MEDIUM");

    console.log(`✅ Rematch offer event queued for game ${this.gameId}`);
  }

  /**
   * Handle rematch acceptance with Kafka event publishing
   */
  async handleRematchAcceptance(
    newGameId: string,
    acceptedBy: string,
    players: Array<{
      userId: string;
      color: PlayerColor;
      preRating: number;
    }>
  ): Promise<void> {
    console.log(`🔄 Processing rematch acceptance for new game ${newGameId}`);

    const rematchEvent: RematchAcceptedEvent = {
      type: GAME_EVENT_TYPES.REMATCH_ACCEPTED,
      gameId: newGameId,
      originalGameId: this.gameId,
      acceptedBy,
      players,
      timestamp: Date.now(),
    };

    // Add to batch processor for reliable delivery
    await this.eventProcessor.addEvent(newGameId, rematchEvent, "MEDIUM");

    console.log(
      `✅ Rematch accepted event queued for games ${this.gameId} -> ${newGameId}`
    );
  }

  /**
   * Flush any pending events (useful for cleanup)
   */
  async flushEvents(): Promise<void> {
    await this.eventProcessor.flushBatch();
  }

  /**
   * Get current FEN
   */
  getFen(): string {
    return this.chess.fen();
  }

  /**
   * Get current PGN
   */
  getPgn(): string {
    return this.chess.pgn();
  }

  /**
   * Get move history
   */
  getHistory(): string[] {
    return this.chess.history();
  }
}

export default KafkaEnhancedChessGameService;
