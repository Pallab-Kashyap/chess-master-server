import { Consumer, EachMessagePayload } from "kafkajs";
import KafkaManager from "../../config/kafka";
import {
  KAFKA_TOPICS,
  KafkaMessage,
  GAME_EVENT_TYPES,
} from "../../types/kafka";
import GameModel from "../../models/game";
import { RESULT_TYPES } from "../../constants";

export class GameEventConsumer {
  private consumer: Consumer | null = null;
  private kafkaManager: KafkaManager;
  private isRunning = false;

  constructor() {
    this.kafkaManager = KafkaManager.getInstance();
  }

  /**
   * Start consuming game events from Kafka
   */
  async startConsuming(): Promise<void> {
    try {
      this.consumer = await this.kafkaManager.getConsumer(
        "chess-game-persistence-group"
      );

      // Subscribe to all game-related topics
      await this.consumer.subscribe({
        topics: [
          KAFKA_TOPICS.GAME_MOVES,
          KAFKA_TOPICS.GAME_STATE_UPDATES,
          KAFKA_TOPICS.GAME_EVENTS,
        ],
        fromBeginning: false,
      });

      await this.consumer.run({
        eachMessage: this.handleMessage.bind(this),
      });

      this.isRunning = true;
      console.log("📥 Kafka consumer started - listening for game events");
    } catch (error) {
      console.error("❌ Failed to start Kafka consumer:", error);
      throw error;
    }
  }

