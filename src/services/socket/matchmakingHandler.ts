import { Server, Socket } from "socket.io";
import { DynamicMatchMaking } from "../matchmaking/DynamicMatchMaking";
import { getPlayerHash, createPlayerHash } from "../redis/playerHash";
import { RatingService } from "../rating/RatingService";
import redisPubSub, { GameEventType } from "../redis/pubsub";

interface MatchmakingHandlers {
  [key: string]: (data: any) => Promise<void>;
}

export const registerMatchmakingHandler = (
  io: Server,
  socket: Socket,
  userId: string,
): void => {
  const handlers: MatchmakingHandlers = {
    // Client requests to search for a match (called every 3 seconds)
    search_match: async (data: {
      gameType?: string;
      variant?: string;
      timeControl?: any;
    }) => {
      try {
        console.log(`🔄 Processing search request from user ${userId}`);

        // Check if search session already exists
        const existingStatus = await DynamicMatchMaking.getSearchStatus(userId);

        if (!existingStatus.isSearching) {
          // No existing session, start a new search
          console.log(`🆕 Starting new search session for user ${userId}`);

          // Get user profile for rating - first try Redis, then database
          let userProfile = await getPlayerHash(userId);
          let userRating = 400; // Default rating for new users

          if (!userProfile) {
            // Player hash doesn't exist in Redis, get rating from database
            console.log(
              `🔍 Player hash not found for ${userId}, getting rating from database`,
            );

            try {
              const ratingStats =
                await RatingService.getPlayerRatingStats(userId);
              // Use rapid rating as default for matchmaking
              userRating = ratingStats.rapid.rating;
              console.log(
                `📊 Retrieved rating ${userRating} from database for user ${userId}`,
              );

              // Create player hash in Redis for future use
              await createPlayerHash(userId, socket.id, userRating);
              console.log(`💾 Created player hash in Redis for ${userId}`);
            } catch (error) {
              console.log(
                `⚠️ Could not get rating from database for ${userId}, using default 400`,
              );
            }
          } else {
            userRating = userProfile.rating;
            console.log(
              `📊 Retrieved rating ${userRating} from Redis for user ${userId}`,
            );
          }

          // Default values if not provided
          const gameType = data.gameType || "RAPID_10_0";
          const variant = data.variant || "RAPID";
          const timeControl = data.timeControl || { time: 600, increment: 5 };

          await DynamicMatchMaking.startSearch(
            userId,
            gameType,
            variant,
            timeControl,
            userRating,
            socket.id,
          );

          console.log(
            `✅ Search session started for user ${userId} with rating ${userRating}`,
          );
        }

        const result = await DynamicMatchMaking.processSearchRequest(userId);

        if (result.found && result.gameId) {
          // Publish match found to Redis Pub/Sub for distributed servers
          await redisPubSub.publishMatchmakingEvent(
            userId,
            result.opponent?.userId || "",
            result.gameId,
            data.variant || "RAPID",
            data.timeControl || { initial: 600000, increment: 5000 },
          );

          // Match found! Notify both players
          socket.emit("match_found", {
            success: true,
            data: {
              gameId: result.gameId,
              opponent: result.opponent,
              searchDuration: result.searchDuration,
              finalRange: result.currentRange,
              ratingChanges: result.ratingChanges,
            },
            message: "Match found! Game created successfully",
          });

          // Notify the opponent if they're connected
          if (result.opponent) {
            const opponentSockets = await io
              .in(`user:${result.opponent.userId}`)
              .fetchSockets();
            opponentSockets.forEach((opponentSocket) => {
              opponentSocket.emit("match_found", {
                success: true,
                data: {
                  gameId: result.gameId,
                  opponent: {
                    userId: userId,
                    rating: result.opponent!.rating, // We know it exists here
                  },
                  searchDuration: result.searchDuration,
                  finalRange: result.currentRange,
                  ratingChanges: result.ratingChanges,
                },
                message: "Match found! Game created successfully",
              });
            });
          }

          console.log(`✅ Match notification sent for game ${result.gameId}`);
        } else {
          // Still searching, send current status
          socket.emit("search_status", {
            success: true,
            data: {
              isSearching: true,
              currentRange: result.currentRange,
              searchDuration: result.searchDuration,
              message: `Searching for opponent (±${result.currentRange} rating range)`,
            },
            message: "Still searching for opponent",
          });

          console.log(
            `⏳ User ${userId} still searching with ±${result.currentRange} range`,
          );
        }
      } catch (error) {
        console.error(`❌ Error processing search for user ${userId}:`, error);
        socket.emit("search_error", {
          success: false,
          message: "Error processing search request",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },

    // Cancel current search
    cancel_search: async () => {
      try {
        console.log(`🛑 Cancelling search for user ${userId}`);

        await DynamicMatchMaking.cancelSearch(userId);

        socket.emit("search_cancelled", {
          success: true,
          message: "Search cancelled successfully",
        });

        console.log(`✅ Search cancelled for user ${userId}`);
      } catch (error) {
        console.error(`❌ Error cancelling search for user ${userId}:`, error);
        socket.emit("search_error", {
          success: false,
          message: "Error cancelling search",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },

    // Get current search status
    get_search_status: async () => {
      try {
        const status = await DynamicMatchMaking.getSearchStatus(userId);

        socket.emit("search_status_response", {
          success: true,
          data: status,
          message: status.isSearching ? "Currently searching" : "Not searching",
        });
      } catch (error) {
        console.error(
          `❌ Error getting search status for user ${userId}:`,
          error,
        );
        socket.emit("search_error", {
          success: false,
          message: "Error getting search status",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },

    // Get matchmaking statistics (for debugging/admin)
    get_matchmaking_stats: async () => {
      try {
        const stats = await DynamicMatchMaking.getMatchmakingStats();

        socket.emit("matchmaking_stats", {
          success: true,
          data: stats,
          message: "Matchmaking statistics retrieved",
        });
      } catch (error) {
        console.error(`❌ Error getting matchmaking stats:`, error);
        socket.emit("search_error", {
          success: false,
          message: "Error getting matchmaking statistics",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  };

  // Register all handlers
  Object.entries(handlers).forEach(([event, handler]) => {
    socket.on(event, handler);
  });

  // Handle disconnection - cancel any active search
  socket.on("disconnect", async () => {
    try {
      console.log(`🔌 User ${userId} disconnected, checking for active search`);

      const status = await DynamicMatchMaking.getSearchStatus(userId);
      if (status.isSearching) {
        await DynamicMatchMaking.cancelSearch(userId);
        console.log(`🛑 Auto-cancelled search for disconnected user ${userId}`);
      }
    } catch (error) {
      console.error(`❌ Error handling disconnect for user ${userId}:`, error);
    }
  });

  // Join user to their personal room for targeted notifications
  socket.join(`user:${userId}`);

  console.log(`🎯 Registered matchmaking handlers for user ${userId}`);
};

// Helper function to broadcast matchmaking statistics to all connected clients
export const broadcastMatchmakingStats = async (io: Server): Promise<void> => {
  try {
    const stats = await DynamicMatchMaking.getMatchmakingStats();
    io.emit("global_matchmaking_stats", {
      success: true,
      data: stats,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ Error broadcasting matchmaking stats:", error);
  }
};

export default {
  registerMatchmakingHandler,
  broadcastMatchmakingStats,
};
