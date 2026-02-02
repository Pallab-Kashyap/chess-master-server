import redis from "../../config/redis";
import { PlayerHashDTO } from "../../types/game";

export const createPlayerHash = async (
  playerId: string,
  wsId: string,
  rating: number,
): Promise<void> => {
  await redis.hmset(`player:${playerId}`, {
    playerId,
    wsId,
    rating: rating.toString(),
    isPlayerConnected: "false",
  });
};

export const deletePlayerHash = async (playerId: string): Promise<void> => {
  await redis.del(`player:${playerId}`);
};

export const getPlayerHash = async (
  playerId: string,
): Promise<PlayerHashDTO | null> => {
  const playerHash = await redis.hgetall(`player:${playerId}`);

  if (!playerHash || Object.keys(playerHash).length === 0) {
    return null; // player not found in Redis
  }

  const result: PlayerHashDTO = {
    playerId: playerHash.playerId || playerId, // ensure playerId is always present
    wsId: playerHash.wsId || undefined,
    rating: Number(playerHash.rating) || 0,
    isPlayerConnected: playerHash.isPlayerConnected === "true",
  };

  return result;
};

export const updateSocketId = async (
  playerId: string,
  wsId: string,
): Promise<void> => {
  await redis.hmset(`player:${playerId}`, {
    wsId,
    isPlayerConnected: "true",
  });
};

export const updatePlayerConnectionStatus = async (
  playerId: string,
  isConnected: boolean,
): Promise<void> => {
  await redis.hmset(`player:${playerId}`, {
    isPlayerConnected: isConnected.toString(),
  });
};

export const getSocketId = async (playerId: string): Promise<string | null> => {
  const socketId = await redis.hget(`player:${playerId}`, "wsId");
  return socketId || null;
};
