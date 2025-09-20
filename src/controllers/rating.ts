import { NextFunction, Request, Response } from "express";
import asyncWrapper from "../utils/asyncWrapper";
import APIError from "../utils/APIError";
import APIResponse from "../utils/APIResponse";
import { RatingService } from "../services/rating/RatingService";
import GameModel from "../models/game";

/**
 * Get detailed rating statistics for the authenticated user
 */
export const getUserRatingStats = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.badRequest("UserId missing");
    }

    const ratingStats = await RatingService.getPlayerRatingStats(
      req.user.userId
    );

    return APIResponse.success(res, "Rating statistics retrieved", ratingStats);
  }
);

/**
 * Get rating history for a specific rating type
 */
export const getRatingHistory = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.badRequest("UserId missing");
    }

    const { ratingType, limit } = req.query;

    if (
      !ratingType ||
      !["rapid", "blitz", "bullet"].includes(ratingType as string)
    ) {
      throw APIError.badRequest(
        "Valid ratingType (rapid, blitz, bullet) is required"
      );
    }

    const limitNum = limit ? parseInt(limit as string) : 50;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 200) {
      throw APIError.badRequest("Limit must be between 1 and 200");
    }

    const history = await RatingService.getPlayerRatingHistory(
      req.user.userId,
      ratingType as "rapid" | "blitz" | "bullet",
      limitNum
    );

    return APIResponse.success(res, "Rating history retrieved", {
      ratingType,
      history,
      count: history.length,
    });
  }
);

/**
 * Get leaderboard for a specific rating type
 */
export const getLeaderboard = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { ratingType, limit } = req.query;

    if (
      !ratingType ||
      !["rapid", "blitz", "bullet"].includes(ratingType as string)
    ) {
      throw APIError.badRequest(
        "Valid ratingType (rapid, blitz, bullet) is required"
      );
    }

    const limitNum = limit ? parseInt(limit as string) : 100;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 500) {
      throw APIError.badRequest("Limit must be between 1 and 500");
    }

    const leaderboard = await RatingService.getLeaderboard(
      ratingType as "rapid" | "blitz" | "bullet",
      limitNum
    );

    return APIResponse.success(res, "Leaderboard retrieved", {
      ratingType,
      leaderboard,
      count: leaderboard.length,
    });
  }
);

/**
 * Get rating category information for any rating value
 */
export const getRatingCategory = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { rating } = req.query;

    if (!rating) {
      throw APIError.badRequest("Rating parameter is required");
    }

    const ratingNum = parseInt(rating as string);
    if (isNaN(ratingNum) || ratingNum < 0 || ratingNum > 3000) {
      throw APIError.badRequest("Rating must be a number between 0 and 3000");
    }

    const category = RatingService.getRatingCategory(ratingNum);

    return APIResponse.success(res, "Rating category retrieved", {
      rating: ratingNum,
      category,
    });
  }
);

/**
 * Get detailed rating statistics for any user (public endpoint)
 */
export const getPublicUserRatingStats = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = req.params;

    if (!userId) {
      throw APIError.badRequest("UserId parameter is required");
    }

    try {
      const ratingStats = await RatingService.getPlayerRatingStats(userId);

      return APIResponse.success(res, "Public rating statistics retrieved", {
        userId,
        stats: ratingStats,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Player profile not found"
      ) {
        throw APIError.notFound("User not found");
      }
      throw error;
    }
  }
);

/**
 * Calculate hypothetical rating change for a potential match
 */
