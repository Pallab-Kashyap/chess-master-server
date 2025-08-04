import { NextFunction, Request, Response } from "express";
import asyncWrapper from "../utils/asyncWrapper";
import APIError from "../utils/APIError";
import {
  addPlayerToQueue,
  checkPlayerAvialabilityForGame,
  getOpponentInRange,
  removePlayerFromQueue,
} from "../services/redis/matchMakingQueue";
import {
  GAME_TYPE_KEYS,
  GAME_TYPES,
  GAME_VARIANTS,
  TimeControl,
} from "../constants";
import UserProfileModel from "../models/userProfile";
import GameModel from "../models/game";
import { createPlayerHash, getPlayerHash } from "../services/redis/playerHash";
import { createGameHash } from "../services/redis/gameHash";
import { generateToken } from "../utils/generateToken";
import APIResponse from "../utils/APIResponse";

export const getValidTimeControl = (
  variant: string,
  type: string
): { time: number; increment: number } => {
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
    const { gameVariant, gameType } = req.body;

    if (!gameType || gameType.length === 0) {
      throw APIError.badRequest("gameType is an required field");
    }

    const timeControl = getValidTimeControl(
      gameVariant,
      gameType
    ) as TimeControl;

    const userProfile = await UserProfileModel.findOne({
      userId: req.user?.userId,
    }).select(`rating`);

    const ratingValue = userProfile?.rating?.[gameVariant.toLowerCase()];

    if (typeof ratingValue !== "number") {
      throw APIError.internal("User rating not found or invalid");
    }

    const opponents = await getOpponentInRange(
      gameType,
      ratingValue - 60,
      ratingValue + 60
    );

    if (!opponents) {
      await addPlayerToQueue(gameType, req.user?.userId!, ratingValue);
      await createPlayerHash(req.user?.userId!, 'wsId', ratingValue)
      const token = generateToken({userId: req.user?.userId!})
      return APIResponse.success(res, "Searching for opponent", { wsToken: token })
    } else {
      for (const opponent in opponents) {
        const playerDetails = await getPlayerHash(opponent);
        if (!playerDetails) {
          await removePlayerFromQueue(gameType, opponent);
        } else {
          if (!checkPlayerAvialabilityForGame(gameType, opponent)) {
            await removePlayerFromQueue(gameType, opponent);
            continue;
          }
          const game = await GameModel.create({
            players: [
              {
                userId: req.user?.userId,
                color: "white",
                preRating: ratingValue,
              },
              {
                userId: opponent,
                color: "black",
                preRating: playerDetails.rating,
              },
            ],
            variant: gameVariant,
            timeControl,
          });

          if (!game) {
            throw APIError.internal("Failed to create game");
          }

          await createGameHash(game._id);

          break;
        }
      }
    }
  }
);
