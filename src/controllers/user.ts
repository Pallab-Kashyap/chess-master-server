import asyncWrapper from "../utils/asyncWrapper";

import { Request, Response, NextFunction } from "express";
import APIError from "../utils/APIError";
import UserModel from "../models/user";
import UserProfileModel from "../models/userProfile";
import GameModel from "../models/game";
import { UserPayload } from "../types/express";
import { createPlayerHash } from "../services/redis/playerHash";
import { PlayerDTO } from "../types/game";
import APIResponse from "../utils/APIResponse";
import { generateToken } from "../utils/generateToken";
import { RatingService } from "../services/rating/RatingService";

export const getUserProfile = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.unauthorized("Unauthorized");
    }

    const user = await UserModel.findById(req.user.userId).select(
      "-_id _id username email createdAt"
    );
    if (!user) {
      throw APIError.notFound("User not found");
    }

    const userProfile = await UserProfileModel.findOne({
      userId: req.user.userId,
    });

    if (!userProfile) {
      throw APIError.notFound("User profile not found");
    }

    return APIResponse.success(res, "", { user, userProfile });
  }
);

export const registerUser = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { username, email, clerkId } = req.body;

    if (!username || !email || !clerkId) {
      throw APIError.badRequest("Username, email, and password are required");
    }

    const existingUser = await UserModel.findOne({
      $or: [{ username }, { email }],
    });
    if (existingUser) {
      throw APIError.conflict("Username or email already exists");
    }

    const newUser = new UserModel({ username, email, clerkId });
    await newUser.save();

    const newUserProfile = new UserProfileModel({ userId: newUser._id });
    await newUserProfile.save();

    const token = generateToken({ userId: newUser._id } as UserPayload);

    // Create player hash in Redis
    return APIResponse.created(res, "User registered successfully", {
      user: {
        id: newUser._id,
        username: newUser.username,
        email: newUser.email,
      },
      token,
    });
  }
);

export const loginUser = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { email, password, clerkId } = req.body;

    if (!email || (!password && !clerkId)) {
      throw APIError.badRequest("Email and password/clerkId are required");
    }

    const user = await UserModel.findOne({ email });
    if (!user) {
      throw APIError.unauthorized("Invalid credentials");
    }

    // Get user profile with ratings
    const userProfile = await UserProfileModel.findOne({ userId: user._id });
    if (!userProfile) {
      throw APIError.notFound("User profile not found");
    }

    // For now, we'll skip password verification since we're using clerkId
    // In a real app, you'd verify the password or clerkId here

    const token = generateToken({ userId: user._id } as UserPayload);

    return APIResponse.success(res, "Login successful", {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
      },
      userProfile: {
        rating: userProfile.rating,
      },
      token,
    });
  }
);

export const getUserDashboard = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.unauthorized("Unauthorized");
    }

    const userId = req.user.userId;

    // Get user basic info
    const user = await UserModel.findById(userId).select(
      "username email createdAt"
    );
    if (!user) {
      throw APIError.notFound("User not found");
    }

    // Get user profile with ratings
    const userProfile = await UserProfileModel.findOne({ userId });
    if (!userProfile) {
      throw APIError.notFound("User profile not found");
    }

    // Get rating statistics
    const ratingStats = await RatingService.getPlayerRatingStats(userId);

    // Get recent games (last 10)
    const recentGames = await GameModel.find({
      "players.userId": userId,
      status: "completed",
    })
      .sort({ endedAt: -1 })
      .limit(10)
      .populate("players.userId", "username")
      .select("variant timeControl result endedAt players moves");

    // Calculate game statistics
    const totalGames = await GameModel.countDocuments({
      "players.userId": userId,
      status: "completed",
    });

    const wins = await GameModel.countDocuments({
      "players.userId": userId,
      status: "completed",
      $or: [
        {
          "result.winner": "white",
          players: { $elemMatch: { userId, color: "white" } },
        },
        {
          "result.winner": "black",
          players: { $elemMatch: { userId, color: "black" } },
        },
      ],
    });

    const draws = await GameModel.countDocuments({
      "players.userId": userId,
      status: "completed",
      "result.winner": null,
    });

    const losses = totalGames - wins - draws;

    // Get current ongoing games
    const ongoingGames = await GameModel.find({
      "players.userId": userId,
      status: "on-going",
    })
      .populate("players.userId", "username")
      .select("variant timeControl players startedAt");

    return APIResponse.success(res, "User dashboard data retrieved", {
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        memberSince: user.createdAt,
      },
      ratings: ratingStats,
      gameStats: {
        totalGames,
        wins,
        draws,
        losses,
        winRate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
      },
      recentGames: recentGames.map((game: any) => ({
        gameId: game._id,
        variant: game.variant,
        timeControl: game.timeControl,
        result: game.result,
        endedAt: game.endedAt,
        opponent: game.players.find(
          (p: any) => p.userId._id.toString() !== userId
        )?.userId,
        myColor: game.players.find(
          (p: any) => p.userId._id.toString() === userId
        )?.color,
        moveCount: game.moves.length,
      })),
      ongoingGames: ongoingGames.map((game: any) => ({
        gameId: game._id,
        variant: game.variant,
        timeControl: game.timeControl,
        opponent: game.players.find(
          (p: any) => p.userId._id.toString() !== userId
        )?.userId,
        myColor: game.players.find(
          (p: any) => p.userId._id.toString() === userId
        )?.color,
        startedAt: game.startedAt,
      })),
    });
  }
);

