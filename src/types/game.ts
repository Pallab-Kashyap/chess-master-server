/**
 * Centralized game-related types and interfaces
 * This file contains all domain types used across the application
 */

export type PlayerColor = "white" | "black";

export type GameStatus = "completed" | "on-going";

export type GameResult = "1-0" | "0-1" | "1/2-1/2";

export type Winner = "white" | "black" | null;

// Core game interfaces
export interface PlayerDTO {
  userId: string; // ObjectId as string for transport
  color: PlayerColor;
  preRating: number;
  postRating?: number | null;
}

export interface MoveDTO {
  move: string;
  from?: string;
  to?: string;
  timeStamp: number; // unix timestamp in milliseconds
}

export interface TimeControl {
  time: number; // base time in seconds
  increment: number; // increment in seconds
}

export interface ResultDTO {
  winner: Winner;
  reason?: string;
  score?: GameResult;
}

export interface GameInfoDTO {
  gameVariant: string;
  gameType: string;
  timeControl: TimeControl;
}

// Redis hash DTOs (for transport between Redis and application)
export interface GameHashDTO {
  gameId: string;
  playerInfo: PlayerDTO[];
  timeLeft: { white: number; black: number }; // time in milliseconds
  gameInfo: GameInfoDTO;
  initialFen: string;
  moves: MoveDTO[];
  pgn: string;
  turn: PlayerColor;
  startedAt: number; // unix timestamp
  lastMovePlayedAt: number; // unix timestamp
  // Game ending properties
  gameOver?: boolean;
  winner?: Winner;
  result?: GameResult;
  endReason?: string;
  endedAt?: number; // unix timestamp
  // Additional game state properties
  drawOffer?: {
    offeredBy: PlayerColor;
    timestamp: number;
  };
  gameStatus?: GameStatus;
}

export interface PlayerHashDTO {
  playerId: string;
  wsId?: string;
  rating: number;
  isPlayerConnected?: boolean;
}

// Game creation request/response types
export interface CreateGameRequest {
  gameVariant: string;
  gameType: string;
}

export interface CreateGameResponse {
  wsToken?: string;
  gameId?: string;
  message: string;
}

// Socket message types
export interface SocketMoveMessage {
  gameId: string;
  move: string;
  from?: string;
  to?: string;
}

export interface SocketGameStartMessage {
  gameId: string;
  players: PlayerDTO[];
  timeControl: TimeControl;
  gameInfo: GameInfoDTO;
}

// Utility types for validation
export interface ValidatedTimeControl {
  time: number;
  increment: number;
}

// Constants and mappings
export const DEFAULT_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Helper function to convert GAME_VARIANTS to rating keys
export const gameVariantToRatingKey = (variant: string): string => {
  return variant.toLowerCase();
};

// Helper function to convert time control from minutes to milliseconds
export const timeControlToMs = (
  timeControl: TimeControl
): { white: number; black: number } => {
  const timeInMs = timeControl.time * 1000; // convert seconds to milliseconds
  return {
    white: timeInMs,
    black: timeInMs,
  };
};

// Helper function to validate player color
export const isValidPlayerColor = (color: string): color is PlayerColor => {
  return color === "white" || color === "black";
};

// Helper function to get opposite color
export const getOppositeColor = (color: PlayerColor): PlayerColor => {
  return color === "white" ? "black" : "white";
};

// Model conversion utilities
// Convert Mongoose IPlayer to PlayerDTO
export const playerDocumentToDTO = (playerDoc: any): PlayerDTO => {
  return {
    userId: playerDoc.userId.toString(),
    color: playerDoc.color,
    preRating: playerDoc.preRating,
    postRating: playerDoc.postRating || null,
  };
};

// Convert Mongoose IMove to MoveDTO
export const moveDocumentToDTO = (moveDoc: any): MoveDTO => {
  return {
    move: moveDoc.move,
    from: moveDoc.from,
    to: moveDoc.to,
    timeStamp: moveDoc.timeStamp.getTime(),
  };
};

// Convert GameHashDTO to format suitable for creating Mongoose game
export const gameHashToGameDocument = (gameHash: GameHashDTO): any => {
  return {
    players: gameHash.playerInfo.map((player) => ({
      userId: player.userId,
      color: player.color,
      preRating: player.preRating,
      postRating: player.postRating || null,
    })),
    variant: gameHash.gameInfo.gameVariant,
    timeControl: gameHash.gameInfo.timeControl,
    initialFen: gameHash.initialFen,
    moves: gameHash.moves.map((move) => ({
      move: move.move,
      from: move.from,
      to: move.to,
      timeStamp: new Date(move.timeStamp),
    })),
    pgn: gameHash.pgn,
    startedAt: new Date(gameHash.startedAt),
  };
};

// Validation helper for rating keys
export const isValidRatingKey = (
  key: string
): key is "rapid" | "blitz" | "bullet" => {
  return ["rapid", "blitz", "bullet"].includes(key);
};