export const calculateHypotheticalRating = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { playerRating, opponentRating, result, ratingType, isProvisional } =
      req.body;

    // Validate inputs
    if (
      typeof playerRating !== "number" ||
      playerRating < 0 ||
      playerRating > 3000
    ) {
      throw APIError.badRequest(
        "playerRating must be a number between 0 and 3000"
      );
    }

    if (
      typeof opponentRating !== "number" ||
      opponentRating < 0 ||
      opponentRating > 3000
    ) {
      throw APIError.badRequest(
        "opponentRating must be a number between 0 and 3000"
      );
    }

    if (!["1-0", "0-1", "1/2-1/2"].includes(result)) {
      throw APIError.badRequest("result must be '1-0', '0-1', or '1/2-1/2'");
    }

    if (!["rapid", "blitz", "bullet"].includes(ratingType)) {
      throw APIError.badRequest(
        "ratingType must be 'rapid', 'blitz', or 'bullet'"
      );
    }

    // Create a mock player info for calculation
    const mockPlayerInfo = {
      userId: "mock",
      color: "white" as const,
      oldRating: playerRating,
      isProvisional: Boolean(isProvisional),
      gamesPlayed: isProvisional ? 10 : 50, // Mock games played
    };

    // Calculate expected score
    const expectedScore = (RatingService as any).calculateExpectedScore(
      playerRating,
      opponentRating
    );

    // Get score from result
    const score = result === "1-0" ? 1 : result === "0-1" ? 0 : 0.5;

    // Get K-factor
    const kFactor = (RatingService as any).getKFactor(mockPlayerInfo);

    // Calculate rating change
    const ratingChange = Math.round(kFactor * (score - expectedScore));
    const newRating = Math.max(100, playerRating + ratingChange); // Apply rating floor

    return APIResponse.success(res, "Hypothetical rating calculated", {
      playerRating,
      opponentRating,
      result,
      ratingType,
      isProvisional,
      calculation: {
        expectedScore: Math.round(expectedScore * 100) / 100, // Round to 2 decimals
        actualScore: score,
        kFactor,
        ratingChange,
        newRating,
        ratingChangeDescription:
          ratingChange > 0 ? `+${ratingChange}` : `${ratingChange}`,
      },
    });
  }
);

/**
 * Get rating distribution statistics
 */
export const getRatingDistribution = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { ratingType } = req.query;

    if (
      !ratingType ||
      !["rapid", "blitz", "bullet"].includes(ratingType as string)
    ) {
      throw APIError.badRequest(
        "Valid ratingType (rapid, blitz, bullet) is required"
      );
    }

    // This would require aggregation queries on the database
    // For now, we'll return a simplified version
    const distribution = {
      ratingType,
      totalPlayers: 0, // Would need to count from database
      averageRating: 1200, // Would calculate from database
      ratingRanges: [
        { range: "0-999", count: 0, percentage: 0 },
        { range: "1000-1199", count: 0, percentage: 0 },
        { range: "1200-1399", count: 0, percentage: 0 },
        { range: "1400-1599", count: 0, percentage: 0 },
        { range: "1600-1799", count: 0, percentage: 0 },
        { range: "1800-1999", count: 0, percentage: 0 },
        { range: "2000-2199", count: 0, percentage: 0 },
        { range: "2200-2399", count: 0, percentage: 0 },
        { range: "2400+", count: 0, percentage: 0 },
      ],
    };

    return APIResponse.success(
      res,
      "Rating distribution retrieved",
      distribution
    );
  }
);

/**
 * Get rating changes for a specific game
 */
export const getGameRatingChanges = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.badRequest("UserId missing");
    }

    const { gameId } = req.params;

    if (!gameId) {
      throw APIError.badRequest("Game ID is required");
    }

    // Get game from database including rating changes
    const game = await GameModel.findById(gameId);

    if (!game) {
      throw APIError.notFound("Game not found");
    }

    // Check if user is part of this game
    const userPlayer = game.players.find(
      (p: any) => p.userId.toString() === req.user!.userId
    );
    if (!userPlayer) {
      throw APIError.forbidden("You are not a player in this game");
    }

    // Return the stored rating changes from the game document
    return APIResponse.success(res, "Game rating changes retrieved", {
      gameId,
      ratingChanges: game.ratingChanges || null,
      gameVariant: game.variant,
      timeControl: game.timeControl,
      status: game.status,
    });
  }
);
