// Import TimeControl from centralized types
import { TimeControl } from "./types/game";

// export type GameTimeControll = {
//   [key in GameVariant]: GameTime[];
// };

// export const GAME_TIME_CONTROL_OPTIONS: GameTimeControll = {
//   [GameVariant.BULLET]: [
//     { time: 60, increment: 0 },
//     { time: 60, increment: 1 },
//     { time: 120, increment: 1 },
//   ],
//   [GameVariant.BLITZ]: [
//     { time: 180, increment: 0 },
//     { time: 180, increment: 2 },
//     { time: 300, increment: 0 },
//   ],
//   [GameVariant.RAPID]: [
//     { time: 600, increment: 0 },
//     { time: 900, increment: 10 },
//     { time: 1800, increment: 0 },
//   ],
// } as const;

export const enum SOCKET_MESSAGE_TYPE {
  SOCEKT_CONNECTION_HEALTH = "socket_connection_health",
  INIT = "init_game",
  FINDING_OPPONENT = "findin_opponent",
  START = "start_game",
  MOVE = "move",
  NOT_YOUR_TURN = "not_your_turn",
  CHAT = "chat_message",
  GAME_OVER = "game_over",
  REJOIN = "rejoin",
  RESIGN = "resign",
  OFFER_DRAW = "offer_draw",
  ACCEPT_DRAW = "accept_draw",
  DECLINE_DRAW = "decline_draw",
  OFFER_REMATCH = "offer_rematch",
  ACCEPT_REMATCH = "accept_rematch",
  OPPONENT_RECONNECTING = "opponent_reconnecting",
}

export const enum PLAYER_COLOR {
  WHITE = "white",
  BLACK = "black",
}

export enum RESULT_TYPES {
  CHECKMATE = "checkmate",
  RESIGN = "resignation",
  TIMEOUT = "timeout",
  STALEMATE = "stalemate",
  DRAW = "agreement",
  THREEFOLD = "threefold",
  INSUFFICIENT_MATERIAL = "insufficient_material",
  ON_GOING = "on_going",
}

export enum CLIENT_TYPE {
  PLAYER = "player",
  SPECTATOR = "spectator",
}

export const GAME_TYPES = {
  RAPID: {
    RAPID_10_0: { time: 600, increment: 0 },
    RAPID_15_10: { time: 900, increment: 10 },
    RAPID_30_0: { time: 1800, increment: 0 },
  },
  BLITZ: {
    BLITZ_3_0: { time: 180, increment: 0 },
    BLITZ_3_2: { time: 180, increment: 2 },
    BLITZ_5_0: { time: 300, increment: 0 },
  },
  BULLET: {
    BULLET_1_0: { time: 60, increment: 0 },
    BULLET_1_1: { time: 60, increment: 1 },
    BULLET_2_1: { time: 120, increment: 1 },
  },
} as const;

export enum GAME_VARIANTS {
  RAPID = "RAPID",
  BLITZ = "BLITZ",
  BULLET = "BULLET",
}

export type GAME_TYPE_KEYS = {
  [K in GAME_VARIANTS]: keyof (typeof GAME_TYPES)[K];
}[GAME_VARIANTS];
