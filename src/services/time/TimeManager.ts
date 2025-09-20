import { Server } from "socket.io";
import { PlayerColor, GameResult, getOppositeColor } from "../../types/game";
import { getGameHash, updateGameHash } from "../redis/gameHash";
import { ChessGameService } from "../chess/ChessGameService";
import GameModel from "../../models/game";
import { RatingService } from "../rating/RatingService";
import { SOCKET_MESSAGE_TYPE } from "../../constants";
import {
  socketSuccessMessage,
  socketErrorMessage,
} from "../../utils/socketResponse";

interface GameTimeState {
  gameId: string;
  lastMoveTime: number;
  isActive: boolean;
  currentTurn: PlayerColor;
}

export class TimeManager {
  private static gameStates: Map<string, GameTimeState> = new Map();
  private static io: Server | null = null;

  // Single interval for checking timeouts (every 1 second)
  private static timeoutCheckInterval: NodeJS.Timeout | null = null;
  private static readonly CHECK_INTERVAL = 1000; // 1 second

  /**
   * Initialize the TimeManager with Socket.IO instance
   */
  static initialize(io: Server): void {
    this.io = io;

    // Start a single interval to check for timeouts across all games
    if (!this.timeoutCheckInterval) {
      this.timeoutCheckInterval = setInterval(() => {
        this.checkAllGamesForTimeout();
      }, this.CHECK_INTERVAL);

      console.log("⏰ TimeManager initialized with periodic timeout checking");
    }
  }

  /**
   * Start tracking time for a game (no individual timers)
   */
  static async startGameTimer(gameId: string): Promise<void> {
    const gameState = await getGameHash(gameId);
    if (!gameState) {
      console.error(`Cannot start timer: Game ${gameId} not found`);
      return;
    }

    const timeState: GameTimeState = {
      gameId,
      lastMoveTime: Date.now(),
      isActive: true,
      currentTurn: gameState.turn as PlayerColor,
    };

    this.gameStates.set(gameId, timeState);
    console.log(`⏰ Started time tracking for game ${gameId}`);
  }

  /**
   * Calculate current time remaining for a player
   */
  static async calculateCurrentTime(
    gameId: string,
    playerColor: PlayerColor
  ): Promise<number> {
    const gameState = await getGameHash(gameId);
    const timeState = this.gameStates.get(gameId);

    if (!gameState || !timeState) {
      return 0;
    }

    const timeLeft = gameState.timeLeft as { white: number; black: number };
    let currentTime = timeLeft[playerColor];

    // If it's this player's turn, subtract elapsed time
    if (timeState.currentTurn === playerColor && timeState.isActive) {
      const elapsedTime = Date.now() - timeState.lastMoveTime;
      currentTime = Math.max(0, currentTime - elapsedTime);
    }

    return currentTime;
  }

  /**
   * Update time after a move (calculation-based, no timers)
   */
  static async updateTimeAfterMove(
    gameId: string,
    movingPlayer: PlayerColor,
    moveTimestamp: number
  ): Promise<void> {
    const gameState = await getGameHash(gameId);
    const timeState = this.gameStates.get(gameId);

    if (!gameState || !timeState) {
      return;
    }

    const timeLeft = gameState.timeLeft as { white: number; black: number };
    const gameInfo = gameState.gameInfo;
    const increment = gameInfo.timeControl.increment * 1000; // Convert to milliseconds

    // Calculate time elapsed since last move
    const timeElapsed = moveTimestamp - timeState.lastMoveTime;

    // Update time for the moving player
    timeLeft[movingPlayer] = Math.max(
      0,
      timeLeft[movingPlayer] - timeElapsed + increment
    );

    // Update game state in Redis
    await updateGameHash(gameId, {
      timeLeft: timeLeft,
      lastMovePlayedAt: moveTimestamp,
      turn: getOppositeColor(movingPlayer),
    });

    // Update our time state
    timeState.lastMoveTime = moveTimestamp;
    timeState.currentTurn = getOppositeColor(movingPlayer);

    console.log(
      `⏱️ Time updated for ${movingPlayer}: ${timeLeft[movingPlayer]}ms remaining`
    );
  }

