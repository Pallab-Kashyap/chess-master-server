import { IGame, IMove, IPlayer } from "../models/game";
import { GameTimeControll, PLAYER_COLOR } from "../constants";

class Game {
    private id: string
    private players: IPlayer[]
    private started_at: Date
    private time_control: GameTimeControll
    private initial_PNG: string

    constructor(id: string , players: IPlayer[], time_control: GameTimeControll, started_at: Date, initail_PNG: string){
        this.id = id
        this.players = players
        this.time_control = time_control
        this.started_at = started_at
        this.initial_PNG = initail_PNG
    }
}
