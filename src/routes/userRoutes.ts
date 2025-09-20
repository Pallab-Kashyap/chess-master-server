import { Router } from "express";
import { registerUser } from "../controllers/user";


const router = Router()

router.route('/').post(registerUser)

export default router