  /**
   * Check all active games for timeouts (runs every second)
   */
  static async checkAllGamesForTimeout(): Promise<void> {
    const activeGames = Array.from(this.gameStates.values()).filter(
      (state) => state.isActive
    );

    if (activeGames.length === 0) {
      return;
    }

    for (const timeState of activeGames) {
      await this.checkGameTimeout(timeState.gameId);
    }
  }

  /**
   * Check a specific game for timeout
   */
  static async checkGameTimeout(gameId: string): Promise<void> {
    const timeState = this.gameStates.get(gameId);
    if (!timeState || !timeState.isActive) {
      return;
    }

    const currentTime = await this.calculateCurrentTime(
      gameId,
      timeState.currentTurn
    );

    // Check if current player has run out of time
    if (currentTime <= 0) {
      console.log(
        `⏰ Timeout detected for ${timeState.currentTurn} in game ${gameId}`
      );
      await this.handleTimeUp(gameId, timeState.currentTurn);
    }
  }

  /**
   * Handle when a player's time runs out
   */
  static async handleTimeUp(
    gameId: string,
    playerColor: PlayerColor
  ): Promise<void> {
    console.log(`⏰ Time up for ${playerColor} in game ${gameId}`);

    const gameState = await getGameHash(gameId);
    if (!gameState) {
      this.stopGameTimer(gameId);
      return;
    }

    // Stop tracking this game
    this.stopGameTimer(gameId);

    try {
      // Initialize chess game service
      const chessGame = await ChessGameService.fromGameId(gameId);

      // Determine winner (opposite of the player who ran out of time)
      const winner = getOppositeColor(playerColor);
      const gameResult: GameResult = winner === "white" ? "1-0" : "0-1";

      // Update game result
      await chessGame.handleTimeForfit(playerColor);

      // Update game state in Redis
      await updateGameHash(gameId, {
        gameOver: true,
        winner: winner,
        result: gameResult,
        endReason: "timeout",
        endedAt: Date.now(),
      });

      // Broadcast game over event
      if (this.io) {
        this.io.to(gameId).emit(
          SOCKET_MESSAGE_TYPE.GAME_OVER,
          socketSuccessMessage.send(
            {
              winner: winner,
              result: gameResult,
              reason: "timeout",
              loser: playerColor,
              gameState: await getGameHash(gameId),
            },
            `${playerColor} ran out of time. ${winner} wins!`
          )
        );
      }

      console.log(`🏁 Game ${gameId} ended by timeout: ${winner} wins`);
    } catch (error) {
      console.error(`Error handling timeout for game ${gameId}:`, error);
    }
  }

  /**
   * Handle client reporting opponent time up
   */
  static async handleClientTimeUpReport(
    gameId: string,
    reportingUserId: string,
    claimedTimeUpPlayer: PlayerColor
  ): Promise<void> {
    const gameState = await getGameHash(gameId);
    if (!gameState) {
      return;
    }

    // Verify the reporting user is part of the game
    const reportingPlayer = gameState.playerInfo.find(
      (p) => p.userId === reportingUserId
    );
    if (!reportingPlayer) {
      console.log(
        `Invalid time up report from ${reportingUserId} for game ${gameId}`
      );
      return;
    }

    // Calculate actual time remaining
    const actualTimeLeft = await this.calculateCurrentTime(
      gameId,
      claimedTimeUpPlayer
    );

    // Allow some tolerance (100ms) for network latency
    if (actualTimeLeft <= 100) {
      console.log(
        `✅ Confirmed time up for ${claimedTimeUpPlayer} in game ${gameId}`
      );
      await this.handleTimeUp(gameId, claimedTimeUpPlayer);
    } else {
      console.log(
        `❌ Invalid time up claim for ${claimedTimeUpPlayer} in game ${gameId}. Time left: ${actualTimeLeft}ms`
      );

      // Send corrected time to clients
      this.broadcastTimeUpdate(gameId);
    }
  }

