export enum GameSpeed {
  Bullet = "bullet",
  Blitz = "blitz",
  Rapid = "rapid",
}

type GameTime = { time: number; increment: number };

export type GameTimeControll = {
  [key in GameSpeed]: GameTime[];
};

export const GAME_TIME_CONTROL_OPTIONS: GameTimeControll = {
  [GameSpeed.Bullet]: [
    { time: 60, increment: 0 },
    { time: 120, increment: 1 },
  ],
  [GameSpeed.Blitz]: [
    { time: 180, increment: 0 },
    { time: 180, increment: 2 },
    { time: 300, increment: 0 },
  ],
  [GameSpeed.Rapid]: [
    { time: 600, increment: 0 },
    { time: 900, increment: 10 },
    { time: 1800, increment: 0 },
  ],
} as const;

export const enum SOCKET_MESSAGE_TYPE {
  INIT = "init_game",
  START = "start_game",
  MOVE = "move",
  CHAT = "chat_message",
  GAME_OVER = "game_over",
  REJOIN = "rejoin",
  RESIGN = "resign",
  OFFER_DRAW = "offer_draw",
  ACCEPT_DRAW = "accept_draw",
  DECLINE_DRAW = "decline_draw",
  OFFER_REMATCH = "offer_rematch",
  ACCEPT_REMATCH = "accept_rematch",
}

export const enum PLAYER_COLOR {
  WHITE = 'white',
  BLACK = 'black'
}

export enum RESULT_TYPES {
  CHECKMATE = "checkmate",
  RESIGN = "resignation",
  TIMEOUT = "timeout",
  STALEMATE = "stalemate",
  DRAW = "agreement",
  THREEFOLD = "threefold",
  INSUFFICIENT_MATERIAL = "insufficient_material",
  ON_GOING = "on_going"
}

export enum CLIENT_TYPE {
  PLAYER = 'player',
  SPECTATOR = 'spectator'
}

export enum QUEUE_TYPES {
  "RAPID-10-0" = "10/0",
  "RAPID-15-10" = "15/10",
  "RAPID-30-0" = "30/0",
  "BLITZ-3-0" = "3/0",
  "BLITZ-3-2" = "3/2",
  "BLITZ-5-0" = "5/0",
  "BULLET-1-0" = "1/0",
  "BULLET-1-1" = "1/1",
  "BULLET-2-1" = "2/1"
}
