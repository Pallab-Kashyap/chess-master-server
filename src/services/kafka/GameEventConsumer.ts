import { Consumer } from "kafkajs";
import KafkaManager from "../../config/kafka";
import { KAFKA_TOPICS } from "../../types/kafka";

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
    // Process game events (start, end, rematch, etc.)
    console.log(`🎮 Game event: ${eventData.eventType}`, eventData.gameId);
  }

  /**
   * Handle move events
   */
  private async handleMoveEvent(eventData: any): Promise<void> {
    // Process move events
    console.log(`♟️  Move event: ${eventData.move}`, eventData.gameId);
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
}

export default GameEventConsumer;
