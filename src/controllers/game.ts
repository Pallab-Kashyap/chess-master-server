import { NextFunction, Request, Response } from "express";
import asyncWrapper from "../utils/asyncWrapper";
import APIError from "../utils/APIError";
import {
  addPlayerToQueue,
  checkPlayerAvialabilityForGame,
  getOpponentInRange,
  removePlayerFromQueue,
} from "../services/redis/matchMakingQueue";
import { GAME_TYPE_KEYS, GAME_TYPES, GAME_VARIANTS } from "../constants";
import {
  TimeControl,
  PlayerDTO,
  GameInfoDTO,
  CreateGameRequest,
  CreateGameResponse,
  DEFAULT_FEN,
  timeControlToMs,
  gameVariantToRatingKey,
} from "../types/game";
import { validateCreateGameRequest } from "../utils/validation";
import UserProfileModel from "../models/userProfile";
import GameModel from "../models/game";
import { createPlayerHash, getPlayerHash } from "../services/redis/playerHash";
import { createGameHash } from "../services/redis/gameHash";
import { generateToken } from "../utils/generateToken";
import APIResponse from "../utils/APIResponse";

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

    const opponents = await getOpponentInRange(
      gameType,
      ratingValue - 60,
      ratingValue + 60
    );

    if (!opponents) {
      await addPlayerToQueue(gameType, req.user?.userId!, ratingValue);
      await createPlayerHash(req.user?.userId!, "wsId", ratingValue);
      const token = generateToken({ userId: req.user?.userId! });
      return APIResponse.success(res, "Searching for opponent", {
        wsToken: token,
      });
    } else {
      for (const opponent in opponents) {
        const opponentDetails = await getPlayerHash(opponent);
        if (!opponentDetails) {
          await removePlayerFromQueue(gameType, opponent);
        } else {
          if (!checkPlayerAvialabilityForGame(gameType, opponent)) {
            await removePlayerFromQueue(gameType, opponent);
            continue;
          }

          const playerInfo: PlayerDTO[] = [
            {
              userId: req.user?.userId!,
              color: "white",
              preRating: ratingValue,
            },
            {
              userId: opponent,
              color: "black",
              preRating: opponentDetails.rating,
            },
          ];

          const game = await GameModel.create({
            players: playerInfo,
            variant: gameVariant,
            timeControl,
          });

          if (!game) {
            throw APIError.internal("Failed to create game");
          }

          const gameTimeLeft = timeControlToMs(timeControl);

          await createGameHash({
            gameId: game.id,
            playerInfo,
            timeLeft: gameTimeLeft,
            gameInfo: {
              gameVariant: gameVariant,
              gameType: gameType,
              timeControl,
            },
            initialFen: DEFAULT_FEN,
            moves: [],
            pgn: "",
            turn: "white",
            startedAt: Date.now(),
            lastMovePlayedAt: Date.now(),
          });

          // Remove both players from the queue
          await removePlayerFromQueue(gameType, req.user?.userId!);
          await removePlayerFromQueue(gameType, opponent);

          const response: CreateGameResponse = {
            gameId: game.id,
            message: "Game created successfully",
          };

          return APIResponse.success(
            res,
            "Game created successfully",
            response
          );
        }
      }

      // If we reach here, no suitable opponent was found after checking all
      await addPlayerToQueue(gameType, req.user?.userId!, ratingValue);
      await createPlayerHash(req.user?.userId!, "wsId", ratingValue);
      const token = generateToken({ userId: req.user?.userId! });
      return APIResponse.success(
        res,
        "No suitable opponent found, added to queue",
        { wsToken: token }
      );
    }
  }
);
