import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";
import { UserPayload } from "../types/express";

export const generateToken = (
  playload: any,
  expiresIn: SignOptions["expiresIn"] = "5h"
) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("jwt secret missing");
  }

  return jwt.sign(playload, secret, { expiresIn });
};

export const verifyToken = (token: string): UserPayload => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("jwt secret missing");
  }
  const decoded = jwt.verify(token, secret);

  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }

  // Ensure the decoded token has the expected userId property
  if (!decoded || typeof decoded !== "object" || !("userId" in decoded)) {
    throw new Error("Invalid token: missing userId");
  }

  return decoded as UserPayload;
};
