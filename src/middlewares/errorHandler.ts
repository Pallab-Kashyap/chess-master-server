import { Request, Response, NextFunction } from "express";
import APIError from "../utils/APIError";

const errorHandler = (
  err: APIError | Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(err);

  if (err instanceof APIError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  } else {
    const statusCode = err instanceof APIError ? err.statusCode : 500;
    const message = err.message || "Internal Server Error";

    res.status(statusCode).json({
      success: false,
      message,
    });
  }
};

export default errorHandler;
