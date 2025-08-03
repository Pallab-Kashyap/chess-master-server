import redis from "../../config/redis"


export const createPlayerHash = async (playerId: string, wsId: string, rating: number) => {
    await redis.hmset(`player:${playerId}`, 'wsId', wsId, 'rating', rating)
}

export const deletePlayerHash = async (playerId: string) => {
    await redis.del(`player:${playerId}`)
}

export const getPlayerHash = async (playerId: string) => {
    return await redis.hgetall(`player:${playerId}`)
}