  /**
   * Broadcast current time status to all players
   */
  static async broadcastTimeUpdate(gameId: string): Promise<void> {
    if (!this.io) {
      return;
    }

    const gameState = await getGameHash(gameId);
    if (!gameState) {
      return;
    }

    const timeLeft = gameState.timeLeft as { white: number; black: number };
    const currentTurn = gameState.turn as PlayerColor;

    // Calculate current actual times
    const whiteTime = await this.calculateCurrentTime(gameId, "white");
    const blackTime = await this.calculateCurrentTime(gameId, "black");

    this.io.to(gameId).emit(
      SOCKET_MESSAGE_TYPE.TIME_UPDATE,
      socketSuccessMessage.send({
        timeLeft: {
          white: whiteTime,
          black: blackTime,
        },
        currentTurn: currentTurn,
        timestamp: Date.now(),
      })
    );
  }

  /**
   * Synchronize time with client
   */
  static async syncTimeWithClient(
    gameId: string,
    socketId: string
  ): Promise<void> {
    if (!this.io) {
      return;
    }

    const gameState = await getGameHash(gameId);
    if (!gameState) {
      return;
    }

    const currentTurn = gameState.turn as PlayerColor;

    // Calculate current actual times
    const whiteTime = await this.calculateCurrentTime(gameId, "white");
    const blackTime = await this.calculateCurrentTime(gameId, "black");

    this.io.to(socketId).emit(
      SOCKET_MESSAGE_TYPE.TIME_UPDATE,
      socketSuccessMessage.send({
        timeLeft: {
          white: whiteTime,
          black: blackTime,
        },
        currentTurn: currentTurn,
        timestamp: Date.now(),
        isSync: true,
      })
    );
  }

  /**
   * Stop timer for a game
   */
  static stopGameTimer(gameId: string): void {
    const timeState = this.gameStates.get(gameId);
    if (timeState) {
      timeState.isActive = false;
      this.gameStates.delete(gameId);
      console.log(`⏹️ Stopped time tracking for game ${gameId}`);
    }
  }

  /**
   * Pause timer for a game (when player disconnects)
   */
  static pauseGameTimer(gameId: string): void {
    const timeState = this.gameStates.get(gameId);
    if (timeState) {
      timeState.isActive = false;
      console.log(`⏸️ Paused time tracking for game ${gameId}`);
    }
  }

  /**
   * Resume timer for a game (when player reconnects)
   */
  static async resumeGameTimer(gameId: string): Promise<void> {
    const timeState = this.gameStates.get(gameId);
    if (timeState && !timeState.isActive) {
      timeState.isActive = true;
      timeState.lastMoveTime = Date.now(); // Reset timing reference
      console.log(`▶️ Resumed time tracking for game ${gameId}`);
    }
  }

  /**
   * Get current timer status for a game
   */
  static getGameTimerStatus(gameId: string): {
    isActive: boolean;
    lastMoveTime?: number;
    activeGamesCount: number;
  } {
    const timeState = this.gameStates.get(gameId);
    return {
      isActive: timeState?.isActive || false,
      lastMoveTime: timeState?.lastMoveTime,
      activeGamesCount: this.gameStates.size,
    };
  }

  /**
   * Get statistics about current time tracking
   */
  static getTimeManagerStats(): {
    activeGames: number;
    intervalRunning: boolean;
    gamesBeingTracked: string[];
  } {
    return {
      activeGames: Array.from(this.gameStates.values()).filter(
        (s) => s.isActive
      ).length,
      intervalRunning: this.timeoutCheckInterval !== null,
      gamesBeingTracked: Array.from(this.gameStates.keys()),
    };
  }

  /**
   * Clean up timers (called when server shuts down)
   */
  static cleanup(): void {
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
      this.timeoutCheckInterval = null;
    }

    this.gameStates.clear();
    console.log("🧹 Cleaned up TimeManager");
  }
}
