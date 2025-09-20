import { NextFunction, Request, Response } from "express";
import asyncWrapper from "../utils/asyncWrapper";
import APIError from "../utils/APIError";
import {
  PlayerDTO,
  GameInfoDTO,
  DEFAULT_FEN,
  timeControlToMs,
} from "../types/game";
import GameModel from "../models/game";
import { createGameHash } from "../services/redis/gameHash";
import APIResponse from "../utils/APIResponse";

// Development endpoint to create a test game with two specific users
export const createTestGame = asyncWrapper(
  async (req: Request, res: Response, next: NextFunction) => {
    const { player1Id, player2Id } = req.body;

    if (!player1Id || !player2Id) {
      throw APIError.badRequest("Both player1Id and player2Id are required");
    }

    if (player1Id === player2Id) {
      throw APIError.badRequest("Players cannot be the same");
    }

    try {
      const playerInfo: PlayerDTO[] = [
        {
          userId: player1Id,
          color: "white",
          preRating: 1200,
        },
        {
          userId: player2Id,
          color: "black",
          preRating: 1200,
        },
      ];

      const timeControl = { time: 600, increment: 0 }; // 10 minutes

      const game = await GameModel.create({
        players: playerInfo,
        variant: "RAPID",
        timeControl,
        pgn: "", // Explicitly set empty PGN
        moves: [], // Explicitly set empty moves
        initialFen: DEFAULT_FEN,
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
          gameVariant: "RAPID",
          gameType: "RAPID_10_0",
          timeControl,
        },
        initialFen: DEFAULT_FEN,
        moves: [],
        pgn: "",
        turn: "white",
        startedAt: Date.now(),
        lastMovePlayedAt: Date.now(),
      });

      return APIResponse.success(res, "Test game created successfully", {
        gameId: game.id,
        players: playerInfo,
        message: "Game ready for testing",
      });
    } catch (error) {
      throw APIError.internal(`Failed to create test game: ${error}`);
    }
  }
);
