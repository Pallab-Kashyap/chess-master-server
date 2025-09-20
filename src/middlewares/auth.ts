import { NextFunction, Request, Response } from "express";
import asyncWrapper from "../utils/asyncWrapper";
import APIError from "../utils/APIError";
import { verifyToken } from "../utils/generateToken";

const auth = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw APIError.unauthorized("Authorization header is required");
    }

    const token = authHeader.split(" ")[1]; // Bearer <token>

    if (!token) {
      throw APIError.unauthorized("Token is required");
    }

    try {
      const decoded = verifyToken(token);
      req.user = decoded;
      next();
    } catch (error) {
      throw APIError.unauthorized("Invalid token");
    }
  }
);

export default auth;
