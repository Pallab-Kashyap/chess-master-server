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
