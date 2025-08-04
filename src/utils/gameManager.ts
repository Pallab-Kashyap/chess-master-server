import { Move } from "../types/socketMessage"
import { socketErrorMessage } from "./socketResponse"

class GameManager {

    handleMove({gameId, move}: Move){
        if(!gameId || !move){
            return socketErrorMessage.send('gameId and move are required fields')
        }

        
    }
}
