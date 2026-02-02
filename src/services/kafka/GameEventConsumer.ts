import { Consumer } from "kafkajs";
import KafkaManager from "../../config/kafka";
import { KAFKA_TOPICS, GAME_EVENT_TYPES } from "../../types/kafka";
import GameModel from "../../models/game";
import { RatingService } from "../rating/RatingService";

export class GameEventConsumer {
  private consumer: Consumer | null = null;
  private kafkaManager: KafkaManager;
  private isRunning = false;

  constructor() {
    this.kafkaManager = KafkaManager.getInstance();
  }

  /**
   * Initialize the consumer
   */
  async initialize(): Promise<void> {
    try {
      this.consumer = await this.kafkaManager.getConsumer(
        "chess-game-events-group"
      );

      if (!this.consumer) {
        console.log(
          "⚠️  Kafka consumer initialization skipped - Kafka disabled"
        );
        return;
      }

      // Subscribe to all game event topics
      await this.consumer.subscribe({
        topics: [
          KAFKA_TOPICS.GAME_EVENTS,
          KAFKA_TOPICS.GAME_MOVES,
          KAFKA_TOPICS.GAME_STATE_UPDATES,
        ],
        fromBeginning: false,
      });

      console.log(
        "✅ Game event consumer initialized and subscribed to topics"
      );
    } catch (error) {
      console.error("❌ Failed to initialize game event consumer:", error);
      throw error;
    }
  }

