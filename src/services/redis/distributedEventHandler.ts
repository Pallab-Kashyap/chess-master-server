import { Server } from "socket.io";
import redisPubSub, {
  GameEventType,
  GameEventMessage,
  MoveEventMessage,
  TimeEventMessage,
  PlayerEventMessage,
  MatchmakingEventMessage,
  PUBSUB_CHANNELS,
} from "../redis/pubsub";
import { SOCKET_MESSAGE_TYPE } from "../../constants";
import { socketSuccessMessage } from "../../utils/socketResponse";
import { getSocketId } from "../redis/playerHash";

class DistributedEventHandler {
  private io: Server | null = null;
  private initialized: boolean = false;

  /**
   * Initialize the distributed event handler with Socket.IO instance
   */
  initialize(io: Server): void {
    if (this.initialized) {
      console.warn("⚠️ DistributedEventHandler already initialized");
      return;
    }

    this.io = io;
    this.registerEventHandlers();
    this.initialized = true;
    console.log("✅ DistributedEventHandler initialized");
  }

  /**
   * Register handlers for all pub/sub events
   */
  private registerEventHandlers(): void {
    // Move events
    redisPubSub.onEvent<MoveEventMessage>(
      GameEventType.MOVE_MADE,
      this.handleMoveEvent.bind(this),
    );

    // Game lifecycle events
    redisPubSub.onEvent<GameEventMessage>(
      GameEventType.GAME_STARTED,
      this.handleGameStarted.bind(this),
    );

    redisPubSub.onEvent<GameEventMessage>(
      GameEventType.GAME_ENDED,
      this.handleGameEnded.bind(this),
    );

    // Player action events
    redisPubSub.onEvent<GameEventMessage>(
      GameEventType.PLAYER_RESIGNED,
      this.handlePlayerResigned.bind(this),
    );

    redisPubSub.onEvent<GameEventMessage>(
      GameEventType.DRAW_OFFERED,
      this.handleDrawOffered.bind(this),
    );

    redisPubSub.onEvent<GameEventMessage>(
      GameEventType.DRAW_ACCEPTED,
      this.handleDrawAccepted.bind(this),
    );

    redisPubSub.onEvent<GameEventMessage>(
      GameEventType.DRAW_DECLINED,
      this.handleDrawDeclined.bind(this),
    );

    redisPubSub.onEvent<GameEventMessage>(
      GameEventType.REMATCH_OFFERED,
      this.handleRematchOffered.bind(this),
    );

    redisPubSub.onEvent<GameEventMessage>(
      GameEventType.REMATCH_ACCEPTED,
      this.handleRematchAccepted.bind(this),
    );

    // Time events
    redisPubSub.onEvent<TimeEventMessage>(
      GameEventType.TIME_UPDATE,
      this.handleTimeUpdate.bind(this),
    );

    redisPubSub.onEvent<TimeEventMessage>(
      GameEventType.TIME_UP,
      this.handleTimeUp.bind(this),
    );

    // Player connection events
    redisPubSub.onEvent<PlayerEventMessage>(
      GameEventType.PLAYER_DISCONNECTED,
      this.handlePlayerDisconnected.bind(this),
    );

    redisPubSub.onEvent<PlayerEventMessage>(
      GameEventType.PLAYER_RECONNECTED,
      this.handlePlayerReconnected.bind(this),
    );

    // Matchmaking events
    redisPubSub.onEvent<MatchmakingEventMessage>(
      GameEventType.MATCH_FOUND,
      this.handleMatchFound.bind(this),
    );

    console.log("✅ Registered all distributed event handlers");
  }

  /**
   * Emit event to a game room
   */
  private emitToRoom(roomId: string, event: string, data: any): void {
    if (!this.io) {
      console.error("❌ Socket.IO not initialized");
      return;
    }
    this.io.to(roomId).emit(event, data);
  }

