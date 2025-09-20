import UserProfileModel from "../../models/userProfile";
import GameModel from "../../models/game";
import { PlayerColor, GameResult } from "../../types/game";

interface RatingCalculationResult {
  whitePlayerRating: {
    oldRating: number;
    newRating: number;
    ratingChange: number;
  };
  blackPlayerRating: {
    oldRating: number;
    newRating: number;
    ratingChange: number;
  };
}

interface PlayerRatingInfo {
  userId: string;
  color: PlayerColor;
  oldRating: number;
  isProvisional: boolean;
  gamesPlayed: number;
}

export class RatingService {
  // Rating system constants
  private static readonly DEFAULT_RATING = 1200;
  private static readonly PROVISIONAL_GAMES_THRESHOLD = 30; // First 30 games are provisional
  private static readonly MAX_RATING_CHANGE = 32; // Maximum rating change per game
  private static readonly MIN_RATING_CHANGE = 1; // Minimum rating change per game
  private static readonly RATING_FLOOR = 100; // Minimum possible rating

  // K-factor calculation based on rating and provisional status
  private static readonly K_FACTOR_PROVISIONAL = 40; // Higher K for new players
  private static readonly K_FACTOR_BELOW_2100 = 32; // Standard K for most players
  private static readonly K_FACTOR_ABOVE_2100 = 16; // Lower K for strong players
  private static readonly K_FACTOR_ABOVE_2400 = 10; // Lowest K for masters

  /**
   * Calculate new ratings for both players after a game
   */
  static async calculateNewRatings(
    gameId: string,
    gameResult: GameResult,
    gameVariant: string
  ): Promise<RatingCalculationResult> {
    // Get game details
    const game = await GameModel.findById(gameId).populate("players");
    if (!game) {
      throw new Error("Game not found");
    }

    // Get player profiles with current ratings
    const whitePlayer = game.players.find((p) => p.color === "white");
    const blackPlayer = game.players.find((p) => p.color === "black");

    if (!whitePlayer || !blackPlayer) {
      throw new Error("Invalid game players");
    }

    const whiteProfile = await UserProfileModel.findOne({
      userId: whitePlayer.userId,
    });
    const blackProfile = await UserProfileModel.findOne({
      userId: blackPlayer.userId,
    });

    if (!whiteProfile || !blackProfile) {
      throw new Error("Player profiles not found");
    }

    // Get rating type based on game variant
    const ratingType = this.getRatingTypeFromVariant(gameVariant);

    // Get current ratings and game counts
    const whiteRatingInfo: PlayerRatingInfo = {
      userId: whitePlayer.userId.toString(),
      color: "white",
      oldRating: whiteProfile.rating[ratingType] || this.DEFAULT_RATING,
      isProvisional:
        (whiteProfile.totalGames || 0) < this.PROVISIONAL_GAMES_THRESHOLD,
      gamesPlayed: whiteProfile.totalGames || 0,
    };

    const blackRatingInfo: PlayerRatingInfo = {
      userId: blackPlayer.userId.toString(),
      color: "black",
      oldRating: blackProfile.rating[ratingType] || this.DEFAULT_RATING,
      isProvisional:
        (blackProfile.totalGames || 0) < this.PROVISIONAL_GAMES_THRESHOLD,
      gamesPlayed: blackProfile.totalGames || 0,
    };

    // Calculate score from game result
    const { whiteScore, blackScore } = this.getScoreFromResult(gameResult);

    // Calculate new ratings using Elo formula
    const whiteNewRating = this.calculateEloRating(
      whiteRatingInfo,
      blackRatingInfo.oldRating,
      whiteScore
    );

    const blackNewRating = this.calculateEloRating(
      blackRatingInfo,
      whiteRatingInfo.oldRating,
      blackScore
    );

    return {
      whitePlayerRating: {
        oldRating: whiteRatingInfo.oldRating,
        newRating: whiteNewRating,
        ratingChange: whiteNewRating - whiteRatingInfo.oldRating,
      },
      blackPlayerRating: {
        oldRating: blackRatingInfo.oldRating,
        newRating: blackNewRating,
        ratingChange: blackNewRating - blackRatingInfo.oldRating,
      },
    };
  }

