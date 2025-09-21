import { PlayerColor, Winner } from "./game";
import { RESULT_TYPES } from "../constants";

export enum KAFKA_TOPICS {
  GAME_MOVES = "chess-game-moves",
  GAME_STATE_UPDATES = "chess-game-state-updates",
  GAME_EVENTS = "chess-game-events",
}

export enum GAME_EVENT_TYPES {
  GAME_STARTED = "GAME_STARTED",
  MOVE_MADE = "MOVE_MADE",
  GAME_ENDED = "GAME_ENDED",
  PLAYER_RESIGNED = "PLAYER_RESIGNED",
  DRAW_OFFERED = "DRAW_OFFERED",
  DRAW_ACCEPTED = "DRAW_ACCEPTED",
  REMATCH_OFFERED = "REMATCH_OFFERED",
  REMATCH_ACCEPTED = "REMATCH_ACCEPTED",
  TIME_UPDATE = "TIME_UPDATE",
  RATING_UPDATED = "RATING_UPDATED",
}

export interface GameStartedEvent {
  type: GAME_EVENT_TYPES.GAME_STARTED;
  gameId: string;
  players: {
    white: string;
    black: string;
  };
  timeControl: {
    time: number;
    increment: number;
  };
  initialFen: string;
  timestamp: number;
}

export interface MoveMadeEvent {
  type: GAME_EVENT_TYPES.MOVE_MADE;
  gameId: string;
  move: {
    move: string;
    from: string;
    to: string;
    piece: string;
    captured?: string;
    promotion?: string;
    san: string;
  };
  player: PlayerColor;
  fen: string;
  pgn: string;
  moveNumber: number;
  timeLeft: {
    white: number;
    black: number;
  };
  timestamp: number;
}

export interface GameEndedEvent {
  type: GAME_EVENT_TYPES.GAME_ENDED;
  gameId: string;
  result: {
    winner: Winner;
    reason: RESULT_TYPES;
  };
  finalFen: string;
  finalPgn: string;
  ratingChanges?: {
    whitePlayer: {
      userId: string;
      oldRating: number;
      newRating: number;
    };
    blackPlayer: {
      userId: string;
      oldRating: number;
      newRating: number;
    };
  };
  duration: number; // Game duration in milliseconds
  timestamp: number;
}

export interface PlayerResignedEvent {
  type: GAME_EVENT_TYPES.PLAYER_RESIGNED;
  gameId: string;
  resignedPlayer: PlayerColor;
  timestamp: number;
}

export interface DrawOfferedEvent {
  type: GAME_EVENT_TYPES.DRAW_OFFERED;
  gameId: string;
  offeredBy: PlayerColor;
  timestamp: number;
}

export interface DrawAcceptedEvent {
  type: GAME_EVENT_TYPES.DRAW_ACCEPTED;
  gameId: string;
  acceptedBy: PlayerColor;
  timestamp: number;
}

export interface TimeUpdateEvent {
  type: GAME_EVENT_TYPES.TIME_UPDATE;
  gameId: string;
  timeLeft: {
    white: number;
    black: number;
  };
  currentTurn: PlayerColor;
  timestamp: number;
}

export interface RematchOfferedEvent {
  type: GAME_EVENT_TYPES.REMATCH_OFFERED;
  gameId: string;
  offeredBy: string;
  opponentId: string;
  timestamp: number;
}

export interface RematchAcceptedEvent {
  type: GAME_EVENT_TYPES.REMATCH_ACCEPTED;
  gameId: string;
  originalGameId: string;
  acceptedBy: string;
  players: Array<{
    userId: string;
    color: PlayerColor;
    preRating: number;
  }>;
  timestamp: number;
}

export interface RatingUpdatedEvent {
  type: GAME_EVENT_TYPES.RATING_UPDATED;
  gameId: string;
  userId: string;
  oldRating: number;
  newRating: number;
  ratingChange: number;
  timestamp: number;
}

export type GameEvent =
  | GameStartedEvent
  | MoveMadeEvent
  | GameEndedEvent
  | PlayerResignedEvent
  | DrawOfferedEvent
  | DrawAcceptedEvent
  | RematchOfferedEvent
  | RematchAcceptedEvent
  | TimeUpdateEvent
  | RatingUpdatedEvent;
export interface KafkaMessage {
  gameId: string;
  event: GameEvent;
  priority: "HIGH" | "MEDIUM" | "LOW";
  retryCount?: number;
}
