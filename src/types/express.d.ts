interface UserPayload {
  userId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

export { UserPayload };
