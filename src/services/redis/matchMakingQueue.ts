import redis from "../../config/redis";

export const addPlayerToQueue = async (
  gameType: string,
  playerId: string,
  rating: number
) => {
  await redis.zadd(`match-making-queue:${gameType}`, rating, playerId);
};

export const removePlayerFromQueue = async (
  gameType: string,
  playerId: string
) => {
  await redis.zrem(`match-making-queue:${gameType}`, playerId);
};

export const getOpponentInRange = async (
  gameType: string,
  min: number,
  max: number
) => {
  return await redis.zrangebyscore(`match-making-queue:${gameType}`, min, max);
  // .then((list) => list.slice(list.length / 2, list.length / 2 + 1));
};

export const checkPlayerAvialabilityForGame = async (
  gameType: string,
  playerId: string
) => {
  const script = `
  local exists = redis.call("ZSCORE", KEYS[1], ARGV[1])
  if exists then
    redis.call("ZREM", KEYS[1], ARGV[1])
    return 1
  else
    return 0
  end
  `;

  return await redis.eval(
    script,
    1,
    `match-making-queue:${gameType}`,
    playerId
  );
};

// Non-destructive availability check - just checks if player is in queue
export const isPlayerInQueue = async (
  gameType: string,
  playerId: string
): Promise<boolean> => {
  const score = await redis.zscore(`match-making-queue:${gameType}`, playerId);
  return score !== null;
};
