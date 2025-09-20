import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";

export const generateToken = (
  playload: any,
  expiresIn: SignOptions["expiresIn"] = "5m"
) => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("jwt secret missing");
  }

  return jwt.sign(playload, secret, { expiresIn });

};

export const verifyToken = (token: string): JwtPayload => {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("jwt secret missing");
  }
  const decoded = jwt.verify(token, secret);

  if (typeof decoded === "string") {
    throw new Error("Invalid token payload");
  }

  return decoded;

};
