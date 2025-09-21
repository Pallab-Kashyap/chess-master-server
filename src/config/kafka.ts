import { Kafka, Producer, Consumer, KafkaConfig } from "kafkajs";

export class KafkaManager {
  private kafka: Kafka;
  private producer: Producer | null = null;
  private consumer: Consumer | null = null;
  private static instance: KafkaManager;

  private constructor() {
    const kafkaConfig: KafkaConfig = {
      clientId: "chess-game-service",
      brokers: [process.env.KAFKA_BROKER || "localhost:9092"],
      connectionTimeout: 3000,
      requestTimeout: 30000,
    };

    this.kafka = new Kafka(kafkaConfig);
  }

  public static getInstance(): KafkaManager {
    if (!KafkaManager.instance) {
      KafkaManager.instance = new KafkaManager();
    }
    return KafkaManager.instance;
  }

  public async getProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer({
        maxInFlightRequests: 1,
        idempotent: true,
        transactionTimeout: 30000,
      });
      await this.producer.connect();
      console.log("📨 Kafka Producer connected");
    }
    return this.producer;
  }

  public async getConsumer(groupId: string): Promise<Consumer> {
    if (!this.consumer) {
      this.consumer = this.kafka.consumer({
        groupId,
        sessionTimeout: 30000,
        heartbeatInterval: 3000,
        maxWaitTimeInMs: 100,
      });
      await this.consumer.connect();
      console.log(`📥 Kafka Consumer connected with groupId: ${groupId}`);
    }
    return this.consumer;
  }

  public async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      console.log("📨 Kafka Producer disconnected");
    }
    if (this.consumer) {
      await this.consumer.disconnect();
      console.log("📥 Kafka Consumer disconnected");
    }
  }
}

export default KafkaManager;
