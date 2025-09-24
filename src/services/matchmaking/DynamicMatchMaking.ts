import redis from "../../config/redis";
import {
  addPlayerToQueue,
  getOpponentInRange,
  removePlayerFromQueue,
  checkPlayerAvialabilityForGame,
  isPlayerInQueue,
} from "../redis/matchMakingQueue";
import {
  getPlayerHash,
  deletePlayerHash,
  updateSocketId,
} from "../redis/playerHash";
import { createGameHash } from "../redis/gameHash";
import GameModel from "../../models/game";
import {
  PlayerDTO,
  TimeControl,
  timeControlToMs,
  DEFAULT_FEN,
} from "../../types/game";
import { RatingService } from "../rating/RatingService";

interface MatchSearchSession {
  userId: string;
  gameType: string;
  gameVariant: string;
  timeControl: TimeControl;
  initialRating: number;
  currentRange: number;
  searchStartTime: number;
  socketId: string;
}

interface MatchSearchResult {
  found: boolean;
  gameId?: string;
  opponent?: {
    userId: string;
    rating: number;
  };
  currentRange?: number;
  searchDuration?: number;
  ratingChanges?: {
    whitePlayer: {
      userId: string;
      currentRating: number;
      onWin: number;
      onLoss: number;
      onDraw: number;
      isProvisional: boolean;
    };
    blackPlayer: {
      userId: string;
      currentRating: number;
      onWin: number;
      onLoss: number;
      onDraw: number;
      isProvisional: boolean;
    };
  };
}

export class DynamicMatchMaking {
  private static readonly INITIAL_RANGE = 60;
  private static readonly RANGE_EXPANSION = 60;
  private static readonly SEARCH_INTERVAL = 3000; // 3 seconds
  private static readonly MAX_RANGE = 600; // Maximum range expansion
  private static readonly SESSION_TTL = 300; // 5 minutes session expiry

  /**
   * Start a new matchmaking search session
   */
  static async startSearch(
    userId: string,
    gameType: string,
    gameVariant: string,
    timeControl: TimeControl,
    userRating: number,
    socketId: string
  ): Promise<void> {
    const session: MatchSearchSession = {
      userId,
      gameType,
      gameVariant,
      timeControl,
      initialRating: userRating,
      currentRange: this.INITIAL_RANGE,
      searchStartTime: Date.now(),
      socketId,
    };

    // Store search session in Redis with TTL
    await redis.setex(
      `search_session:${userId}`,
      this.SESSION_TTL,
      JSON.stringify(session)
    );

    // Add player to the matchmaking queue
    await addPlayerToQueue(gameType, userId, userRating);

    console.log(
      `🔍 Started matchmaking search for user ${userId} in ${gameType} with ±${this.INITIAL_RANGE} range`
    );
  }

