import { Server } from "socket.io";

export class MessageHandler {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  createRoom(player1: string, player2: string, gameId: string){
    [player1, player2].forEach(player => {
       const socket = this.io.sockets.sockets.get(player)
       socket?.join(gameId)
    })
  }

  emitToRoom(roomId: string, event: string, data: any){
    this.io.to(roomId).emit(event, data)
  }

  emitToPlayer(socketId: string, event: string, data: any){
    this.io.to(socketId).emit(event, data);
  }

  deleteRoom(roomId: string){
    this.io.in(roomId).socketsLeave(roomId);
  }
}
