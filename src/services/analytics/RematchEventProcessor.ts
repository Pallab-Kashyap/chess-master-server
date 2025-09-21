import {
  GameEvent,
  GAME_EVENT_TYPES,
  RematchOfferedEvent,
  RematchAcceptedEvent,
} from "../../types/kafka";
import GameModel from "../../models/game";
import UserProfileModel from "../../models/userProfile";

/**
 * Specialized consumer for handling rematch-related events
 * This service processes rematch offers and acceptances for analytics and logging
 */
export class RematchEventProcessor {
  private isProcessing = false;

  constructor() {
    console.log("🔄 RematchEventProcessor initialized");
  }

  /**
   * Process rematch-related events
   */
  async processRematchEvent(event: GameEvent): Promise<void> {
    if (this.isProcessing) {
      console.log("⚠️ RematchEventProcessor is busy, queuing event");
      return;
    }

    this.isProcessing = true;

    try {
      switch (event.type) {
        case GAME_EVENT_TYPES.REMATCH_OFFERED:
          await this.handleRematchOffered(event as RematchOfferedEvent);
          break;
        case GAME_EVENT_TYPES.REMATCH_ACCEPTED:
          await this.handleRematchAccepted(event as RematchAcceptedEvent);
          break;
        default:
          // Not a rematch event, ignore
          break;
      }
    } catch (error) {
      console.error(`❌ Error processing rematch event:`, error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Handle rematch offered event
   */
  private async handleRematchOffered(
    event: RematchOfferedEvent
  ): Promise<void> {
    console.log(`🔄 Processing rematch offer for game ${event.gameId}`);

    try {
      // Log the rematch offer for analytics
      await this.logRematchOffer(event);

      // Update user statistics if needed
      await this.updateRematchStats(event.offeredBy, "offered");

      console.log(`✅ Rematch offer processed for game ${event.gameId}`);
    } catch (error) {
      console.error(`❌ Error handling rematch offer:`, error);
      throw error;
    }
  }

  /**
   * Handle rematch accepted event
   */
  private async handleRematchAccepted(
    event: RematchAcceptedEvent
  ): Promise<void> {
    console.log(
      `🔄 Processing rematch acceptance for games ${event.originalGameId} -> ${event.gameId}`
    );

    try {
      // Log the rematch acceptance for analytics
      await this.logRematchAcceptance(event);

      // Update user statistics
      await this.updateRematchStats(event.acceptedBy, "accepted");

      // Link the games in database for historical tracking
      await this.linkRematchGames(event.originalGameId, event.gameId);

      console.log(
        `✅ Rematch acceptance processed: ${event.originalGameId} -> ${event.gameId}`
      );
    } catch (error) {
      console.error(`❌ Error handling rematch acceptance:`, error);
      throw error;
    }
  }

  /**
   * Log rematch offer for analytics
   */
  private async logRematchOffer(event: RematchOfferedEvent): Promise<void> {
    // This could be stored in a separate analytics collection
    // For now, we'll just log it
    console.log(`📊 ANALYTICS: Rematch offered`, {
      gameId: event.gameId,
      offeredBy: event.offeredBy,
      opponentId: event.opponentId,
      timestamp: event.timestamp,
      date: new Date(event.timestamp).toISOString(),
    });

    // In a production system, you might want to:
    // - Store this in an analytics database
    // - Send to a metrics collection service
    // - Trigger user notifications
  }

  /**
   * Log rematch acceptance for analytics
   */
  private async logRematchAcceptance(
    event: RematchAcceptedEvent
  ): Promise<void> {
    console.log(`📊 ANALYTICS: Rematch accepted`, {
      originalGameId: event.originalGameId,
      newGameId: event.gameId,
      acceptedBy: event.acceptedBy,
      players: event.players,
      timestamp: event.timestamp,
      date: new Date(event.timestamp).toISOString(),
    });

    // Calculate time between games for analytics
    try {
      const originalGame = await GameModel.findById(event.originalGameId);
      if (originalGame && originalGame.endedAt) {
        const timeBetweenGames =
          event.timestamp - originalGame.endedAt.getTime();
        console.log(
          `📊 ANALYTICS: Time between games: ${timeBetweenGames}ms (${Math.round(
            timeBetweenGames / 1000
          )}s)`
        );
      }
    } catch (error) {
      console.error("Error calculating time between games:", error);
    }
  }

  /**
   * Update rematch statistics for users
   */
  private async updateRematchStats(
    userId: string,
    action: "offered" | "accepted"
  ): Promise<void> {
    try {
      // In a more comprehensive system, you might track rematch statistics
      // For now, we'll just log the activity
      console.log(`📈 User ${userId} ${action} a rematch`);

      // Future enhancement: Add rematch fields to UserProfile
      // await UserProfileModel.findOneAndUpdate(
      //   { userId },
      //   {
      //     $inc: {
      //       [`rematchStats.${action}`]: 1,
      //       'rematchStats.total': 1
      //     }
      //   },
      //   { upsert: true }
      // );
    } catch (error) {
      console.error(`Error updating rematch stats for user ${userId}:`, error);
    }
  }

  /**
   * Link rematch games in the database for historical tracking
   */
  private async linkRematchGames(
    originalGameId: string,
    newGameId: string
  ): Promise<void> {
    try {
      // Add rematch reference to the original game
      await GameModel.findByIdAndUpdate(originalGameId, {
        $set: {
          rematchGameId: newGameId,
          hasRematch: true,
        },
      });

      // Add original game reference to the new game
      await GameModel.findByIdAndUpdate(newGameId, {
        $set: {
          originalGameId: originalGameId,
          isRematch: true,
        },
      });

      console.log(
        `🔗 Linked rematch games: ${originalGameId} <-> ${newGameId}`
      );
    } catch (error) {
      console.error(`Error linking rematch games:`, error);
    }
  }

  /**
   * Get rematch statistics for analytics
   */
  async getRematchStatistics(): Promise<{
    totalRematches: number;
    rematchRate: number;
    averageTimeBetweenGames: number;
  }> {
    try {
      const totalGames = await GameModel.countDocuments({
        status: "completed",
      });
      const totalRematches = await GameModel.countDocuments({
        isRematch: true,
      });

      const rematchRate =
        totalGames > 0 ? (totalRematches / totalGames) * 100 : 0;

      // Calculate average time between rematch games
      const rematchGames = await GameModel.find({
        isRematch: true,
        originalGameId: { $exists: true },
      }).populate("originalGameId");

      let totalTimeDiff = 0;
      let validTimeDiffs = 0;

      for (const rematchGame of rematchGames) {
        try {
          const originalGame = await GameModel.findById(
            rematchGame.originalGameId
          );
          if (originalGame && originalGame.endedAt && rematchGame.startedAt) {
            const timeDiff =
              rematchGame.startedAt.getTime() - originalGame.endedAt.getTime();
            totalTimeDiff += timeDiff;
            validTimeDiffs++;
          }
        } catch (error) {
          // Skip this calculation if there's an error
        }
      }

      const averageTimeBetweenGames =
        validTimeDiffs > 0 ? totalTimeDiff / validTimeDiffs : 0;

      return {
        totalRematches,
        rematchRate: Math.round(rematchRate * 100) / 100,
        averageTimeBetweenGames: Math.round(averageTimeBetweenGames / 1000), // Convert to seconds
      };
    } catch (error) {
      console.error("Error calculating rematch statistics:", error);
      return {
        totalRematches: 0,
        rematchRate: 0,
        averageTimeBetweenGames: 0,
      };
    }
  }
}

export default RematchEventProcessor;