  /**
   * Process a search request (called every 3 seconds by client)
   */
  static async processSearchRequest(
    userId: string
  ): Promise<MatchSearchResult> {
    const sessionData = await redis.get(`search_session:${userId}`);

    if (!sessionData) {
      return {
        found: false,
        currentRange: 0,
        searchDuration: 0,
      };
    }

    const session: MatchSearchSession = JSON.parse(sessionData);
    const searchDuration = Date.now() - session.searchStartTime;

    // Check if we need to expand the range
    const expansionCycles = Math.floor(searchDuration / this.SEARCH_INTERVAL);
    const newRange = Math.min(
      this.INITIAL_RANGE + expansionCycles * this.RANGE_EXPANSION,
      this.MAX_RANGE
    );

    // Update current range if it has changed
    if (newRange > session.currentRange) {
      session.currentRange = newRange;
      await redis.setex(
        `search_session:${userId}`,
        this.SESSION_TTL,
        JSON.stringify(session)
      );

      console.log(
        `📈 Expanded search range for user ${userId} to ±${newRange} (${expansionCycles} expansions)`
      );
    }

    // Search for opponents within the current range
    const minRating = session.initialRating - session.currentRange;
    const maxRating = session.initialRating + session.currentRange;

    console.log(
      `🔍 Searching for opponents for user ${userId} (rating ${session.initialRating}) in range ${minRating}-${maxRating}`
    );

    const opponents = await getOpponentInRange(
      session.gameType,
      minRating,
      maxRating
    );

    console.log(
      `👥 Found ${opponents?.length || 0} potential opponents:`,
      opponents
    );

    if (!opponents || opponents.length === 0) {
      return {
        found: false,
        currentRange: session.currentRange,
        searchDuration,
      };
    }

    // Try to find a valid opponent
    for (const opponentId of opponents) {
      console.log(`🤝 Checking opponent ${opponentId} for user ${userId}`);

      if (opponentId === userId) {
        console.log(`⚠️ Skipping self: ${opponentId}`);
        continue; // Skip self
      }

      // Check if opponent is still available
      const opponentDetails = await getPlayerHash(opponentId);
      if (!opponentDetails) {
        console.log(
          `❌ Opponent ${opponentId} not found in player hash, removing from queue`
        );
        await removePlayerFromQueue(session.gameType, opponentId);
        continue;
      }

      console.log(
        `✅ Opponent ${opponentId} found with rating ${opponentDetails.rating}`
      );

      // Verify opponent is still in queue (non-destructive check)
      const isInQueue = await isPlayerInQueue(session.gameType, opponentId);

      console.log(
        `🎲 Availability check for ${opponentId}: ${
          isInQueue ? "AVAILABLE" : "NOT AVAILABLE"
        }`
      );

      if (!isInQueue) {
        console.log(
          `❌ Opponent ${opponentId} not available, removing from queue`
        );
        await removePlayerFromQueue(session.gameType, opponentId);
        continue;
      }

      // Use Redis lock to prevent race condition where both players create games simultaneously
      const lockKey = `match_lock:${[userId, opponentId].sort().join(":")}`;
      const lockValue = `${userId}_${Date.now()}`;

      // Try to acquire lock with 5 second expiry
      const lockAcquired = await redis.set(lockKey, lockValue, "EX", 5, "NX");

      if (!lockAcquired) {
        console.log(
          `🔒 Match lock already exists for ${userId} and ${opponentId}, skipping`
        );
        continue; // Another process is already creating a game for these players
      }

      try {
        // Double-check both players are still available after acquiring lock (non-destructive)
        const stillAvailable = await Promise.all([
          isPlayerInQueue(session.gameType, userId),
          isPlayerInQueue(session.gameType, opponentId),
        ]);

        if (!stillAvailable[0] || !stillAvailable[1]) {
          console.log(`❌ Players no longer available after lock acquisition`);
          await redis.del(lockKey);
          continue;
        }

        // Now that we're committed to creating the game, remove both players from queue
        await Promise.all([
          removePlayerFromQueue(session.gameType, userId),
          removePlayerFromQueue(session.gameType, opponentId),
        ]);

        console.log(`✅ Both players confirmed available, removed from queue`);

        // Create the game
        const gameResult = await this.createGameForPlayers(
          session,
          opponentId,
          opponentDetails.rating
        );

        if (gameResult.success) {
          // Clean up both players' search sessions
          await this.cancelSearch(userId);
          await this.cancelSearch(opponentId);

          console.log(
            `🎮 Match found! Created game ${gameResult.gameId} between ${userId} (±${session.currentRange}) and ${opponentId}`
          );

          // Release lock
          await redis.del(lockKey);

          return {
            found: true,
            gameId: gameResult.gameId,
            opponent: {
              userId: opponentId,
              rating: opponentDetails.rating,
            },
            currentRange: session.currentRange,
            searchDuration,
            ratingChanges: gameResult.ratingChanges,
          };
        } else {
          // Game creation failed, release lock and continue
          await redis.del(lockKey);
        }
      } catch (error) {
        console.error(
          `❌ Error in match creation for ${userId} and ${opponentId}:`,
          error
        );
        await redis.del(lockKey);
      }
    }

    // No suitable opponent found, continue searching
    return {
      found: false,
      currentRange: session.currentRange,
      searchDuration,
    };
  }

  /**
   * Cancel an active search session
   */
  static async cancelSearch(userId: string): Promise<void> {
    const sessionData = await redis.get(`search_session:${userId}`);

    if (sessionData) {
      const session: MatchSearchSession = JSON.parse(sessionData);

      // Remove from queue and clean up
      await removePlayerFromQueue(session.gameType, userId);
      await deletePlayerHash(userId);
      await redis.del(`search_session:${userId}`);

      console.log(`❌ Cancelled search for user ${userId}`);
    }
  }

