import redis from "../../config/redis";
import {
  GameHashDTO,
  MoveDTO,
  PlayerColor,
  PlayerDTO,
  GameInfoDTO,
  DEFAULT_FEN,
  getOppositeColor,
} from "../../types/game";
import APIError from "../../utils/APIError";

// Helper functions for Redis hash parsing
export const parseRedisHash = (
  data: Record<string, string>
): Record<string, any> => {
  const parsed: Record<string, any> = {};
  for (const key in data) {
    try {
      // Try to parse as JSON first
      parsed[key] = JSON.parse(data[key]);
    } catch {
      // If JSON parsing fails, keep as string
      parsed[key] = data[key];
    }
  }
  return parsed;
};

export const stringifyRedisHash = (
  data: Record<string, any>
): Record<string, string> => {
  const stringified: Record<string, string> = {};
  for (const key in data) {
    if (typeof data[key] === "string") {
      stringified[key] = data[key];
    } else {
      stringified[key] = JSON.stringify(data[key]);
    }
  }
  return stringified;
};

export const createGameHash = async (gameData: GameHashDTO): Promise<void> => {
  const hashData = {
    playerInfo: JSON.stringify(gameData.playerInfo),
    timeLeft: JSON.stringify(gameData.timeLeft),
    gameInfo: JSON.stringify(gameData.gameInfo),
    initialFen: gameData.initialFen,
    moves: JSON.stringify(gameData.moves),
    turn: gameData.turn,
    pgn: gameData.pgn,
    startedAt: gameData.startedAt.toString(),
    lastMovePlayedAt: gameData.lastMovePlayedAt.toString(),
  };

  await redis.hmset(gameData.gameId, hashData);
  await redis.expire(gameData.gameId, 7200);
};

export const addMoveToGameHash = async (
  gameId: string,
  move: MoveDTO,
  playedBy: PlayerColor
): Promise<void> => {
  const gameData = await redis.hgetall(gameId);
  if (!gameData || Object.keys(gameData).length === 0) {
    throw APIError.notFound("Game not found in Redis");
  }

  const currentTurn = gameData.turn as PlayerColor;
  if (playedBy !== currentTurn) {
    throw APIError.badRequest("It's not your turn");
  }

  // Parse current game state
  const moves: MoveDTO[] = JSON.parse(gameData.moves || "[]");
  const gameInfo: GameInfoDTO = JSON.parse(gameData.gameInfo);
  const timeLeft: { white: number; black: number } = JSON.parse(
    gameData.timeLeft
  );

  // Add the new move
  moves.push(move);

  // Calculate time deduction
  const increment = gameInfo.timeControl.increment * 1000; // convert to milliseconds
  const timeElapsed = Date.now() - Number(gameData.lastMovePlayedAt);
  const timeToDeduct = Math.max(0, timeElapsed - increment);

  // Update time for the player who just moved
  if (currentTurn === "white") {
    timeLeft.white = Math.max(0, timeLeft.white - timeToDeduct);
  } else {
    timeLeft.black = Math.max(0, timeLeft.black - timeToDeduct);
  }

  // Switch turns
  const newTurn = getOppositeColor(currentTurn);

  // Update Redis hash
  const updatedData = {
    moves: JSON.stringify(moves),
    timeLeft: JSON.stringify(timeLeft),
    turn: newTurn,
    lastMovePlayedAt: Date.now().toString(),
  };

  await redis.hmset(gameId, updatedData);
};

export const getGameHash = async (
  gameId: string
): Promise<GameHashDTO | null> => {
  const gameData = await redis.hgetall(gameId);
  if (!gameData || Object.keys(gameData).length === 0) {
    return null;
  }

  try {
    const parsed = parseRedisHash(gameData);

    const result: GameHashDTO = {
      gameId,
      playerInfo: parsed.playerInfo || [],
      timeLeft: parsed.timeLeft || { white: 0, black: 0 },
      gameInfo: parsed.gameInfo || {},
      initialFen: parsed.initialFen || DEFAULT_FEN,
      moves: parsed.moves || [],
      pgn: parsed.pgn || "",
      turn: parsed.turn || "white",
      startedAt: Number(parsed.startedAt) || Date.now(),
      lastMovePlayedAt: Number(parsed.lastMovePlayedAt) || Date.now(),
    };

    return result;
  } catch (error) {
    throw APIError.internal(
      `Failed to parse game hash for ${gameId}: ${error}`
    );
  }
};

export const deleteGameHash = async (gameId: string): Promise<void> => {
  await redis.del(gameId);
};

export const updateGameHash = async (
  gameId: string,
  updates: Partial<GameHashDTO>
): Promise<void> => {
  const updateData: Record<string, string> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (key === "gameId") continue; // Skip gameId as it's the key itself

    if (typeof value === "string" || typeof value === "number") {
      updateData[key] = value.toString();
    } else {
      updateData[key] = JSON.stringify(value);
    }
  }

  if (Object.keys(updateData).length > 0) {
    await redis.hmset(gameId, updateData);
  }
};
