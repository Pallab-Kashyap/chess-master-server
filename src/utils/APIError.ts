class APIError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public status: boolean;

  constructor(
    statusCode: number,
    message: string,
    isOperational: boolean = true
  ) {
    super(message);
    this.status = false;
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Object.setPrototypeOf(this, new.target.prototype);

    Error.captureStackTrace(this);
  }

  static badRequest(message: string) {
    return new APIError(400, message);
  }

  static unauthorized(message: string) {
    return new APIError(401, message);
  }

  static forbidden(message: string) {
    return new APIError(403, message);
  }

  static notFound(message: string) {
    return new APIError(404, message);
  }

  static conflict(message: string) {
    return new APIError(409, message);
  }

  static internal(message: string) {
    return new APIError(500, message);
  }

  static custom(statusCode: number, message: string): APIError {
    return new APIError(statusCode, message);
  }
}

export default APIError;
