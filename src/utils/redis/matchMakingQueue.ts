import redis from "../../config/redis";

export const addPlayerToQueue = async (
  gameType: string,
  playerId: string,
  rating: number
) => {
  await redis.zadd(`match-making-queue:${gameType}`, rating, playerId);
};

export const removePlayerFromQueue = async (gameType: string, playerId: string) => {
  await redis.zrem(`match-making-queue:${gameType}`, playerId);
};

export const getOpponentInRange = async (
  gameType: string,
  min: number,
  max: number
) => {
  return await redis
    .zrangebyscore(`match-making-queue:${gameType}`, min, max)
    // .then((list) => list.slice(list.length / 2, list.length / 2 + 1));
};

