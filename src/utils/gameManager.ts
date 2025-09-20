// import { getGameHash } from "../services/redis/gameHash";
// import { Move } from "../types/socketMessage";
// import { socketErrorMessage } from "./socketResponse";

// class GameManager {
//   static async handleMove({ gameId, move }: Move) {
//     if (!gameId || !move) {
//       return socketErrorMessage.send("gameId and move are required fields");
//     }

//     try {
//       const game = await getGameHash(gameId);
//     } catch (error) {
//       return socketErrorMessage.send(error);
//     }
//   }
// }
