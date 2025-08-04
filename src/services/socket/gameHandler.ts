import { Server, Socket } from "socket.io";
import { MessageHandler } from "./messageHandler";
import { SOCKET_MESSAGE_TYPE } from "../../constants";
import { Move } from "../../types/socketMessage";

export const registerGameHandler = (io: Server, socket: Socket) => {
    const messageHandler = new MessageHandler(io)

    const handleMove = (data: Move) => {
        
    }

    socket.on(SOCKET_MESSAGE_TYPE.MOVE, () => {

    })
}
