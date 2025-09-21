import GameEventPublisher from "./GameEventPublisher";
import { GameEvent } from "../../types/kafka";

interface BatchedEvent {
  gameId: string;
  event: GameEvent;
  priority: "HIGH" | "MEDIUM" | "LOW";
  timestamp: number;
}

export class GameEventBatchProcessor {
  private publisher: GameEventPublisher;
  private eventBatch: BatchedEvent[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 100; // Max events per batch
  private readonly BATCH_TIMEOUT = 5000; // 5 seconds max wait time
  private readonly HIGH_PRIORITY_BATCH_SIZE = 10; // Smaller batch for high priority events
  private readonly HIGH_PRIORITY_TIMEOUT = 1000; // 1 second for high priority events

  constructor() {
    this.publisher = new GameEventPublisher();
  }

  /**
   * Add event to batch for processing
   */
  async addEvent(
    gameId: string,
    event: GameEvent,
    priority: "HIGH" | "MEDIUM" | "LOW" = "MEDIUM"
  ): Promise<void> {
    const batchedEvent: BatchedEvent = {
      gameId,
      event,
      priority,
      timestamp: Date.now(),
    };

    this.eventBatch.push(batchedEvent);

    // Immediate processing for high priority events
    if (priority === "HIGH") {
      await this.processHighPriorityEvents();
      return;
    }

    // Check if we should process the batch
    if (this.shouldProcessBatch()) {
      await this.processBatch();
    } else {
      this.scheduleBatchProcessing();
    }
  }

  /**
   * Process high priority events immediately
   */
  private async processHighPriorityEvents(): Promise<void> {
    const highPriorityEvents = this.eventBatch.filter(
      (e) => e.priority === "HIGH"
    );

    if (highPriorityEvents.length >= this.HIGH_PRIORITY_BATCH_SIZE) {
      const eventsToProcess = highPriorityEvents.slice(
        0,
        this.HIGH_PRIORITY_BATCH_SIZE
      );

      // Remove processed events from batch
      this.eventBatch = this.eventBatch.filter(
        (e) => e.priority !== "HIGH" || !eventsToProcess.includes(e)
      );

      await this.sendBatch(eventsToProcess, "HIGH_PRIORITY");
    } else {
      // Schedule immediate processing for single high priority event
      setTimeout(
        () => this.processHighPriorityBatch(),
        this.HIGH_PRIORITY_TIMEOUT
      );
    }
  }

  /**
   * Process high priority batch with timeout
   */
  private async processHighPriorityBatch(): Promise<void> {
    const highPriorityEvents = this.eventBatch.filter(
      (e) => e.priority === "HIGH"
    );

    if (highPriorityEvents.length > 0) {
      // Remove processed events from batch
      this.eventBatch = this.eventBatch.filter((e) => e.priority !== "HIGH");
      await this.sendBatch(highPriorityEvents, "HIGH_PRIORITY");
    }
  }

  /**
   * Check if batch should be processed
   */
  private shouldProcessBatch(): boolean {
    return this.eventBatch.length >= this.BATCH_SIZE;
  }

  /**
   * Schedule batch processing with timeout
   */
  private scheduleBatchProcessing(): void {
    if (this.batchTimer) {
      return; // Timer already scheduled
    }

    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.BATCH_TIMEOUT);
  }

  /**
   * Process the current batch
   */
  private async processBatch(): Promise<void> {
    if (this.eventBatch.length === 0) {
      return;
    }

    // Clear the timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Separate high priority from normal events
    const normalEvents = this.eventBatch.filter((e) => e.priority !== "HIGH");
    const eventsToProcess = normalEvents.slice(0, this.BATCH_SIZE);

    // Remove processed events from batch
    this.eventBatch = [
      ...this.eventBatch.filter((e) => e.priority === "HIGH"), // Keep high priority events
      ...normalEvents.slice(this.BATCH_SIZE), // Keep remaining normal events
    ];

    if (eventsToProcess.length > 0) {
      await this.sendBatch(eventsToProcess, "NORMAL");
    }

    // Schedule next batch if there are remaining events
    if (this.eventBatch.filter((e) => e.priority !== "HIGH").length > 0) {
      this.scheduleBatchProcessing();
    }
  }

  /**
   * Send batch to Kafka
   */
  private async sendBatch(
    events: BatchedEvent[],
    batchType: string
  ): Promise<void> {
    try {
      const kafkaEvents = events.map((e) => ({
        gameId: e.gameId,
        event: e.event,
        priority: e.priority,
      }));

      const success = await this.publisher.publishGameEventsBatch(kafkaEvents);

      if (success) {
        console.log(`✅ Processed ${batchType} batch: ${events.length} events`);
      } else {
        console.error(
          `❌ Failed to process ${batchType} batch: ${events.length} events`
        );
        // Could implement retry logic here
      }
    } catch (error) {
      console.error(`❌ Error processing ${batchType} batch:`, error);
    }
  }

  /**
   * Force process all pending events (useful for shutdown)
   */
  async flushBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.eventBatch.length > 0) {
      await this.sendBatch(this.eventBatch, "FLUSH");
      this.eventBatch = [];
    }
  }

  /**
   * Get batch statistics
   */
  getBatchStats(): {
    pendingEvents: number;
    highPriorityEvents: number;
    mediumPriorityEvents: number;
    lowPriorityEvents: number;
    batchTimerActive: boolean;
  } {
    const stats = {
      pendingEvents: this.eventBatch.length,
      highPriorityEvents: this.eventBatch.filter((e) => e.priority === "HIGH")
        .length,
      mediumPriorityEvents: this.eventBatch.filter(
        (e) => e.priority === "MEDIUM"
      ).length,
      lowPriorityEvents: this.eventBatch.filter((e) => e.priority === "LOW")
        .length,
      batchTimerActive: this.batchTimer !== null,
    };

    return stats;
  }
}

export default GameEventBatchProcessor;
