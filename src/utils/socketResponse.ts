interface SocketResponse {
  success: boolean;
  message?: string;
  data?: any;
}

export class socketErrorMessage {
  private status: boolean;

  constructor() {
    this.status = false;
  }

  static send(message: string): SocketResponse {
    return {
      success: false,
      message,
    };
  }
}

export class socketSuccessMessage {
  private status: boolean;

  constructor() {
    this.status = true;
  }

  static send(data: any, message?: string): SocketResponse {
    return {
      success: true,
      data,
      message,
    };
  }
}
