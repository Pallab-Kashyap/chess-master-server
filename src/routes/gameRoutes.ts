import { Router } from "express";
import {
  createGame,
  startDynamicMatchmaking,
  getGameRatingChanges,
} from "../controllers/game";
import { createTestGame } from "../controllers/testGame";
import auth from "../middlewares/auth";

const router = Router();

// POST /api/v1/game/create - Create or join a game (legacy)
router.route("/create").post(auth, createGame);

// POST /api/v1/game/matchmake - Start dynamic matchmaking with expanding ranges
router.route("/matchmake").post(auth, startDynamicMatchmaking);

// GET /api/v1/game/:gameId/rating-changes - Get pre-calculated rating changes for a game
router.route("/:gameId/rating-changes").get(getGameRatingChanges);

// POST /api/v1/game/test - Create a test game with specific players (development only)
router.route("/test").post(createTestGame);

export default router;