  /**
   * Update player ratings in database after game completion
   */
  static async updatePlayerRatings(
    gameId: string,
    gameResult: GameResult,
    gameVariant: string,
    winner: PlayerColor | null
  ): Promise<RatingCalculationResult> {
    const ratingCalculation = await this.calculateNewRatings(
      gameId,
      gameResult,
      gameVariant
    );
    const ratingType = this.getRatingTypeFromVariant(gameVariant);

    // Get game details for player IDs
    const game = await GameModel.findById(gameId);
    if (!game) {
      throw new Error("Game not found");
    }

    const whitePlayer = game.players.find((p) => p.color === "white");
    const blackPlayer = game.players.find((p) => p.color === "black");

    if (!whitePlayer || !blackPlayer) {
      throw new Error("Invalid game players");
    }

    // Update white player rating and stats
    await UserProfileModel.findOneAndUpdate(
      { userId: whitePlayer.userId.toString() },
      {
        $set: {
          [`rating.${ratingType}`]:
            ratingCalculation.whitePlayerRating.newRating,
        },
        $inc: {
          totalGames: 1,
          ...(winner === "white" && { wins: 1 }),
          ...(winner === "black" && { losses: 1 }),
          ...(winner === null && { draws: 1 }),
        },
      }
    );

    // Update black player rating and stats
    await UserProfileModel.findOneAndUpdate(
      { userId: blackPlayer.userId.toString() },
      {
        $set: {
          [`rating.${ratingType}`]:
            ratingCalculation.blackPlayerRating.newRating,
        },
        $inc: {
          totalGames: 1,
          ...(winner === "black" && { wins: 1 }),
          ...(winner === "white" && { losses: 1 }),
          ...(winner === null && { draws: 1 }),
        },
      }
    );

    // Update the game document with post-game ratings
    await GameModel.findByIdAndUpdate(
      gameId,
      {
        $set: {
          "players.$[white].postRating":
            ratingCalculation.whitePlayerRating.newRating,
          "players.$[black].postRating":
            ratingCalculation.blackPlayerRating.newRating,
          status: "completed",
          result: gameResult,
          winner: winner,
        },
      },
      {
        arrayFilters: [{ "white.color": "white" }, { "black.color": "black" }],
      }
    );

    console.log(`📊 Updated ratings for game ${gameId}:`);
    console.log(
      `   White: ${ratingCalculation.whitePlayerRating.oldRating} → ${
        ratingCalculation.whitePlayerRating.newRating
      } (${ratingCalculation.whitePlayerRating.ratingChange > 0 ? "+" : ""}${
        ratingCalculation.whitePlayerRating.ratingChange
      })`
    );
    console.log(
      `   Black: ${ratingCalculation.blackPlayerRating.oldRating} → ${
        ratingCalculation.blackPlayerRating.newRating
      } (${ratingCalculation.blackPlayerRating.ratingChange > 0 ? "+" : ""}${
        ratingCalculation.blackPlayerRating.ratingChange
      })`
    );

    return ratingCalculation;
  }

