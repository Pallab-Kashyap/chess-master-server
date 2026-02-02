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

      // Check if Kafka is available
      const producer = await this.kafkaManager.getProducer();
      if (!producer) {
        console.log(
          "⚠️  Kafka is disabled, skipping Kafka service initialization"
        );
        this.isInitialized = true;
        return;
      }

      // Start the consumer to process game events
      await this.consumer.initialize();
      await this.consumer.startConsuming(); // Add this line to actually start consuming

      // Initialize the publisher
      await this.publisher.initialize();

      // Start batch processing
      await this.batchProcessor.initialize();

      this.isInitialized = true;
      console.log("✅ Kafka services initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize Kafka services:", error);
      // Don't throw - let the server continue without Kafka
      this.isInitialized = true;
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