  /**
   * Get current search status
   */
  static async getSearchStatus(userId: string): Promise<{
    isSearching: boolean;
    currentRange?: number;
    searchDuration?: number;
    gameType?: string;
  }> {
    const sessionData = await redis.get(`search_session:${userId}`);

    if (!sessionData) {
      return { isSearching: false };
    }

    const session: MatchSearchSession = JSON.parse(sessionData);
    const searchDuration = Date.now() - session.searchStartTime;

    return {
      isSearching: true,
      currentRange: session.currentRange,
      searchDuration,
      gameType: session.gameType,
    };
  }

  /**
   * Determine colors for matched players using advanced logic similar to chess.com
   */
  private static async determineColors(
    player1Id: string,
    player1Rating: number,
    player2Id: string,
    player2Rating: number
  ): Promise<{
    whitePlayerId: string;
    blackPlayerId: string;
    reason: string;
  }> {
    // Get recent game history for both players to check color patterns
    const [player1History, player2History] = await Promise.all([
      this.getRecentColorHistory(player1Id),
      this.getRecentColorHistory(player2Id),
    ]);

    // Factor 1: Rating difference (higher rated player gets black slightly more often for balance)
    const ratingDiff = Math.abs(player1Rating - player2Rating);
    let player1WhiteProbability = 0.5; // Start with 50/50

    // Factor 2: Adjust based on rating difference (max 10% adjustment)
    if (ratingDiff > 100) {
      const adjustment = Math.min(ratingDiff / 2000, 0.1); // Max 10% adjustment
      if (player1Rating > player2Rating) {
        player1WhiteProbability -= adjustment; // Higher rated gets black more often
      } else {
        player1WhiteProbability += adjustment; // Lower rated gets white more often
      }
    }

    // Factor 3: Recent color balance (stronger factor)
    const player1WhiteStreak = this.countConsecutiveColors(
      player1History,
      "white"
    );
    const player1BlackStreak = this.countConsecutiveColors(
      player1History,
      "black"
    );
    const player2WhiteStreak = this.countConsecutiveColors(
      player2History,
      "white"
    );
    const player2BlackStreak = this.countConsecutiveColors(
      player2History,
      "black"
    );

    // Strongly discourage streaks of 3+ same colors
    if (player1WhiteStreak >= 2) {
      player1WhiteProbability -= 0.3; // Strong bias towards black
    } else if (player1BlackStreak >= 2) {
      player1WhiteProbability += 0.3; // Strong bias towards white
    }

    if (player2WhiteStreak >= 2) {
      player1WhiteProbability += 0.2; // If opponent had white streak, give player1 better white chance
    } else if (player2BlackStreak >= 2) {
      player1WhiteProbability -= 0.2; // If opponent had black streak, give player1 better black chance
    }

    // Factor 4: Overall color balance in recent games
    const player1WhiteRatio =
      player1History.filter((c) => c === "white").length /
      Math.max(player1History.length, 1);
    const player2WhiteRatio =
      player2History.filter((c) => c === "white").length /
      Math.max(player2History.length, 1);

    // Adjust if someone has had too many of one color recently
    if (player1WhiteRatio > 0.7) {
      player1WhiteProbability -= 0.2;
    } else if (player1WhiteRatio < 0.3) {
      player1WhiteProbability += 0.2;
    }

    // Clamp probability between 0.1 and 0.9 to always keep some randomness
    player1WhiteProbability = Math.max(
      0.1,
      Math.min(0.9, player1WhiteProbability)
    );

    // Make the final decision
    const player1GetsWhite = Math.random() < player1WhiteProbability;

    let reason = "Random assignment";
    if (Math.abs(player1WhiteProbability - 0.5) > 0.1) {
      const factors = [];
      if (ratingDiff > 100) factors.push(`rating difference (${ratingDiff})`);
      if (player1WhiteStreak >= 2)
        factors.push(`player1 white streak (${player1WhiteStreak})`);
      if (player1BlackStreak >= 2)
        factors.push(`player1 black streak (${player1BlackStreak})`);
      if (player2WhiteStreak >= 2)
        factors.push(`player2 white streak (${player2WhiteStreak})`);
      if (player2BlackStreak >= 2)
        factors.push(`player2 black streak (${player2BlackStreak})`);
      if (player1WhiteRatio > 0.7 || player1WhiteRatio < 0.3)
        factors.push(`color balance adjustment`);

      reason = `Adjusted for: ${factors.join(", ")} (${Math.round(
        player1WhiteProbability * 100
      )}% white chance)`;
    }

    return {
      whitePlayerId: player1GetsWhite ? player1Id : player2Id,
      blackPlayerId: player1GetsWhite ? player2Id : player1Id,
      reason,
    };
  }