  /**
   * Calculate potential rating changes before a game starts
   * This is what players see before accepting a match
   */
  static async calculatePotentialRatingChanges(
    whitePlayerId: string,
    blackPlayerId: string,
    gameVariant: string
  ): Promise<{
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
  }> {
    // Get player profiles
    const whiteProfile = await UserProfileModel.findOne({
      userId: whitePlayerId,
    });
    const blackProfile = await UserProfileModel.findOne({
      userId: blackPlayerId,
    });

    if (!whiteProfile || !blackProfile) {
      throw new Error("Player profiles not found");
    }

    // Get rating type based on game variant
    const ratingType = this.getRatingTypeFromVariant(gameVariant);

    // Get current ratings and game counts
    const whiteRatingInfo: PlayerRatingInfo = {
      userId: whitePlayerId,
      color: "white",
      oldRating: whiteProfile.rating[ratingType] || this.DEFAULT_RATING,
      isProvisional:
        (whiteProfile.totalGames || 0) < this.PROVISIONAL_GAMES_THRESHOLD,
      gamesPlayed: whiteProfile.totalGames || 0,
    };

    const blackRatingInfo: PlayerRatingInfo = {
      userId: blackPlayerId,
      color: "black",
      oldRating: blackProfile.rating[ratingType] || this.DEFAULT_RATING,
      isProvisional:
        (blackProfile.totalGames || 0) < this.PROVISIONAL_GAMES_THRESHOLD,
      gamesPlayed: blackProfile.totalGames || 0,
    };

    // Calculate potential rating changes for all outcomes
    const whiteWinRating = this.calculateEloRating(
      whiteRatingInfo,
      blackRatingInfo.oldRating,
      1
    );
    const whiteLossRating = this.calculateEloRating(
      whiteRatingInfo,
      blackRatingInfo.oldRating,
      0
    );
    const whiteDrawRating = this.calculateEloRating(
      whiteRatingInfo,
      blackRatingInfo.oldRating,
      0.5
    );

    const blackWinRating = this.calculateEloRating(
      blackRatingInfo,
      whiteRatingInfo.oldRating,
      1
    );
    const blackLossRating = this.calculateEloRating(
      blackRatingInfo,
      whiteRatingInfo.oldRating,
      0
    );
    const blackDrawRating = this.calculateEloRating(
      blackRatingInfo,
      whiteRatingInfo.oldRating,
      0.5
    );

    return {
      whitePlayer: {
        userId: whitePlayerId,
        currentRating: whiteRatingInfo.oldRating,
        onWin: whiteWinRating - whiteRatingInfo.oldRating,
        onLoss: whiteLossRating - whiteRatingInfo.oldRating,
        onDraw: whiteDrawRating - whiteRatingInfo.oldRating,
        isProvisional: whiteRatingInfo.isProvisional,
      },
      blackPlayer: {
        userId: blackPlayerId,
        currentRating: blackRatingInfo.oldRating,
        onWin: blackWinRating - blackRatingInfo.oldRating,
        onLoss: blackLossRating - blackRatingInfo.oldRating,
        onDraw: blackDrawRating - blackRatingInfo.oldRating,
        isProvisional: blackRatingInfo.isProvisional,
      },
    };
  }

  /**
   * Calculate Elo rating using standard formula
   */
  private static calculateEloRating(
    player: PlayerRatingInfo,
    opponentRating: number,
    score: number
  ): number {
    // Calculate expected score
    const expectedScore = this.calculateExpectedScore(
      player.oldRating,
      opponentRating
    );

    // Get appropriate K-factor
    const kFactor = this.getKFactor(player);

    // Calculate rating change
    const ratingChange = Math.round(kFactor * (score - expectedScore));

    // Apply rating change with bounds checking
    let newRating = player.oldRating + ratingChange;

    // Ensure rating doesn't go below floor
    newRating = Math.max(newRating, this.RATING_FLOOR);

    // Cap rating change for extreme cases
    const maxChange = player.isProvisional
      ? this.K_FACTOR_PROVISIONAL
      : this.MAX_RATING_CHANGE;
    const actualChange = newRating - player.oldRating;

    if (Math.abs(actualChange) > maxChange) {
      newRating =
        player.oldRating + (actualChange > 0 ? maxChange : -maxChange);
    }

    return Math.round(newRating);
  }

  /**
   * Calculate expected score using Elo formula
   */
  private static calculateExpectedScore(
    playerRating: number,
    opponentRating: number
  ): number {
    const ratingDifference = opponentRating - playerRating;
    return 1 / (1 + Math.pow(10, ratingDifference / 400));
  }