  /**
   * Emit event to a specific socket
   */
  private async emitToUser(
    userId: string,
    event: string,
    data: any,
  ): Promise<void> {
    if (!this.io) {
      console.error("❌ Socket.IO not initialized");
      return;
    }

    try {
      const socketId = await getSocketId(userId);
      if (socketId) {
        this.io.to(socketId).emit(event, data);
      }
    } catch (error) {
      console.error(`❌ Failed to emit to user ${userId}:`, error);
    }
  }

  // ==================== Event Handlers ====================

  /**
   * Handle move events from other servers
   */
  private handleMoveEvent(message: MoveEventMessage): void {
    console.log(`📥 [Distributed] Move received for game ${message.gameId}`);

    const responseData = {
      move: message.move,
      fen: message.fen,
      pgn: message.pgn,
      turn: message.turn,
      timeRemaining: message.timeRemaining,
      inCheck: message.gameStatus?.inCheck || false,
    };

    // Check if game is over
    if (message.gameStatus?.isGameOver) {
      this.emitToRoom(
        message.gameId,
        SOCKET_MESSAGE_TYPE.GAME_OVER,
        socketSuccessMessage.send(
          {
            ...responseData,
            result: message.gameStatus.winner ? "1-0" : "0-1",
            winner: message.gameStatus.winner,
            reason: message.gameStatus.reason,
          },
          `Game Over: ${message.gameStatus.reason}`,
        ),
      );
    } else {
      this.emitToRoom(
        message.gameId,
        SOCKET_MESSAGE_TYPE.MOVE,
        socketSuccessMessage.send(responseData, "Move processed"),
      );
    }
  }

  /**
   * Handle game started events
   */
  private handleGameStarted(message: GameEventMessage): void {
    console.log(`📥 [Distributed] Game started: ${message.gameId}`);

    this.emitToRoom(
      message.gameId,
      SOCKET_MESSAGE_TYPE.START,
      socketSuccessMessage.send(message.data, "Game started"),
    );
  }

  /**
   * Handle game ended events
   */
  private handleGameEnded(message: GameEventMessage): void {
    console.log(`📥 [Distributed] Game ended: ${message.gameId}`);

    this.emitToRoom(
      message.gameId,
      SOCKET_MESSAGE_TYPE.GAME_OVER,
      socketSuccessMessage.send(message.data, "Game ended"),
    );
  }

  /**
   * Handle player resignation events
   */
  private handlePlayerResigned(message: GameEventMessage): void {
    console.log(`📥 [Distributed] Player resigned in game ${message.gameId}`);

    this.emitToRoom(
      message.gameId,
      SOCKET_MESSAGE_TYPE.GAME_OVER,
      socketSuccessMessage.send(
        {
          winner: message.data.winner,
          reason: "resignation",
          resignedPlayer: message.data.resignedPlayer,
        },
        `${message.data.resignedPlayer} resigned`,
      ),
    );
  }

  /**
   * Handle draw offer events
   */
  private handleDrawOffered(message: GameEventMessage): void {
    console.log(`📥 [Distributed] Draw offered in game ${message.gameId}`);

    this.emitToRoom(
      message.gameId,
      SOCKET_MESSAGE_TYPE.OFFER_DRAW,
      socketSuccessMessage.send(
        { offeredBy: message.data.offeredBy },
        "Draw offered",
      ),
    );
  }

  /**
   * Handle draw accepted events
   */
  private handleDrawAccepted(message: GameEventMessage): void {
    console.log(`📥 [Distributed] Draw accepted in game ${message.gameId}`);

    this.emitToRoom(
      message.gameId,
      SOCKET_MESSAGE_TYPE.GAME_OVER,
      socketSuccessMessage.send(
        {
          winner: null,
          reason: "agreement",
          result: "1/2-1/2",
        },
        "Draw accepted",
      ),
    );
  }

  /**
   * Handle draw declined events
   */
  private handleDrawDeclined(message: GameEventMessage): void {
    console.log(`📥 [Distributed] Draw declined in game ${message.gameId}`);

    this.emitToRoom(
      message.gameId,
      SOCKET_MESSAGE_TYPE.DECLINE_DRAW,
      socketSuccessMessage.send(
        { declinedBy: message.data.declinedBy },
        "Draw declined",
      ),
    );
  }

