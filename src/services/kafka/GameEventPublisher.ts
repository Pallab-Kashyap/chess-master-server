import { Producer } from "kafkajs";
import KafkaManager from "../../config/kafka";
import { KAFKA_TOPICS, GameEvent, KafkaMessage } from "../../types/kafka";

export class GameEventPublisher {
  private producer: Producer | null = null;
  private kafkaManager: KafkaManager;

  constructor() {
    this.kafkaManager = KafkaManager.getInstance();
  }

  /**
   * Initialize the publisher
   */
  async initialize(): Promise<void> {
    // Just ensure we can get a producer - the actual connection happens in getProducer
    await this.getProducer();
  }

  private async getProducer(): Promise<Producer | null> {
    if (!this.producer) {
      this.producer = await this.kafkaManager.getProducer();
    }
    return this.producer;
  }

  /**
   * Publish a game event to Kafka
   */
  async publishGameEvent(
    gameId: string,
    event: GameEvent,
    priority: "HIGH" | "MEDIUM" | "LOW" = "MEDIUM"
  ): Promise<boolean> {
    try {
      const producer = await this.getProducer();

      // If Kafka is disabled, just log and return true
      if (!producer) {
        console.log(
          `📝 Kafka disabled - would publish event: ${event.type} for game ${gameId}`
        );
        return true;
      }

      const message: KafkaMessage = {
        gameId,
        event,
        priority,
        retryCount: 0,
      };

      const topic = this.getTopicForEvent(event.type);

      await producer.send({
        topic,
        messages: [
          {
            key: gameId,
            value: JSON.stringify(message),
            timestamp: Date.now().toString(),
            headers: {
              eventType: event.type,
              priority,
              gameId,
            },
          },
        ],
      });

      console.log(
        `📨 Published ${event.type} event for game ${gameId} to topic ${topic}`
      );
      return true;
    } catch (error) {
      console.error(
        `❌ Failed to publish event ${event.type} for game ${gameId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Publish multiple events in a batch for better performance
   */
  async publishGameEventsBatch(
    events: Array<{
      gameId: string;
      event: GameEvent;
      priority?: "HIGH" | "MEDIUM" | "LOW";
    }>
  ): Promise<boolean> {
    try {
      const producer = await this.getProducer();

      // If Kafka is disabled, just log and return true
      if (!producer) {
        console.log(
          `📝 Kafka disabled - would publish batch of ${events.length} events`
        );
        return true;
      }

      // Group events by topic
      const topicMessages: { [topic: string]: any[] } = {};

      events.forEach(({ gameId, event, priority = "MEDIUM" }) => {
        const topic = this.getTopicForEvent(event.type);

        if (!topicMessages[topic]) {
          topicMessages[topic] = [];
        }

        const message: KafkaMessage = {
          gameId,
          event,
          priority,
          retryCount: 0,
        };

        topicMessages[topic].push({
          key: gameId,
          value: JSON.stringify(message),
          timestamp: Date.now().toString(),
          headers: {
            eventType: event.type,
            priority,
            gameId,
          },
        });
      });

      // Send batches to each topic
      const promises = Object.entries(topicMessages).map(([topic, messages]) =>
        producer.send({ topic, messages })
      );

      await Promise.all(promises);

      console.log(
        `📨 Published batch of ${events.length} events across ${
          Object.keys(topicMessages).length
        } topics`
      );
      return true;
    } catch (error) {
      console.error("❌ Failed to publish events batch:", error);
      return false;
    }
  }

  /**
   * Determine the appropriate Kafka topic based on event type
   */
  private getTopicForEvent(eventType: string): string {
    switch (eventType) {
      case "move_made":
        return KAFKA_TOPICS.GAME_MOVES;
      case "game_started":
      case "game_ended":
        return KAFKA_TOPICS.GAME_STATE_UPDATES;
      default:
        return KAFKA_TOPICS.GAME_EVENTS;
    }
  }

  /**
   * Publish high-priority event (for critical operations like game end)
   */
  async publishHighPriorityEvent(
    gameId: string,
    event: GameEvent
  ): Promise<boolean> {
    return this.publishGameEvent(gameId, event, "HIGH");
  }

  /**
   * Publish low-priority event (for analytics, stats)
   */
  async publishLowPriorityEvent(
    gameId: string,
    event: GameEvent
  ): Promise<boolean> {
    return this.publishGameEvent(gameId, event, "LOW");
  }
}

export default GameEventPublisher;