  /**
   * Get appropriate K-factor based on player rating and provisional status
   */
  private static getKFactor(player: PlayerRatingInfo): number {
    // Provisional players get higher K-factor for faster rating adjustment
    if (player.isProvisional) {
      return this.K_FACTOR_PROVISIONAL;
    }

    // K-factor based on current rating level
    if (player.oldRating >= 2400) {
      return this.K_FACTOR_ABOVE_2400; // Masters
    } else if (player.oldRating >= 2100) {
      return this.K_FACTOR_ABOVE_2100; // Expert level
    } else {
      return this.K_FACTOR_BELOW_2100; // Standard level
    }
  }

  /**
   * Convert game result to numerical scores
   */
  private static getScoreFromResult(result: GameResult): {
    whiteScore: number;
    blackScore: number;
  } {
    switch (result) {
      case "1-0": // White wins
        return { whiteScore: 1, blackScore: 0 };
      case "0-1": // Black wins
        return { whiteScore: 0, blackScore: 1 };
      case "1/2-1/2": // Draw
        return { whiteScore: 0.5, blackScore: 0.5 };
      default:
        throw new Error(`Invalid game result: ${result}`);
    }
  }

  /**
   * Map game variant to rating type
   */
  private static getRatingTypeFromVariant(
    gameVariant: string
  ): "rapid" | "blitz" | "bullet" {
    switch (gameVariant.toUpperCase()) {
      case "RAPID":
        return "rapid";
      case "BLITZ":
        return "blitz";
      case "BULLET":
        return "bullet";
      default:
        throw new Error(`Unsupported game variant: ${gameVariant}`);
    }
  }

  /**
   * Get rating category/title based on rating
   */
  static getRatingCategory(rating: number): {
    title: string;
    color: string;
    description: string;
  } {
    if (rating >= 2400) {
      return {
        title: "Master",
        color: "#FFD700", // Gold
        description: "Chess Master level",
      };
    } else if (rating >= 2200) {
      return {
        title: "Expert",
        color: "#8B4513", // Brown
        description: "Expert level player",
      };
    } else if (rating >= 2000) {
      return {
        title: "Class A",
        color: "#800080", // Purple
        description: "Strong advanced player",
      };
    } else if (rating >= 1800) {
      return {
        title: "Class B",
        color: "#0000FF", // Blue
        description: "Advanced player",
      };
    } else if (rating >= 1600) {
      return {
        title: "Class C",
        color: "#008000", // Green
        description: "Intermediate player",
      };
    } else if (rating >= 1400) {
      return {
        title: "Class D",
        color: "#FFA500", // Orange
        description: "Improving player",
      };
    } else if (rating >= 1200) {
      return {
        title: "Class E",
        color: "#FFFF00", // Yellow
        description: "Beginner with basics",
      };
    } else {
      return {
        title: "Beginner",
        color: "#808080", // Gray
        description: "Learning the game",
      };
    }
  }

  /**
   * Calculate rating deviation (uncertainty) for new players
   */
  static calculateRatingDeviation(gamesPlayed: number): number {
    // Higher deviation for newer players
    if (gamesPlayed < 10) {
      return 200; // Very uncertain
    } else if (gamesPlayed < 20) {
      return 150; // Somewhat uncertain
    } else if (gamesPlayed < 30) {
      return 100; // Becoming more stable
    } else {
      return 50; // Stable rating
    }
  }

  /**
   * Get player's rating history
   */
  static async getPlayerRatingHistory(
    userId: string,
    ratingType: "rapid" | "blitz" | "bullet",
    limit: number = 50
  ): Promise<
    Array<{
      gameId: string;
      date: Date;
      oldRating: number;
      newRating: number;
      ratingChange: number;
      opponent: {
        userId: string;
        username?: string;
        rating: number;
      };
      result: GameResult;
      color: PlayerColor;
    }>
  > {
    // Get recent games for this player and rating type
    const games = await GameModel.find({
      "players.userId": userId,
      variant: ratingType.toUpperCase(),
      status: "completed",
      result: { $exists: true },
    })
      .sort({ updatedAt: -1 })
      .limit(limit);

    const ratingHistory = [];

    for (const game of games) {
      const playerData = game.players.find(
        (p) => p.userId.toString() === userId
      );
      const opponentData = game.players.find(
        (p) => p.userId.toString() !== userId
      );

      if (
        playerData &&
        opponentData &&
        playerData.preRating &&
        playerData.postRating &&
        game.result
      ) {
        ratingHistory.push({
          gameId: (game._id as any).toString(),
          date: (game as any).updatedAt || new Date(),
          oldRating: playerData.preRating,
          newRating: playerData.postRating,
          ratingChange: playerData.postRating - playerData.preRating,
          opponent: {
            userId: opponentData.userId.toString(),
            username: undefined, // Will be populated separately if needed
            rating: opponentData.preRating || this.DEFAULT_RATING,
          },
          result: game.result as unknown as GameResult,
          color: playerData.color,
        });
      }
    }

    return ratingHistory;
  }