  /**
   * Handle rematch offer events
   */
  private handleRematchOffered(message: GameEventMessage): void {
    console.log(`📥 [Distributed] Rematch offered for game ${message.gameId}`);

    this.emitToRoom(
      message.gameId,
      SOCKET_MESSAGE_TYPE.OFFER_REMATCH,
      socketSuccessMessage.send(
        { offeredBy: message.data.offeredBy },
        "Rematch offered",
      ),
    );
  }

  /**
   * Handle rematch accepted events
   */
  private handleRematchAccepted(message: GameEventMessage): void {
    console.log(`📥 [Distributed] Rematch accepted for game ${message.gameId}`);

    this.emitToRoom(
      message.gameId,
      SOCKET_MESSAGE_TYPE.ACCEPT_REMATCH,
      socketSuccessMessage.send(
        {
          newGameId: message.data.newGameId,
          colorsSwapped: message.data.colorsSwapped,
        },
        "Rematch accepted",
      ),
    );
  }

  /**
   * Handle time update events
   */
  private handleTimeUpdate(message: TimeEventMessage): void {
    this.emitToRoom(
      message.gameId,
      SOCKET_MESSAGE_TYPE.TIME_UPDATE,
      socketSuccessMessage.send({
        whiteTime: message.whiteTime,
        blackTime: message.blackTime,
        activePlayer: message.activePlayer,
      }),
    );
  }

  /**
   * Handle time up events
   */
  private handleTimeUp(message: TimeEventMessage): void {
    console.log(`📥 [Distributed] Time up in game ${message.gameId}`);

    const loser = message.whiteTime <= 0 ? "white" : "black";
    const winner = loser === "white" ? "black" : "white";

    this.emitToRoom(
      message.gameId,
      SOCKET_MESSAGE_TYPE.GAME_OVER,
      socketSuccessMessage.send(
        {
          winner,
          reason: "timeout",
          result: winner === "white" ? "1-0" : "0-1",
        },
        `${loser} ran out of time`,
      ),
    );
  }

  /**
   * Handle player disconnected events
   */
  private handlePlayerDisconnected(message: PlayerEventMessage): void {
    console.log(
      `📥 [Distributed] Player ${message.userId} disconnected from game ${message.gameId}`,
    );

    if (message.gameId) {
      this.emitToRoom(
        message.gameId,
        SOCKET_MESSAGE_TYPE.OPPONENT_RECONNECTING,
        socketSuccessMessage.send(
          { userId: message.userId },
          "Opponent disconnected",
        ),
      );
    }
  }

  /**
   * Handle player reconnected events
   */
  private handlePlayerReconnected(message: PlayerEventMessage): void {
    console.log(
      `📥 [Distributed] Player ${message.userId} reconnected to game ${message.gameId}`,
    );

    if (message.gameId) {
      this.emitToRoom(
        message.gameId,
        SOCKET_MESSAGE_TYPE.REJOIN,
        socketSuccessMessage.send(
          { userId: message.userId },
          "Opponent reconnected",
        ),
      );
    }
  }

  /**
   * Handle match found events
   */
  private async handleMatchFound(
    message: MatchmakingEventMessage,
  ): Promise<void> {
    console.log(
      `📥 [Distributed] Match found: ${message.player1Id} vs ${message.player2Id}`,
    );

    const matchData = {
      gameId: message.gameId,
      variant: message.variant,
      timeControl: message.timeControl,
    };

    // Notify both players
    await this.emitToUser(
      message.player1Id,
      SOCKET_MESSAGE_TYPE.START,
      socketSuccessMessage.send(matchData, "Match found!"),
    );

    await this.emitToUser(
      message.player2Id,
      SOCKET_MESSAGE_TYPE.START,
      socketSuccessMessage.send(matchData, "Match found!"),
    );
  }
}

// Export singleton instance
export const distributedEventHandler = new DistributedEventHandler();

export default distributedEventHandler;