  /**
   * Get recent color history for a player from their last few games
   */
  private static async getRecentColorHistory(
    playerId: string
  ): Promise<string[]> {
    try {
      // Get last 10 games for this player
      const recentGames = await GameModel.find({
        "players.userId": playerId,
        status: "completed",
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("players");

      const colors = recentGames
        .map((game) => {
          const player = game.players.find(
            (p) => p.userId.toString() === playerId
          );
          return player?.color || "";
        })
        .filter((color) => color !== "");

      return colors;
    } catch (error) {
      console.error(`Error getting color history for ${playerId}:`, error);
      return []; // Return empty array if error
    }
  }

  /**
   * Count consecutive colors from the most recent games
   */
  private static countConsecutiveColors(
    colorHistory: string[],
    targetColor: string
  ): number {
    let count = 0;
    for (const color of colorHistory) {
      if (color === targetColor) {
        count++;
      } else {
        break; // Stop at first different color
      }
    }
    return count;
  }

  /**
   * Create a game between two matched players
   */
  private static async createGameForPlayers(
    searcherSession: MatchSearchSession,
    opponentId: string,
    opponentRating: number
  ): Promise<{ success: boolean; gameId?: string; ratingChanges?: any }> {
    try {
      // Advanced color assignment similar to chess.com
      const colorAssignment = await this.determineColors(
        searcherSession.userId,
        searcherSession.initialRating,
        opponentId,
        opponentRating
      );

      const whitePlayerId = colorAssignment.whitePlayerId;
      const blackPlayerId = colorAssignment.blackPlayerId;

      console.log(
        `🎨 Color assignment: ${whitePlayerId} (white) vs ${blackPlayerId} (black)`
      );
      console.log(`   Reason: ${colorAssignment.reason}`);

      // Calculate potential rating changes before creating the game
      const ratingChanges = await RatingService.calculatePotentialRatingChanges(
        whitePlayerId,
        blackPlayerId,
        searcherSession.gameVariant
      );

      const playerInfo: PlayerDTO[] = [
        {
          userId: searcherSession.userId,
          color: searcherSession.userId === whitePlayerId ? "white" : "black",
          preRating: searcherSession.initialRating,
        },
        {
          userId: opponentId,
          color: opponentId === whitePlayerId ? "white" : "black",
          preRating: opponentRating,
        },
      ];

      // Create game in MongoDB
      const game = await GameModel.create({
        players: playerInfo,
        variant: searcherSession.gameVariant,
        timeControl: searcherSession.timeControl,
        // Store pre-calculated rating changes in the game document
        ratingChanges: ratingChanges,
      });

      if (!game) {
        return { success: false };
      }

      // Create game state in Redis
      const gameTimeLeft = timeControlToMs(searcherSession.timeControl);

      await createGameHash({
        gameId: game.id,
        playerInfo,
        timeLeft: gameTimeLeft,
        gameInfo: {
          gameVariant: searcherSession.gameVariant,
          gameType: searcherSession.gameType,
          timeControl: searcherSession.timeControl,
        },
        initialFen: DEFAULT_FEN,
        moves: [],
        pgn: "",
        turn: "white",
        startedAt: Date.now(),
        lastMovePlayedAt: Date.now(),
      });

      // Note: Players are removed from queue in processSearchRequest before this method is called

      return { success: true, gameId: game.id, ratingChanges };
    } catch (error) {
      console.error("Error creating game:", error);
      return { success: false };
    }
  }
  /**
   * Clean up expired search sessions (can be called periodically)
   */
  static async cleanupExpiredSessions(): Promise<void> {
    // Redis TTL will handle automatic cleanup
    // This method is available for manual cleanup if needed
    console.log(
      "🧹 Cleaning up expired search sessions (handled by Redis TTL)"
    );
  }

  /**
   * Get matchmaking statistics
   */
  static async getMatchmakingStats(): Promise<{
    activeSessions: number;
    queueCounts: Record<string, number>;
  }> {
    const sessionKeys = await redis.keys("search_session:*");
    const activeSessions = sessionKeys.length;

    // Count players in each queue
    const queueKeys = await redis.keys("match-making-queue:*");
    const queueCounts: Record<string, number> = {};

    for (const queueKey of queueKeys) {
      const gameType = queueKey.replace("match-making-queue:", "");
      const count = await redis.zcard(queueKey);
      queueCounts[gameType] = count;
    }

    return {
      activeSessions,
      queueCounts,
    };
  }
}
