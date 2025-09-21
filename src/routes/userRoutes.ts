import { Router } from "express";
import {
  registerUser,
  loginUser,
  getUserProfile,
  getUserDashboard,
  getUserGameHistory,
  getUserStats,
  updateUserProfile,
  getPublicUserProfile,
} from "../controllers/user";
import auth from "../middlewares/auth";

const router = Router();

// Public routes
router.route("/register").post(registerUser);
router.route("/login").post(loginUser);
router.route("/public/:userId").get(getPublicUserProfile);

// Protected routes
router.route("/profile").get(auth, getUserProfile);
router.route("/profile").patch(auth, updateUserProfile);
router.route("/dashboard").get(auth, getUserDashboard);
router.route("/games").get(auth, getUserGameHistory);
router.route("/stats").get(auth, getUserStats);

export default router;
