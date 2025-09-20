import { NextFunction, Request, Response } from "express";
import asyncWrapper from "../utils/asyncWrapper";
import APIError from "../utils/APIError";
import { GAME_TYPE_KEYS, GAME_TYPES, GAME_VARIANTS } from "../constants";
import {
  TimeControl,
  CreateGameRequest,
  CreateGameResponse,
  gameVariantToRatingKey,
  PlayerDTO,
  GameInfoDTO,
  DEFAULT_FEN,
  timeControlToMs,
} from "../types/game";
import { validateCreateGameRequest } from "../utils/validation";
import UserProfileModel from "../models/userProfile";
import GameModel from "../models/game";
import { createPlayerHash } from "../services/redis/playerHash";
import { createGameHash } from "../services/redis/gameHash";
import { generateToken } from "../utils/generateToken";
import APIResponse from "../utils/APIResponse";
import { DynamicMatchMaking } from "../services/matchmaking/DynamicMatchMaking";

export const getValidTimeControl = (
  variant: string,
  type: string
): TimeControl => {
  if (!Object.keys(GAME_TYPES).includes(variant)) {
    throw new Error("Invalid variant");
  }

  const variantObj = GAME_TYPES[variant as GAME_VARIANTS];
  if (!variantObj || !(type in variantObj)) {
    throw new Error("Invalid type for variant");
  }

  return variantObj[type as keyof typeof variantObj];
};

export const createGame = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.badRequest("UserId missing");
    }

    // Validate request body
    const { gameVariant, gameType } = validateCreateGameRequest(req.body);

    const timeControl = getValidTimeControl(gameVariant, gameType);

    const userProfile = await UserProfileModel.findOne({
      userId: req.user?.userId,
    }).select(`rating`);

    if (!userProfile) {
      throw APIError.internal("User profile not found");
    }

    const ratingKey = gameVariantToRatingKey(
      gameVariant
    ) as keyof typeof userProfile.rating;
    const ratingValue = userProfile?.rating?.[ratingKey];

    if (!ratingValue || typeof ratingValue !== "number") {
      throw APIError.internal("User rating not found or invalid");
    }

    // Create player hash for WebSocket connection tracking
    await createPlayerHash(req.user?.userId!, "wsId", ratingValue);

    // Generate WebSocket token
    const token = generateToken({ userId: req.user?.userId! });

    // Start dynamic matchmaking search
    // Note: The actual search will be handled via WebSocket events
    // This endpoint just sets up the initial state and returns the token

    return APIResponse.success(res, "Ready to start matchmaking", {
      wsToken: token,
      gameType: gameType,
      gameVariant: gameVariant,
      userRating: ratingValue,
      instructions:
        "Connect to WebSocket and use 'search_match' event to start searching",
    });
  }
);

export const startDynamicMatchmaking = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.badRequest("UserId missing");
    }

    // Validate request body
    const { gameVariant, gameType, socketId } = req.body;

    if (!socketId) {
      throw APIError.badRequest("Socket ID is required to start matchmaking");
    }

    const timeControl = getValidTimeControl(gameVariant, gameType);

    const userProfile = await UserProfileModel.findOne({
      userId: req.user?.userId,
    }).select(`rating`);

    if (!userProfile) {
      throw APIError.internal("User profile not found");
    }

    const ratingKey = gameVariantToRatingKey(
      gameVariant
    ) as keyof typeof userProfile.rating;
    const ratingValue = userProfile?.rating?.[ratingKey];

    if (!ratingValue || typeof ratingValue !== "number") {
      throw APIError.internal("User rating not found or invalid");
    }

    // Start the dynamic matchmaking search
    await DynamicMatchMaking.startSearch(
      req.user.userId,
      gameType,
      gameVariant,
      timeControl,
      ratingValue,
      socketId
    );

    return APIResponse.success(res, "Dynamic matchmaking started", {
      gameType,
      gameVariant,
      userRating: ratingValue,
      initialRange: 60,
      message: "Send 'search_match' events every 3 seconds via WebSocket",
    });
  }
);

export const getGameRatingChanges = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { gameId } = req.params;

    if (!gameId) {
      throw APIError.badRequest("Game ID is required");
    }

    const game = await GameModel.findById(gameId).select(
      "ratingChanges players"
    );
    if (!game) {
      throw APIError.notFound("Game not found");
    }

    if (!game.ratingChanges) {
      throw APIError.notFound("Rating changes not available for this game");
    }

    return APIResponse.success(res, "Game rating changes retrieved", {
      gameId,
      ratingChanges: game.ratingChanges,
      players: game.players.map((p) => ({
        userId: p.userId,
        color: p.color,
        currentRating: p.preRating,
      })),
    });
  }
);