  /**
   * Get leaderboard for a specific rating type
   */
  static async getLeaderboard(
    ratingType: "rapid" | "blitz" | "bullet",
    limit: number = 100
  ): Promise<
    Array<{
      userId: string;
      username: string;
      rating: number;
      gamesPlayed: number;
      winRate: number;
      category: {
        title: string;
        color: string;
        description: string;
      };
    }>
  > {
    const profiles = await UserProfileModel.find({
      [`rating.${ratingType}`]: { $exists: true },
      totalGames: { $gte: 10 }, // Minimum games to appear on leaderboard
    })
      .populate("userId", "username")
      .sort({ [`rating.${ratingType}`]: -1 })
      .limit(limit);

    return profiles.map((profile) => ({
      userId: (profile.userId as any)._id?.toString() || "",
      username: (profile.userId as any)?.username || "Unknown",
      rating: profile.rating[ratingType] || this.DEFAULT_RATING,
      gamesPlayed: profile.totalGames || 0,
      winRate:
        (profile.totalGames || 0) > 0
          ? ((profile.wins || 0) / (profile.totalGames || 1)) * 100
          : 0,
      category: this.getRatingCategory(
        profile.rating[ratingType] || this.DEFAULT_RATING
      ),
    }));
  }

  /**
   * Get detailed rating statistics for a player
   */
  static async getPlayerRatingStats(userId: string): Promise<{
    rapid: {
      rating: number;
      gamesPlayed: number;
      provisional: boolean;
      deviation: number;
      category: ReturnType<typeof RatingService.getRatingCategory>;
      recentChange: number;
    };
    blitz: {
      rating: number;
      gamesPlayed: number;
      provisional: boolean;
      deviation: number;
      category: ReturnType<typeof RatingService.getRatingCategory>;
      recentChange: number;
    };
    bullet: {
      rating: number;
      gamesPlayed: number;
      provisional: boolean;
      deviation: number;
      category: ReturnType<typeof RatingService.getRatingCategory>;
      recentChange: number;
    };
  }> {
    const profile = await UserProfileModel.findOne({ userId });
    if (!profile) {
      throw new Error("Player profile not found");
    }

    const ratingTypes: Array<"rapid" | "blitz" | "bullet"> = [
      "rapid",
      "blitz",
      "bullet",
    ];
    const stats: any = {};

    for (const ratingType of ratingTypes) {
      const rating = profile.rating[ratingType] || this.DEFAULT_RATING;
      const gamesPlayed = profile.totalGames || 0; // Fallback to 0 if undefined
      const provisional = gamesPlayed < this.PROVISIONAL_GAMES_THRESHOLD;
      const deviation = this.calculateRatingDeviation(gamesPlayed);
      const category = this.getRatingCategory(rating);

      // Get recent rating change (last 10 games)
      const recentHistory = await this.getPlayerRatingHistory(
        userId,
        ratingType,
        10
      );
      const recentChange =
        recentHistory.length > 0
          ? recentHistory[0].newRating -
            (recentHistory[recentHistory.length - 1]?.oldRating || rating)
          : 0;

      stats[ratingType] = {
        rating,
        gamesPlayed,
        provisional,
        deviation,
        category,
        recentChange,
      };
    }

    return stats;
  }
}
