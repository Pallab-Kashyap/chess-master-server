import { Router } from "express";
import {
  getUserRatingStats,
  getRatingHistory,
  getLeaderboard,
  getRatingCategory,
  getPublicUserRatingStats,
  calculateHypotheticalRating,
  getRatingDistribution,
  getGameRatingChanges,
} from "../controllers/rating";
import auth from "../middlewares/auth";

const router = Router();

// Protected routes (require authentication)
router.route("/stats").get(auth, getUserRatingStats);
router.route("/history").get(auth, getRatingHistory);
router.route("/calculate").post(calculateHypotheticalRating);
router.route("/game/:gameId").get(auth, getGameRatingChanges);

// Public routes (no authentication required)
router.route("/leaderboard").get(getLeaderboard);
router.route("/category").get(getRatingCategory);
router.route("/distribution").get(getRatingDistribution);
router.route("/user/:userId").get(getPublicUserRatingStats);

export default router;
