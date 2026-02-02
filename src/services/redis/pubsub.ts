import Redis from "ioredis";

const SERVER_ID = `server_${process.pid}_${Date.now()}`;

// Redis channels for different event types
export const PUBSUB_CHANNELS = {
  GAME_EVENTS: "chess:game:events",
  MOVE_EVENTS: "chess:game:moves",
  MATCHMAKING_EVENTS: "chess:matchmaking:events",
  TIME_EVENTS: "chess:game:time",
  PLAYER_EVENTS: "chess:player:events",
} as const;

// Event types that can be published
export enum GameEventType {
  // Game lifecycle events
  GAME_CREATED = "game_created",
  GAME_STARTED = "game_started",
  GAME_ENDED = "game_ended",
  GAME_ABANDONED = "game_abandoned",

  // Move events
  MOVE_MADE = "move_made",

  // Player action events
  PLAYER_RESIGNED = "player_resigned",
  DRAW_OFFERED = "draw_offered",
  DRAW_ACCEPTED = "draw_accepted",
  DRAW_DECLINED = "draw_declined",
  REMATCH_OFFERED = "rematch_offered",
  REMATCH_ACCEPTED = "rematch_accepted",
  REMATCH_DECLINED = "rematch_declined",

  // Time events
  TIME_UPDATE = "time_update",
  TIME_UP = "time_up",

  // Player connection events
  PLAYER_CONNECTED = "player_connected",
  PLAYER_DISCONNECTED = "player_disconnected",
  PLAYER_RECONNECTED = "player_reconnected",

  // Matchmaking events
  MATCH_FOUND = "match_found",
  SEARCH_CANCELLED = "search_cancelled",
}

// Base interface for all pub/sub messages
export interface PubSubMessage {
  serverId: string;
  timestamp: number;
  eventType: GameEventType;
  channel: string;
}

// Game event message
export interface GameEventMessage extends PubSubMessage {
  gameId: string;
  data: any;
  targetUserIds?: string[]; // Optional: specific users who should receive this event
}

// Move event message
export interface MoveEventMessage extends PubSubMessage {
  gameId: string;
  move: {
    san: string;
    from: string;
    to: string;
    promotion?: string;
  };
  fen: string;
  pgn: string;
  turn: "white" | "black";
  playerColor: "white" | "black";
  playerId: string;
  timeRemaining?: {
    white: number;
    black: number;
  };
  gameStatus?: {
    isGameOver: boolean;
    winner?: "white" | "black" | null;
    reason?: string;
    inCheck?: boolean;
  };
}

// Time event message
export interface TimeEventMessage extends PubSubMessage {
  gameId: string;
  whiteTime: number;
  blackTime: number;
  activePlayer: "white" | "black";
}

// Player event message
export interface PlayerEventMessage extends PubSubMessage {
  userId: string;
  gameId?: string;
  socketId?: string;
}

// Matchmaking event message
export interface MatchmakingEventMessage extends PubSubMessage {
  player1Id: string;
  player2Id: string;
  gameId: string;
  variant: string;
  timeControl: {
    initial: number;
    increment: number;
  };
}

// Type for event handlers
type EventHandler<T extends PubSubMessage> = (
  message: T,
) => void | Promise<void>;

class RedisPubSubService {
  private publisher: Redis;
  private subscriber: Redis;
  private isConnected: boolean = false;
  private eventHandlers: Map<string, Set<EventHandler<any>>> = new Map();
  private channelHandlers: Map<string, Set<EventHandler<any>>> = new Map();

