import { Response } from "express";

class APIResponse {
  public status;
  public message;
  public data: any;

  constructor(message = "Success", data = null) {
    this.status = true;
    this.message = message;
    this.data = data;
  }

  static success(response: Response, message = "Success", data: any) {
    return response.status(200).json(new APIResponse(message, data));
  }

  static created(
    response: Response,
    message = "Resource created successfully",
    data: any
  ) {
    return response.status(201).json(new APIResponse(message, data));
  }
}

export default APIResponse;
