import redis from "../../config/redis";
import {
  addPlayerToQueue,
  getOpponentInRange,
  removePlayerFromQueue,
  checkPlayerAvialabilityForGame,
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

      // Verify opponent is still in queue
      const isAvailable = await checkPlayerAvialabilityForGame(
        session.gameType,
        opponentId
      );

      console.log(
        `🎲 Availability check for ${opponentId}: ${
          isAvailable ? "AVAILABLE" : "NOT AVAILABLE"
        }`
      );

      if (!isAvailable) {
        console.log(
          `❌ Opponent ${opponentId} not available, removing from queue`
        );
        await removePlayerFromQueue(session.gameType, opponentId);
        continue;
      }

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
   * Create a game between two matched players
   */
  private static async createGameForPlayers(
    searcherSession: MatchSearchSession,
    opponentId: string,
    opponentRating: number
  ): Promise<{ success: boolean; gameId?: string; ratingChanges?: any }> {
    try {
      // Randomly assign colors
      const isSearcherWhite = Math.random() < 0.5;

      const whitePlayerId = isSearcherWhite
        ? searcherSession.userId
        : opponentId;
      const blackPlayerId = isSearcherWhite
        ? opponentId
        : searcherSession.userId;

      // Calculate potential rating changes before creating the game
      const ratingChanges = await RatingService.calculatePotentialRatingChanges(
        whitePlayerId,
        blackPlayerId,
        searcherSession.gameVariant
      );

      const playerInfo: PlayerDTO[] = [
        {
          userId: searcherSession.userId,
          color: isSearcherWhite ? "white" : "black",
          preRating: searcherSession.initialRating,
        },
        {
          userId: opponentId,
          color: isSearcherWhite ? "black" : "white",
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

      // Remove both players from the queue
      await removePlayerFromQueue(
        searcherSession.gameType,
        searcherSession.userId
      );
      await removePlayerFromQueue(searcherSession.gameType, opponentId);

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
