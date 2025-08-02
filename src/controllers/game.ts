import { NextFunction, Request, Response } from "express";
import asyncWrapper from "../utils/asyncWrapper";
import UserModel from "../models/user";
import APIError from "../utils/APIError";
import redis from "../config/redis";

export const createGameRequest = asyncWrapper(async (req: Request, res: Response, next: NextFunction) => {
    const user = UserModel.findById(req.user?.userId);

    if(!user){
        throw APIError.badRequest("User not found")
    }

    redis.
})
