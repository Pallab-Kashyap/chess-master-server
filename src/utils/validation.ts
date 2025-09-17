/**
 * Validation utilities for game-related data
 */

import {
  CreateGameRequest,
  SocketMoveMessage,
  PlayerColor,
  TimeControl,
} from "../types/game";
import { GAME_TYPES, GAME_VARIANTS } from "../constants";
import APIError from "./APIError";

// Validation functions
export const validateCreateGameRequest = (data: any): CreateGameRequest => {
  if (!data || typeof data !== "object") {
    throw APIError.badRequest("Invalid request data");
  }

  const { gameVariant, gameType } = data;

  if (!gameVariant || typeof gameVariant !== "string") {
    throw APIError.badRequest("gameVariant is required and must be a string");
  }

  if (!gameType || typeof gameType !== "string") {
    throw APIError.badRequest("gameType is required and must be a string");
  }

  // Validate that the variant exists
  if (!Object.keys(GAME_TYPES).includes(gameVariant)) {
    throw APIError.badRequest(`Invalid game variant: ${gameVariant}`);
  }

  // Validate that the type exists for the variant
  const variantObj = GAME_TYPES[gameVariant as GAME_VARIANTS];
  if (!variantObj || !(gameType in variantObj)) {
    throw APIError.badRequest(
      `Invalid game type '${gameType}' for variant '${gameVariant}'`
    );
  }

  return { gameVariant, gameType };
};

export const validateSocketMoveMessage = (data: any): SocketMoveMessage => {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid move data");
  }

  const { gameId, move, from, to } = data;

  if (!gameId || typeof gameId !== "string") {
    throw new Error("gameId is required and must be a string");
  }

  if (!move || typeof move !== "string") {
    throw new Error("move is required and must be a string");
  }

  // from and to are optional
  if (from && typeof from !== "string") {
    throw new Error("from must be a string if provided");
  }

  if (to && typeof to !== "string") {
    throw new Error("to must be a string if provided");
  }

  return { gameId, move, from, to };
};

export const validatePlayerColor = (color: any): PlayerColor => {
  if (color !== "white" && color !== "black") {
    throw new Error(
      `Invalid player color: ${color}. Must be 'white' or 'black'`
    );
  }
  return color;
};

export const validateTimeControl = (timeControl: any): TimeControl => {
  if (!timeControl || typeof timeControl !== "object") {
    throw new Error("Invalid time control data");
  }

  const { time, increment } = timeControl;

  if (typeof time !== "number" || time <= 0) {
    throw new Error("time must be a positive number");
  }

  if (typeof increment !== "number" || increment < 0) {
    throw new Error("increment must be a non-negative number");
  }

  return { time, increment };
};

// Helper function to sanitize and validate object IDs
export const validateObjectId = (id: any, fieldName: string = "id"): string => {
  if (!id) {
    throw new Error(`${fieldName} is required`);
  }

  if (typeof id !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  // Basic ObjectId format validation (24 character hex string)
  if (!/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new Error(`${fieldName} must be a valid ObjectId`);
  }

  return id;
};

// Helper to validate rating values
export const validateRating = (rating: any): number => {
  if (typeof rating !== "number") {
    throw new Error("Rating must be a number");
  }

  if (rating < 0 || rating > 4000) {
    throw new Error("Rating must be between 0 and 4000");
  }

  return rating;
};
