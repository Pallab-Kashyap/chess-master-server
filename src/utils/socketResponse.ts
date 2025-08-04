export class socketErrorMessage {
    private status: boolean

    constructor(){
        this.status = false
    }

    static send(message: any){
        return {
            message
        }
    }
}

export class socketSuccessMessage {
  private status: boolean;

  constructor() {
    this.status = false;
  }

  static send(data: any ) {
    return {
      data,
    };
  }
}
