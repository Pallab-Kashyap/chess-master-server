import redis from "../../config/redis";
import { GAME_TYPE_KEYS, GAME_VARIANTS, TimeControl } from "../../constants";
import { IMove, IPlayer } from "../../models/game";
import APIError from "../../utils/APIError";

interface IGameInfo {
   gameVariant: GAME_VARIANTS,
   gameType: GAME_TYPE_KEYS,
   timeControl: TimeControl
}

interface IGameHash {
  gameId: string;
  wsRoomId: string;
  //   playerInfo: IPlayerHash,
  playerInfo: IPlayer;
  timeLeft: { white: number; black: number };
  gameInfo: IGameInfo;
  initialFen: string;
  moves: IMove[];
  pgn: string;
  turn: "white" | "black";
  startedAt: number;
  lastMovePlayedAt: number;
}

interface IPlayerHash extends IPlayer {
  isPlayerConnected: boolean;
}

//Helper

export const parseRedisHash = (data: Record<string, string>) => {
  const parsed: Record<string, any> = {};
  for (const key in data) {
    try {
      parsed[key] = JSON.parse(data[key]);
    } catch {
      parsed[key] = data[key];
    }
  }
  return parsed;
};

export const stringifyRedisHash = (data: Record<string, string>) => {
  const parsed: Record<string, any> = {};
  for (const key in data) {
    try {
      parsed[key] = JSON.stringify(data[key]);
    } catch {
      parsed[key] = data[key];
    }
  }
  return parsed;
};

export const createGameHash = async ({
  gameId,
  wsRoomId,
  //   playerInfo: IPlayerHash,
  playerInfo,
  timeLeft,
  gameInfo,
  initialFen,
  moves,
  pgn,
  turn,
  startedAt = Date.now(),
  lastMovePlayedAt = Date.now(),
}: IGameHash): Promise<void> => {
  await redis.hmset(gameId, {
    wsRoomId,
    playerInfo: JSON.stringify(playerInfo),
    timeLeft: JSON.stringify(timeLeft),
    gameInfo: JSON.stringify(gameInfo),
    initialFen,
    moves: JSON.stringify(moves),
    turn,
    pgn,
    startedAt: startedAt.toString(),
    lastMovePlayedAt: lastMovePlayedAt.toString(),
  });

  await redis.expire(gameId, 7200);
};

export const addMoveToGameHash = async (
  gameId: string,
  move: IMove,
  playedBy: "white" | "black"
) => {
  const game = await redis.hgetall(gameId);
  if (!game || Object.keys(game).length === 0) {
    // TODO: Try fetching from DB
    throw APIError.internal("Game not found");
  }

  if (playedBy !== game.turn) {
    throw APIError.badRequest("It's not your turn");
  }

  const moves = JSON.parse(game.moves);
  const gameInfo = JSON.parse(game.gameInfo);
  const timeLeft = JSON.parse(game.timeLeft);

  moves.push(move);

  const increment = Number(gameInfo.timeControl?.increment || 0);
  const timeToDeduct = Date.now() - Number(game.lastMovePlayedAt) + increment;

  let newTurn = game.turn === "white" ? "black" : "white";

  if (game.turn === "white") {
    timeLeft.white -= timeToDeduct;
  } else {
    timeLeft.black -= timeToDeduct;
  }

  return await redis.hset(gameId, {
    moves: JSON.stringify(moves),
    timeLeft: JSON.stringify(timeLeft),
    turn: newTurn,
    lastMovePlayedAt: Date.now().toString(),
  });
};

export const getGameHash = async (gameId: string): Promise<IGameHash> => {
  const game = await redis.hgetall(gameId);
  if (!game) {
    // TODO: trying fetching from DB
    throw new Error("game not found");
  }
  return parseRedisHash(game) as IGameHash;
};
