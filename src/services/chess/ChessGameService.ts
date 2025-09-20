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

export class ChessGameService {
  private chess: Chess;
  private gameId: string;

  constructor(gameId: string, fen?: string) {
    this.gameId = gameId;
    this.chess = new Chess(fen);
  }

  /**
   * Initialize chess game from Redis game state
   */
  static async fromGameId(gameId: string): Promise<ChessGameService> {
    const gameState = await getGameHash(gameId);
    if (!gameState) {
      throw APIError.notFound("Game not found");
    }

    // Create chess instance with current position
    const chess = new ChessGameService(gameId, gameState.initialFen);

    // Replay all moves to get to current position
    for (const move of gameState.moves) {
      chess.chess.move(move.move);
    }

    return chess;
  }

  /**
   * Validate and make a move
   */
  makeMove(
    move: string,
    playerColor: PlayerColor
  ): {
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
  } {
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

      // Check game status
      const gameStatus = this.getGameStatus();

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
   * Get current game status
   */
  getGameStatus(): {
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
    const inCheck = this.chess.inCheck();
    const inCheckmate = this.chess.isCheckmate();
    const inStalemate = this.chess.isStalemate();
    const isDraw = this.chess.isDraw();

    let result: GameResult | undefined;
    let winner: Winner | undefined;
    let reason: string | undefined;

    if (isGameOver) {
      if (inCheckmate) {
        // Current player is in checkmate, so the other player wins
        const currentTurn = this.chess.turn();
        winner = currentTurn === "w" ? "black" : "white";
        result = winner === "white" ? "1-0" : "0-1";
        reason = "checkmate";
      } else if (inStalemate) {
        result = "1/2-1/2";
        winner = null;
        reason = "stalemate";
      } else if (isDraw) {
        result = "1/2-1/2";
        winner = null;
        reason = "draw";
      }
    }

    return {
      isGameOver,
      result,
      winner,
      reason,
      inCheck,
      inCheckmate,
      inStalemate,
      isDraw,
    };
  }

  /**
   * Get current FEN position
   */
  getFEN(): string {
    return this.chess.fen();
  }

  /**
   * Get PGN of the game
   */
  getPGN(): string {
    return this.chess.pgn();
  }

  /**
   * Get current turn
   */
  getTurn(): PlayerColor {
    return this.chess.turn() === "w" ? "white" : "black";
  }

  /**
   * Get move history
   */
  getHistory(): any[] {
    return this.chess.history({ verbose: true });
  }

  /**
   * Get legal moves for current position
   */
  getLegalMoves(): string[] {
    return this.chess.moves();
  }

  /**
   * Save game to database when it ends
   */
  async saveGameToDatabase(): Promise<void> {
    const gameStatus = this.getGameStatus();

    if (gameStatus.isGameOver && gameStatus.result) {
      const gameState = await getGameHash(this.gameId);
      if (!gameState) {
        throw APIError.notFound("Game state not found");
      }

      // Calculate and update ratings
      const ratingCalculation = await RatingService.updatePlayerRatings(
        this.gameId,
        gameStatus.result,
        gameState.gameInfo.gameVariant,
        gameStatus.winner || null
      );

      // Update the game document in MongoDB
      await GameModel.findByIdAndUpdate(this.gameId, {
        status: "completed",
        pgn: this.getPGN(),
        fenHistory: [this.getFEN()], // You might want to store more FEN positions
        result: gameStatus.result
          ? {
              winner: gameStatus.winner,
              reason: gameStatus.reason,
              score: gameStatus.result,
            }
          : undefined,
        endedAt: new Date(),
      });

      console.log(
        `🎮 Game ${this.gameId} completed: ${gameStatus.result} (${gameStatus.reason})`
      );
      console.log(`📊 Rating changes applied:`, {
        white: ratingCalculation.whitePlayerRating,
        black: ratingCalculation.blackPlayerRating,
      });
    }
  }

  /**
   * Handle time forfeit
   */
  async handleTimeForfit(playerColor: PlayerColor): Promise<void> {
    const winner: Winner = playerColor === "white" ? "black" : "white";
    const result: GameResult = winner === "white" ? "1-0" : "0-1";

    // Get game state to determine variant
    const gameState = await getGameHash(this.gameId);
    if (!gameState) {
      throw APIError.notFound("Game state not found");
    }

    // Calculate and update ratings
    const ratingCalculation = await RatingService.updatePlayerRatings(
      this.gameId,
      result,
      gameState.gameInfo.gameVariant,
      winner
    );

    await GameModel.findByIdAndUpdate(this.gameId, {
      status: "completed",
      pgn: this.getPGN(),
      result: {
        winner,
        reason: "timeout",
        score: result,
      },
      endedAt: new Date(),
    });

    console.log(`⏰ Game ${this.gameId} ended by timeout - ${winner} wins`);
    console.log(`📊 Rating changes applied:`, {
      white: ratingCalculation.whitePlayerRating,
      black: ratingCalculation.blackPlayerRating,
    });
  }

  /**
   * Handle resignation
   */
  async handleResignation(resigningPlayer: PlayerColor): Promise<void> {
    const winner: Winner = resigningPlayer === "white" ? "black" : "white";
    const result: GameResult = winner === "white" ? "1-0" : "0-1";

    // Get game state to determine variant
    const gameState = await getGameHash(this.gameId);
    if (!gameState) {
      throw APIError.notFound("Game state not found");
    }

    // Calculate and update ratings
    const ratingCalculation = await RatingService.updatePlayerRatings(
      this.gameId,
      result,
      gameState.gameInfo.gameVariant,
      winner
    );

    await GameModel.findByIdAndUpdate(this.gameId, {
      status: "completed",
      pgn: this.getPGN(),
      result: {
        winner,
        reason: "resignation",
        score: result,
      },
      endedAt: new Date(),
    });

    console.log(`🏳️ Game ${this.gameId} ended by resignation - ${winner} wins`);
    console.log(`📊 Rating changes applied:`, {
      white: ratingCalculation.whitePlayerRating,
      black: ratingCalculation.blackPlayerRating,
    });
  }

  /**
   * Handle draw by mutual agreement
   */
  async handleDrawByAgreement(): Promise<void> {
    const result: GameResult = "1/2-1/2";

    // Get game state to determine variant
    const gameState = await getGameHash(this.gameId);
    if (!gameState) {
      throw APIError.notFound("Game state not found");
    }

    // Calculate and update ratings for draw
    const ratingCalculation = await RatingService.updatePlayerRatings(
      this.gameId,
      result,
      gameState.gameInfo.gameVariant,
      null // null for draw
    );

    await GameModel.findByIdAndUpdate(this.gameId, {
      status: "completed",
      pgn: this.getPGN(),
      result: {
        winner: null,
        reason: "agreement",
        score: result,
      },
      endedAt: new Date(),
    });

    console.log(`🤝 Game ${this.gameId} ended by draw agreement`);
    console.log(`📊 Rating changes applied:`, {
      white: ratingCalculation.whitePlayerRating,
      black: ratingCalculation.blackPlayerRating,
    });
  }
}
