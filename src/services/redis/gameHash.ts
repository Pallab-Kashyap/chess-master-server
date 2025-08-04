import redis from "../../config/redis";
import { TimeControl } from "../../constants";
import { IMove, IPlayer } from "../../models/game";
import APIError from "../../utils/APIError";

interface IGameHash {
  gameVariant: string;
  gameType: string;
  timeControl: TimeControl;
}

interface IPlayerHash extends IPlayer {
  isPlayerConnected: boolean;
}

export const createGameHash = async (
  gameId: string,
  wsRoomId: string,
  //   playerInfo: IPlayerHash,
  playerInfo: IPlayer,
  timeLeft: { white: number; black: number },
  gameInfo: IGameHash,
  initialFen: string = "",
  moves: IMove[] = [],
  turn: "white" | "black" = "white",
  startedAt: number = Date.now()
) => {
  await redis.hmset(gameId, {
    wsRoomId,
    playerInfo: JSON.stringify(playerInfo),
    timeLeft: JSON.stringify(timeLeft),
    gameInfo: JSON.stringify(gameInfo),
    initialFen,
    moves: JSON.stringify(moves),
    turn,
    startedAt: startedAt.toString(),
    lastMovePlayedAt: Date.now().toString(),
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