  /**
   * Handle incoming Kafka messages
   */
  private async handleMessage({
    topic,
    partition,
    message,
  }: EachMessagePayload): Promise<void> {
    try {
      if (!message.value) {
        console.warn("⚠️ Received empty message");
        return;
      }

      const kafkaMessage: KafkaMessage = JSON.parse(message.value.toString());
      const { gameId, event, priority } = kafkaMessage;

      console.log(
        `📥 Processing ${event.type} event for game ${gameId} (priority: ${priority})`
      );

      switch (event.type) {
        case GAME_EVENT_TYPES.GAME_STARTED:
          await this.handleGameStarted(kafkaMessage);
          break;
        case GAME_EVENT_TYPES.MOVE_MADE:
          await this.handleMoveMade(kafkaMessage);
          break;
        case GAME_EVENT_TYPES.GAME_ENDED:
          await this.handleGameEnded(kafkaMessage);
          break;
        case GAME_EVENT_TYPES.PLAYER_RESIGNED:
          await this.handlePlayerResigned(kafkaMessage);
          break;
        case GAME_EVENT_TYPES.DRAW_ACCEPTED:
          await this.handleDrawAccepted(kafkaMessage);
          break;
        case GAME_EVENT_TYPES.TIME_UPDATE:
          await this.handleTimeUpdate(kafkaMessage);
          break;
        case GAME_EVENT_TYPES.RATING_UPDATED:
          await this.handleRatingUpdated(kafkaMessage);
          break;
        default:
          console.log(`ℹ️ Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error("❌ Error processing Kafka message:", error);
      // Could implement dead letter queue here for failed messages
    }
  }

  /**
   * Handle game started event
   */
  private async handleGameStarted(kafkaMessage: KafkaMessage): Promise<void> {
    const { gameId, event } = kafkaMessage;

    if (event.type !== GAME_EVENT_TYPES.GAME_STARTED) return;

    try {
      const existingGame = await GameModel.findById(gameId);
      if (existingGame) {
        console.log(`ℹ️ Game ${gameId} already exists in MongoDB`);
        return;
      }

      await GameModel.create({
        _id: gameId,
        players: [
          {
            userId: event.players.white,
            color: "white",
            preRating: 0, // Will be updated by rating service
          },
          {
            userId: event.players.black,
            color: "black",
            preRating: 0, // Will be updated by rating service
          },
        ],
        status: "active",
        initialFen: event.initialFen,
        moves: [],
        pgn: "",
        variant: "RAPID", // TODO: Get from event
        timeControl: event.timeControl,
        startedAt: new Date(event.timestamp),
      });

      console.log(`✅ Game ${gameId} created in MongoDB`);
    } catch (error) {
      console.error(`❌ Failed to create game ${gameId} in MongoDB:`, error);
    }
  }

  /**
   * Handle move made event
   */
  private async handleMoveMade(kafkaMessage: KafkaMessage): Promise<void> {
    const { gameId, event } = kafkaMessage;

    if (event.type !== GAME_EVENT_TYPES.MOVE_MADE) return;

    try {
      await GameModel.findByIdAndUpdate(
        gameId,
        {
          $push: {
            moves: {
              move: event.move.san,
              from: event.move.from,
              to: event.move.to,
              timeStamp: new Date(event.timestamp),
            },
          },
          $set: {
            pgn: event.pgn,
            // Update FEN periodically (every 10 moves) to avoid too much data
            ...(event.moveNumber % 10 === 0 && {
              $push: { fenHistory: event.fen },
            }),
          },
        },
        { upsert: false }
      );

      console.log(
        `✅ Move ${event.moveNumber} for game ${gameId} saved to MongoDB`
      );
    } catch (error) {
      console.error(`❌ Failed to save move for game ${gameId}:`, error);
    }
  }

  /**
   * Handle game ended event
   */
  private async handleGameEnded(kafkaMessage: KafkaMessage): Promise<void> {
    const { gameId, event } = kafkaMessage;

    if (event.type !== GAME_EVENT_TYPES.GAME_ENDED) return;

    try {
      const updateData: any = {
        status: "completed",
        pgn: event.finalPgn,
        result: {
          winner: event.result.winner,
          reason: event.result.reason,
        },
        endedAt: new Date(event.timestamp),
      };

      if (event.ratingChanges) {
        updateData.ratingChanges = event.ratingChanges;
      }

      await GameModel.findByIdAndUpdate(gameId, updateData);

      console.log(`✅ Game ${gameId} ended and saved to MongoDB`);
    } catch (error) {
      console.error(`❌ Failed to save game end for ${gameId}:`, error);
    }
  }

  /**
   * Handle player resigned event
   */
  private async handlePlayerResigned(
    kafkaMessage: KafkaMessage
  ): Promise<void> {
    const { gameId, event } = kafkaMessage;

    if (event.type !== GAME_EVENT_TYPES.PLAYER_RESIGNED) return;

    try {
      const winner = event.resignedPlayer === "white" ? "black" : "white";

      await GameModel.findByIdAndUpdate(gameId, {
        status: "completed",
        result: {
          winner,
          reason: RESULT_TYPES.RESIGN,
        },
        endedAt: new Date(event.timestamp),
      });

      console.log(`✅ Resignation for game ${gameId} saved to MongoDB`);
    } catch (error) {
      console.error(`❌ Failed to save resignation for game ${gameId}:`, error);
    }
  }

  /**
   * Handle draw accepted event
   */
  private async handleDrawAccepted(kafkaMessage: KafkaMessage): Promise<void> {
    const { gameId, event } = kafkaMessage;

    if (event.type !== GAME_EVENT_TYPES.DRAW_ACCEPTED) return;

    try {
      await GameModel.findByIdAndUpdate(gameId, {
        status: "completed",
        result: {
          winner: "draw",
          reason: RESULT_TYPES.DRAW,
        },
        endedAt: new Date(event.timestamp),
      });

      console.log(`✅ Draw for game ${gameId} saved to MongoDB`);
    } catch (error) {
      console.error(`❌ Failed to save draw for game ${gameId}:`, error);
    }
  }

  /**
   * Handle time update (for analytics - low frequency saves)
   */
  private async handleTimeUpdate(kafkaMessage: KafkaMessage): Promise<void> {
    // Only save time updates periodically to avoid too many DB writes
    // Could be used for game analysis or replay features
    console.log(
      `ℹ️ Time update for game ${kafkaMessage.gameId} (not persisted)`
    );
  }

  /**
   * Handle rating update
   */
  private async handleRatingUpdated(kafkaMessage: KafkaMessage): Promise<void> {
    const { gameId, event } = kafkaMessage;

    if (event.type !== GAME_EVENT_TYPES.RATING_UPDATED) return;

    try {
      // Update the player's rating in the game document
      await GameModel.findOneAndUpdate(
        {
          _id: gameId,
          "players.userId": event.userId,
        },
        {
          $set: {
            "players.$.postRating": event.newRating,
          },
        }
      );

      console.log(
        `✅ Rating update for user ${event.userId} in game ${gameId} saved`
      );
    } catch (error) {
      console.error(
        `❌ Failed to save rating update for game ${gameId}:`,
        error
      );
    }
  }

  /**
   * Stop consuming messages
   */
  async stopConsuming(): Promise<void> {
    if (this.consumer && this.isRunning) {
      await this.consumer.disconnect();
      this.isRunning = false;
      console.log("📥 Kafka consumer stopped");
    }
  }

  /**
   * Get consumer status
   */
  isConsumerRunning(): boolean {
    return this.isRunning;
  }
}

export default GameEventConsumer;