  constructor() {
    // Create separate Redis connections for pub and sub
    // (Redis requires separate connections for pub/sub)
    this.publisher = new Redis({
      host: process.env.REDIS_HOST || "redis",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      retryStrategy: (times) => {
        if (times > 5) return null;
        return Math.min(times * 100, 2000);
      },
    });

    this.subscriber = new Redis({
      host: process.env.REDIS_HOST || "redis",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      retryStrategy: (times) => {
        if (times > 5) return null;
        return Math.min(times * 100, 2000);
      },
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.publisher.on("connect", () => {
      console.log(`📡 Redis PubSub Publisher connected [${SERVER_ID}]`);
    });

    this.subscriber.on("connect", () => {
      console.log(`📡 Redis PubSub Subscriber connected [${SERVER_ID}]`);
      this.isConnected = true;
    });

    this.publisher.on("error", (err) => {
      console.error("❌ Redis PubSub Publisher error:", err);
    });

    this.subscriber.on("error", (err) => {
      console.error("❌ Redis PubSub Subscriber error:", err);
    });

    // Handle incoming messages
    this.subscriber.on("message", (channel, message) => {
      this.handleMessage(channel, message);
    });
  }

  /**
   * Initialize the pub/sub service and subscribe to all channels
   */
  async initialize(): Promise<void> {
    try {
      // Subscribe to all channels
      const channels = Object.values(PUBSUB_CHANNELS);
      await this.subscriber.subscribe(...channels);
      console.log(`✅ Subscribed to channels: ${channels.join(", ")}`);
    } catch (error) {
      console.error("❌ Failed to initialize Redis PubSub:", error);
      throw error;
    }
  }

  /**
   * Handle incoming messages from Redis
   */
  private handleMessage(channel: string, rawMessage: string): void {
    try {
      const message: PubSubMessage = JSON.parse(rawMessage);

      // Skip messages from the same server instance
      if (message.serverId === SERVER_ID) {
        return;
      }

      console.log(
        `📨 Received event: ${message.eventType} on channel: ${channel} from server: ${message.serverId}`,
      );

      // Invoke channel-specific handlers
      const channelHandlerSet = this.channelHandlers.get(channel);
      if (channelHandlerSet) {
        channelHandlerSet.forEach((handler) => {
          try {
            handler(message);
          } catch (err) {
            console.error(`Error in channel handler for ${channel}:`, err);
          }
        });
      }

      // Invoke event-type-specific handlers
      const eventHandlerSet = this.eventHandlers.get(message.eventType);
      if (eventHandlerSet) {
        eventHandlerSet.forEach((handler) => {
          try {
            handler(message);
          } catch (err) {
            console.error(
              `Error in event handler for ${message.eventType}:`,
              err,
            );
          }
        });
      }
    } catch (error) {
      console.error("❌ Failed to parse PubSub message:", error);
    }
  }

  /**
   * Publish a message to a channel
   */
  async publish<T extends PubSubMessage>(
    channel: string,
    eventType: GameEventType,
    data: Omit<T, "serverId" | "timestamp" | "eventType" | "channel">,
  ): Promise<void> {
    const message: T = {
      ...data,
      serverId: SERVER_ID,
      timestamp: Date.now(),
      eventType,
      channel,
    } as T;

    try {
      await this.publisher.publish(channel, JSON.stringify(message));
      console.log(`📤 Published event: ${eventType} to channel: ${channel}`);
    } catch (error) {
      console.error(`❌ Failed to publish event ${eventType}:`, error);
      throw error;
    }
  }

  /**
   * Register a handler for a specific event type
   */
  onEvent<T extends PubSubMessage>(
    eventType: GameEventType,
    handler: EventHandler<T>,
  ): () => void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Register a handler for a specific channel
   */
  onChannel<T extends PubSubMessage>(
    channel: string,
    handler: EventHandler<T>,
  ): () => void {
    if (!this.channelHandlers.has(channel)) {
      this.channelHandlers.set(channel, new Set());
    }
    this.channelHandlers.get(channel)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.channelHandlers.get(channel)?.delete(handler);
    };
  }

  // ==================== Convenience Methods for Publishing ====================

  /**
   * Publish a game event
   */
  async publishGameEvent(
    eventType: GameEventType,
    gameId: string,
    data: any,
    targetUserIds?: string[],
  ): Promise<void> {
    await this.publish<GameEventMessage>(
      PUBSUB_CHANNELS.GAME_EVENTS,
      eventType,
      { gameId, data, targetUserIds },
    );
  }

  /**
   * Publish a move event
   */
  async publishMoveEvent(
    gameId: string,
    move: MoveEventMessage["move"],
    fen: string,
    pgn: string,
    turn: "white" | "black",
    playerColor: "white" | "black",
    playerId: string,
    timeRemaining?: MoveEventMessage["timeRemaining"],
    gameStatus?: MoveEventMessage["gameStatus"],
  ): Promise<void> {
    await this.publish<MoveEventMessage>(
      PUBSUB_CHANNELS.MOVE_EVENTS,
      GameEventType.MOVE_MADE,
      {
        gameId,
        move,
        fen,
        pgn,
        turn,
        playerColor,
        playerId,
        timeRemaining,
        gameStatus,
      },
    );
  }

  /**
   * Publish a time update event
   */
  async publishTimeEvent(
    eventType: GameEventType.TIME_UPDATE | GameEventType.TIME_UP,
    gameId: string,
    whiteTime: number,
    blackTime: number,
    activePlayer: "white" | "black",
  ): Promise<void> {
    await this.publish<TimeEventMessage>(
      PUBSUB_CHANNELS.TIME_EVENTS,
      eventType,
      { gameId, whiteTime, blackTime, activePlayer },
    );
  }

  /**
   * Publish a player event
   */
  async publishPlayerEvent(
    eventType: GameEventType,
    userId: string,
    gameId?: string,
    socketId?: string,
  ): Promise<void> {
    await this.publish<PlayerEventMessage>(
      PUBSUB_CHANNELS.PLAYER_EVENTS,
      eventType,
      { userId, gameId, socketId },
    );
  }

  /**
   * Publish a matchmaking event
   */
  async publishMatchmakingEvent(
    player1Id: string,
    player2Id: string,
    gameId: string,
    variant: string,
    timeControl: { initial: number; increment: number },
  ): Promise<void> {
    await this.publish<MatchmakingEventMessage>(
      PUBSUB_CHANNELS.MATCHMAKING_EVENTS,
      GameEventType.MATCH_FOUND,
      { player1Id, player2Id, gameId, variant, timeControl },
    );
  }

  /**
   * Get the server ID for this instance
   */
  getServerId(): string {
    return SERVER_ID;
  }

  /**
   * Check if the service is connected
   */
  isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Gracefully shutdown the pub/sub connections
   */
  async shutdown(): Promise<void> {
    try {
      await this.subscriber.unsubscribe();
      await this.subscriber.quit();
      await this.publisher.quit();
      console.log("✅ Redis PubSub connections closed");
    } catch (error) {
      console.error("❌ Error closing Redis PubSub connections:", error);
    }
  }
}

// Export singleton instance
export const redisPubSub = new RedisPubSubService();

export default redisPubSub;
