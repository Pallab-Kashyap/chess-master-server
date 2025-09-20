import { Router } from "express";
import { registerUser, loginUser, getUserProfile } from "../controllers/user";
import auth from "../middlewares/auth";

const router = Router();

router.route("/register").post(registerUser);
router.route("/login").post(loginUser);
router.route("/profile").get(auth, getUserProfile);

export default router;
