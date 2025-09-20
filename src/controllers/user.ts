import asyncWrapper from "../utils/asyncWrapper";

import { Request, Response, NextFunction } from "express";
import APIError from "../utils/APIError";
import UserModel from "../models/user";
import UserProfileModel from "../models/userProfile";
import { UserPayload } from "../types/express";
import { createPlayerHash } from "../services/redis/playerHash";
import { PlayerDTO } from "../types/game";
import APIResponse from "../utils/APIResponse";

export const getUserProfile = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !req.user.userId) {
      throw APIError.unauthorized("Unauthorized");
    }

    const user = await UserModel.findOne({ userId: req.user.userId }).select(
      "-_id userId username email createdAt"
    );
    if (!user) {
      throw APIError.notFound("User not found");
    }

    const userProfile = await UserProfileModel.findOne({
      userId: req.user.userId,
    })

    if (!userProfile) {
      throw APIError.notFound("User profile not found");
    }

    return APIResponse.success(res, '', {user, userProfile})
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

    // const token = generateToken({ userId: newUser._id } as UserPayload);
    const token ='VX'


    // Create player hash in Redis
    return APIResponse.created(res, 'User registered successfully', token)
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
