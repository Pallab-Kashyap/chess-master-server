import redis from "../../config/redis";

const WAITING_PLAYER_SET_KEY = "waiting_player_set";

export const addPlayer = async (playerId: string, rating: number) => {
        await redis.zadd(WAITING_PLAYER_SET_KEY, rating, playerId)
}

export const removePlayer = async (playerId: string, rating: number) => {
  await redis.zrem(WAITING_PLAYER_SET_KEY, playerId);
};


export const getOpponentInRange = async (min: number, max: number) => {
  return await redis.zrangebyscore(WAITING_PLAYER_SET_KEY, min, max, "WITHSCORES", "LIMIT", 0, 1 );
};