  /**
   * Start consuming messages
   */
  async startConsuming(): Promise<void> {
    if (!this.consumer) {
      console.log("⚠️  Consumer not initialized, skipping consumption");
      return;
    }

    try {
      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            const eventData = JSON.parse(message.value?.toString() || "{}");
            await this.processGameEvent(topic, eventData);
          } catch (error) {
            console.error(`❌ Error processing message from ${topic}:`, error);
          }
        },
      });

      this.isRunning = true;
      console.log("🏃 Game event consumer started");
    } catch (error) {
      console.error("❌ Failed to start game event consumer:", error);
      throw error;
    }
  }

  /**
   * Process individual game events
   */
  private async processGameEvent(topic: string, eventData: any): Promise<void> {
    try {
      console.log(
        `📥 Processing event from ${topic}:`,
        eventData.eventType || eventData.type
      );

      // Add custom processing logic here based on event type
      switch (topic) {
        case KAFKA_TOPICS.GAME_EVENTS:
          await this.handleGameEvent(eventData);
          break;
        case KAFKA_TOPICS.GAME_MOVES:
          await this.handleMoveEvent(eventData);
          break;
        case KAFKA_TOPICS.GAME_STATE_UPDATES:
          await this.handleStateUpdate(eventData);
          break;
        default:
          console.log(`📝 Unknown topic: ${topic}`);
      }
    } catch (error) {
      console.error(`❌ Error processing game event from ${topic}:`, error);
    }
  }

  /**
   * Handle game lifecycle events
   */
  private async handleGameEvent(eventData: any): Promise<void> {
    try {
      console.log(
        `🎮 Processing game event: ${eventData.event?.type}`,
        eventData.gameId
      );

      const { gameId, event } = eventData;

      switch (event?.type) {
        case GAME_EVENT_TYPES.GAME_STARTED:
          await this.handleGameStarted(gameId, event);
          break;
        case GAME_EVENT_TYPES.GAME_ENDED:
          await this.handleGameEnded(gameId, event);
          break;
        case GAME_EVENT_TYPES.PLAYER_RESIGNED:
          await this.handlePlayerResigned(gameId, event);
          break;
        case GAME_EVENT_TYPES.DRAW_ACCEPTED:
          await this.handleDrawAccepted(gameId, event);
          break;
        default:
          console.log(`🎮 Unhandled game event: ${event?.type}`);
      }
    } catch (error) {
      console.error(`❌ Error handling game event:`, error);
    }
  }

  /**
   * Handle move events
   */
  private async handleMoveEvent(eventData: any): Promise<void> {
    try {
      console.log(`♟️  Processing move event for game: ${eventData.gameId}`);

      const { gameId, event } = eventData;

      if (event?.type === GAME_EVENT_TYPES.MOVE_MADE) {
        await this.handleMoveMade(gameId, event);
      }
    } catch (error) {
      console.error(`❌ Error handling move event:`, error);
    }
  }

  /**
   * Handle game state updates
   */
  private async handleStateUpdate(eventData: any): Promise<void> {
    // Process state updates
    console.log(`🔄 State update for game: ${eventData.gameId}`);
  }

  /**
   * Stop consuming messages
   */
  async stopConsuming(): Promise<void> {
    if (this.consumer) {
      try {
        await this.consumer.disconnect();
        this.isRunning = false;
        console.log("🛑 Game event consumer stopped");
      } catch (error) {
        console.error("❌ Error stopping game event consumer:", error);
      }
    }
  }

  /**
   * Check if consumer is running
   */
  isConsumerRunning(): boolean {
    return this.isRunning;
  }

  // Specific event handlers

  /**
   * Handle game started event
   */
  private async handleGameStarted(gameId: string, event: any): Promise<void> {
    console.log(`🆕 Game started: ${gameId}`);
    // Game is already created in database during matchmaking
    // We could update additional metadata here if needed
  }

  /**
   * Handle game ended event
   */
  private async handleGameEnded(gameId: string, event: any): Promise<void> {
    try {
      console.log(
        `🏁 Game ended: ${gameId}, result: ${event.result?.winner || "draw"}`
      );

      // Update the game in database with final result
      await GameModel.findByIdAndUpdate(gameId, {
        status: "completed",
        result: {
          winner: event.result?.winner || null,
          reason: event.result?.reason || "unknown",
          method: event.result?.reason || "game_ended",
        },
        endedAt: new Date(event.timestamp),
        pgn: event.finalPgn,
        finalFen: event.finalFen,
      });

      console.log(
        `✅ Game ${gameId} saved with result: ${event.result?.winner || "draw"}`
      );
    } catch (error) {
      console.error(`❌ Error saving game end for ${gameId}:`, error);
    }
  }

  /**
   * Handle player resignation
   */
  private async handlePlayerResigned(
    gameId: string,
    event: any
  ): Promise<void> {
    try {
      console.log(
        `🏳️ Player resigned in game: ${gameId}, player: ${event.resignedPlayer}`
      );

      const winner = event.resignedPlayer === "white" ? "black" : "white";

      await GameModel.findByIdAndUpdate(gameId, {
        status: "completed",
        result: {
          winner: winner,
          reason: "resignation",
          method: "resignation",
        },
        endedAt: new Date(event.timestamp),
      });

      console.log(
        `✅ Resignation processed for game ${gameId}, winner: ${winner}`
      );
    } catch (error) {
      console.error(`❌ Error processing resignation for ${gameId}:`, error);
    }
  }

  /**
   * Handle draw accepted
   */
  private async handleDrawAccepted(gameId: string, event: any): Promise<void> {
    try {
      console.log(`🤝 Draw accepted in game: ${gameId}`);

      await GameModel.findByIdAndUpdate(gameId, {
        status: "completed",
        result: {
          winner: null,
          reason: "agreement",
          method: "draw_agreement",
        },
        endedAt: new Date(event.timestamp),
      });

      console.log(`✅ Draw processed for game ${gameId}`);
    } catch (error) {
      console.error(`❌ Error processing draw for ${gameId}:`, error);
    }
  }

  /**
   * Handle move made event
   */
  private async handleMoveMade(gameId: string, event: any): Promise<void> {
    try {
      console.log(
        `♟️ Move made in game: ${gameId}, move: ${event.move?.san}, player: ${event.player}`
      );

      // Add move to the game's moves array and update PGN
      const moveData = {
        move: event.move?.san || event.move?.move,
        from: event.move?.from,
        to: event.move?.to,
        timeStamp: event.timestamp,
        player: event.player,
      };

      await GameModel.findByIdAndUpdate(gameId, {
        $push: { moves: moveData },
        pgn: event.pgn,
        currentFen: event.fen,
        lastMoveAt: new Date(event.timestamp),
      });

      console.log(`✅ Move saved for game ${gameId}: ${event.move?.san}`);
    } catch (error) {
      console.error(`❌ Error saving move for ${gameId}:`, error);
    }
  }
}

export default GameEventConsumer;
