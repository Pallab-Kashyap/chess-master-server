import { NextFunction, Request, Response } from "express";
import asyncWrapper from "../utils/asyncWrapper";
import APIError from "../utils/APIError";
import {
  addPlayerToQueue,
  getOpponentInRange,
  removePlayerFromQueue,
} from "../utils/redis/matchMakingQueue";
import { GAME_TYPE_KEYS, GAME_TYPES, GAME_VARIANTS } from "../constants";
import UserProfileModel from "../models/userProfile";
import GameModel from "../models/game";
import { getPlayerHash } from "../utils/redis/playerHash";

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


    const timeControl = getValidTimeControl(gameVariant, gameType)

    const userProfile = await UserProfileModel.findOne({
      userId: req.user?.userId,
    })
      .select(`rating`)

    const ratingValue = userProfile?.rating?.[gameVariant.toLowerCase()]

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
    } else {
      for (const opponent in opponents){
        const playerDetails = await getPlayerHash(opponent);
        if (!playerDetails) {
            await removePlayerFromQueue(gameType, opponent)
        }else{
            const game = await GameModel.create({
                players: [
                    {
                        userId: req.user?.userId,
                        color: 'white',
                        preRating: ratingValue,
                    },
                    {
                        userId: opponent,
                        color: 'black',
                        preRating: playerDetails.rating
                    }
                ]
            });

            break;
        }
      }

    }
  }
);