export const getUserGameHistory = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.unauthorized("Unauthorized");
    }

    const userId = req.user.userId;
    const { page = 1, limit = 20, variant, result } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);

    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      throw APIError.badRequest("Invalid pagination parameters");
    }

    // Build filter
    const filter: any = {
      "players.userId": userId,
      status: "completed",
    };

    if (variant) {
      filter.variant = variant;
    }

    if (result) {
      if (result === "win") {
        filter.$or = [
          {
            "result.winner": "white",
            players: { $elemMatch: { userId, color: "white" } },
          },
          {
            "result.winner": "black",
            players: { $elemMatch: { userId, color: "black" } },
          },
        ];
      } else if (result === "loss") {
        filter.$or = [
          {
            "result.winner": "white",
            players: { $elemMatch: { userId, color: "black" } },
          },
          {
            "result.winner": "black",
            players: { $elemMatch: { userId, color: "white" } },
          },
        ];
      } else if (result === "draw") {
        filter["result.winner"] = null;
      }
    }

    const skip = (pageNum - 1) * limitNum;

    const [games, totalCount] = await Promise.all([
      GameModel.find(filter)
        .sort({ endedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .populate("players.userId", "username")
        .select("variant timeControl result endedAt players moves pgn"),
      GameModel.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / limitNum);

    return APIResponse.success(res, "Game history retrieved", {
      games: games.map((game: any) => {
        const opponent = game.players.find(
          (p: any) => p.userId._id.toString() !== userId
        );
        const myPlayer = game.players.find(
          (p: any) => p.userId._id.toString() === userId
        );

        let gameResult = "draw";
        if (game.result.winner === myPlayer.color) {
          gameResult = "win";
        } else if (
          game.result.winner &&
          game.result.winner !== myPlayer.color
        ) {
          gameResult = "loss";
        }

        return {
          gameId: game._id,
          variant: game.variant,
          timeControl: game.timeControl,
          result: gameResult,
          gameResult: game.result,
          endedAt: game.endedAt,
          opponent: opponent?.userId,
          myColor: myPlayer?.color,
          moveCount: game.moves.length,
          pgn: game.pgn,
        };
      }),
      pagination: {
        currentPage: pageNum,
        totalPages,
        totalCount,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
    });
  }
);

export const getUserStats = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.unauthorized("Unauthorized");
    }

    const userId = req.user.userId;

    // Get comprehensive user statistics
    const ratingStats = await RatingService.getPlayerRatingStats(userId);

    // Get detailed game statistics by variant
    const variants = ["RAPID", "BLITZ", "BULLET"];
    const statsByVariant: any = {};

    for (const variant of variants) {
      const totalGames = await GameModel.countDocuments({
        "players.userId": userId,
        status: "completed",
        variant,
      });

      const wins = await GameModel.countDocuments({
        "players.userId": userId,
        status: "completed",
        variant,
        $or: [
          {
            "result.winner": "white",
            players: { $elemMatch: { userId, color: "white" } },
          },
          {
            "result.winner": "black",
            players: { $elemMatch: { userId, color: "black" } },
          },
        ],
      });

      const draws = await GameModel.countDocuments({
        "players.userId": userId,
        status: "completed",
        variant,
        "result.winner": null,
      });

      const losses = totalGames - wins - draws;

      // Get average game length
      const games = await GameModel.find({
        "players.userId": userId,
        status: "completed",
        variant,
      }).select("moves");

      const avgMoves =
        games.length > 0
          ? Math.round(
              games.reduce((sum, game) => sum + game.moves.length, 0) /
                games.length
            )
          : 0;

      statsByVariant[variant.toLowerCase()] = {
        totalGames,
        wins,
        draws,
        losses,
        winRate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
        avgMoves,
      };
    }

    // Get recent performance (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentGames = await GameModel.countDocuments({
      "players.userId": userId,
      status: "completed",
      endedAt: { $gte: thirtyDaysAgo },
    });

    const recentWins = await GameModel.countDocuments({
      "players.userId": userId,
      status: "completed",
      endedAt: { $gte: thirtyDaysAgo },
      $or: [
        {
          "result.winner": "white",
          players: { $elemMatch: { userId, color: "white" } },
        },
        {
          "result.winner": "black",
          players: { $elemMatch: { userId, color: "black" } },
        },
      ],
    });

    return APIResponse.success(res, "User statistics retrieved", {
      ratings: ratingStats,
      overall: statsByVariant,
      recentPerformance: {
        gamesLast30Days: recentGames,
        winsLast30Days: recentWins,
        winRateLast30Days:
          recentGames > 0 ? Math.round((recentWins / recentGames) * 100) : 0,
      },
    });
  }
);

