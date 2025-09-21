import KafkaManager from "../../config/kafka";
import GameEventConsumer from "./GameEventConsumer";
import GameEventPublisher from "./GameEventPublisher";
import GameEventBatchProcessor from "./GameEventBatchProcessor";

export class KafkaServiceManager {
  private static instance: KafkaServiceManager;
  private kafkaManager: KafkaManager;
  private consumer: GameEventConsumer;
  private publisher: GameEventPublisher;
  private batchProcessor: GameEventBatchProcessor;
  private isInitialized = false;

  private constructor() {
    this.kafkaManager = KafkaManager.getInstance();
    this.consumer = new GameEventConsumer();
    this.publisher = new GameEventPublisher();
    this.batchProcessor = new GameEventBatchProcessor();
  }

  public static getInstance(): KafkaServiceManager {
    if (!KafkaServiceManager.instance) {
      KafkaServiceManager.instance = new KafkaServiceManager();
    }
    return KafkaServiceManager.instance;
  }

  /**
   * Initialize all Kafka services
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log("🔄 Kafka services already initialized");
      return;
    }

    try {
      console.log("🚀 Initializing Kafka services...");

      // Start the consumer to process game events
      await this.consumer.startConsuming();

      console.log("✅ Kafka services initialized successfully");
      this.isInitialized = true;

      // Setup graceful shutdown
      process.on("SIGINT", this.gracefulShutdown.bind(this));
      process.on("SIGTERM", this.gracefulShutdown.bind(this));
    } catch (error) {
      console.error("❌ Failed to initialize Kafka services:", error);
      throw error;
    }
  }

  /**
   * Get the publisher instance
   */
  getPublisher(): GameEventPublisher {
    return this.publisher;
  }

  /**
   * Get the batch processor instance
   */
  getBatchProcessor(): GameEventBatchProcessor {
    return this.batchProcessor;
  }

  /**
   * Get the consumer instance
   */
  getConsumer(): GameEventConsumer {
    return this.consumer;
  }

  /**
   * Get service health status
   */
  getHealthStatus(): {
    isInitialized: boolean;
    consumerRunning: boolean;
    batchStats: any;
  } {
    return {
      isInitialized: this.isInitialized,
      consumerRunning: this.consumer.isConsumerRunning(),
      batchStats: this.batchProcessor.getBatchStats(),
    };
  }

  /**
   * Graceful shutdown of all Kafka services
   */
  private async gracefulShutdown(): Promise<void> {
    console.log("🛑 Shutting down Kafka services...");

    try {
      // Flush any pending batched events
      await this.batchProcessor.flushBatch();

      // Stop the consumer
      await this.consumer.stopConsuming();

      // Disconnect Kafka manager
      await this.kafkaManager.disconnect();

      console.log("✅ Kafka services shut down gracefully");
      this.isInitialized = false;
    } catch (error) {
      console.error("❌ Error during Kafka services shutdown:", error);
    }
  }

  /**
   * Manual shutdown (for testing or administrative purposes)
   */
  async shutdown(): Promise<void> {
    await this.gracefulShutdown();
  }

  /**
   * Restart Kafka services
   */
  async restart(): Promise<void> {
    console.log("🔄 Restarting Kafka services...");
    await this.gracefulShutdown();
    await this.initialize();
  }
}

export default KafkaServiceManager;
