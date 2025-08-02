import { NextFunction, Request, Response } from "express";
import asyncWrapper from "../utils/asyncWrapper";


const auth = asyncWrapper(async (req: Request, res: Response, next: NextFunction) => {
    
})

export default auth