export const updateUserProfile = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.unauthorized("Unauthorized");
    }

    const { bio, location, timezone, preferredTimeControl } = req.body;

    // Validate inputs
    if (bio && bio.length > 500) {
      throw APIError.badRequest("Bio must be less than 500 characters");
    }

    if (location && location.length > 100) {
      throw APIError.badRequest("Location must be less than 100 characters");
    }

    const updateData: any = {};
    if (bio !== undefined) updateData.bio = bio;
    if (location !== undefined) updateData.location = location;
    if (timezone !== undefined) updateData.timezone = timezone;
    if (preferredTimeControl !== undefined)
      updateData.preferredTimeControl = preferredTimeControl;

    const updatedProfile = await UserProfileModel.findOneAndUpdate(
      { userId: req.user.userId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedProfile) {
      throw APIError.notFound("User profile not found");
    }

    return APIResponse.success(res, "Profile updated successfully", {
      profile: updatedProfile,
    });
  }
);

export const getPublicUserProfile = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { userId } = req.params;

    if (!userId) {
      throw APIError.badRequest("User ID is required");
    }

    // Get user basic info
    const user = await UserModel.findById(userId).select("username createdAt");
    if (!user) {
      throw APIError.notFound("User not found");
    }

    // Get user profile
    const userProfile = await UserProfileModel.findOne({ userId }).select(
      "rating"
    );
    if (!userProfile) {
      throw APIError.notFound("User profile not found");
    }

    // Get public rating statistics (use the existing method)
    const publicRatingStats = await RatingService.getPlayerRatingStats(userId);

    // Get recent games (last 10 completed games, limited info)
    const recentGames = await GameModel.find({
      "players.userId": userId,
      status: "completed",
    })
      .sort({ endedAt: -1 })
      .limit(10)
      .populate("players.userId", "username")
      .select("variant timeControl result endedAt players");

    // Calculate basic game statistics
    const totalGames = await GameModel.countDocuments({
      "players.userId": userId,
      status: "completed",
    });

    const wins = await GameModel.countDocuments({
      "players.userId": userId,
      status: "completed",
      $or: [
        {
          "result.winner": "white",
          players: { $elemMatch: { userId, color: "white" } },
        },
        {
          "result.winner": "black",
          players: { $elemMatch: { userId, color: "black" } },
        },
      ],
    });

    const draws = await GameModel.countDocuments({
      "players.userId": userId,
      status: "completed",
      "result.winner": null,
    });

    return APIResponse.success(res, "Public user profile retrieved", {
      user: {
        id: user._id,
        username: user.username,
        memberSince: user.createdAt,
      },
      ratings: publicRatingStats,
      gameStats: {
        totalGames,
        wins,
        draws,
        losses: totalGames - wins - draws,
        winRate: totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0,
      },
      recentGames: recentGames.map((game: any) => ({
        gameId: game._id,
        variant: game.variant,
        timeControl: game.timeControl,
        result: game.result,
        endedAt: game.endedAt,
        opponent:
          game.players.find((p: any) => p.userId._id.toString() !== userId)
            ?.userId?.username || "Unknown",
        userColor: game.players.find(
          (p: any) => p.userId._id.toString() === userId
        )?.color,
      })),
    });
  }
);

// export const getPlayerInfo = asyncWrapper(
//   async (req: Request, res: Response, next: NextFunction) => {
//     const { playerId } = req.params;

//     if (!playerId) {
//       throw APIError.badRequest("PlayerId is required");
//     }

//     const user = await UserModel.findOne({ userId: playerId }).select(
//       "-_id username"
//     );
//     if (!user) {
//       throw APIError.notFound("User not found");
//     }

//     const userProfile = await UserProfileModel.findOne({
//       userId: playerId,
//     }).select("-_id userId bio location");

//     if (!userProfile) {
//       throw APIError.notFound("User profile not found");
//     }

//     const playerInfo: PlayerDTO = {
//       userId: user.userId,
//       username: user.username,
//       bio: userProfile.bio,
//       location: userProfile.location,
//     };

//     res.status(200).json({
//       playerInfo,
//     });
//   }
// );
