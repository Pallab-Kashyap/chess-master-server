import { Schema, model, Document, Types } from "mongoose";
import {  } from "../constants";

// 1. TypeScript interface
export interface IPlayer {
  userId: Types.ObjectId;
  color: "white" | "black";
  preRating: number;
  postRating?: number;
  timeLeftHistory?: { moveNumber: number; timeLeft: number }[];
}

export interface IAnalysisMove {
  moveNumber: number;
  engineEval: number;
  bestMove: string;
  moveAccuracy: number;
}

export interface IAnalysis {
  isAnalysed: boolean;
  overallAccuracy?: number;
  depth?: number;
  perMove?: IAnalysisMove[];
}

export interface ITimeControl {
  baseMs: number;
  incrementMs: number;
}

export interface IResult {
  winner: "white" | "black" | null;
  reason:
    | "checkmate"
    | "resignation"
    | "timeout"
    | "stalemate"
    | "agreement"
    | "threefold"
    | "insufficientMaterial";
  score: "1-0" | "0-1" | "1/2-1/2";
}

export interface IChatMessage {
  userId: Types.ObjectId;
  message: string;
  at: Date;
}

export interface IGame extends Document {
  players: IPlayer[];
  initialFen: string;
  moves: string[];
  fenHistory?: string[];
  pgn: string;
  timeControl: ITimeControl;
  result: IResult;
  analysis: IAnalysis;
  spectators?: Types.ObjectId[];
  chat?: IChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}

// 2. Mongoose Schema
const PlayerSchema = new Schema<IPlayer>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    color: { type: String, enum: ["white", "black"], required: true },
    preRating: { type: Number, required: true },
    postRating: { type: Number, default: null },
    timeLeftHistory: [
      {
        moveNumber: { type: Number, required: true },
        timeLeft: { type: Number, required: true },
      },
    ],
  },
  { _id: false }
);

const AnalysisMoveSchema = new Schema<IAnalysisMove>(
  {
    moveNumber: { type: Number, required: true },
    engineEval: { type: Number, required: true },
    bestMove: { type: String, required: true },
    moveAccuracy: { type: Number, required: true },
  },
  { _id: false }
);

const AnalysisSchema = new Schema<IAnalysis>(
  {
    isAnalysed: { type: Boolean, required: true, default: false },
    overallAccuracy: { type: Number, default: null },
    depth: { type: Number, default: null },
    perMove: [AnalysisMoveSchema],
  },
  { _id: false }
);

const TimeControlSchema = new Schema<ITimeControl>(
  {
    baseMs: { type: Number, required: true },
    incrementMs: { type: Number, required: true },
  },
  { _id: false }
);

const ResultSchema = new Schema<IResult>(
  {
    winner: { type: String, enum: ["white", "black", null], default: null },
    reason: {
      type: String,
      enum: [
        "checkmate",
        "resignation",
        "timeout",
        "stalemate",
        "agreement",
        "threefold",
        "insufficientMaterial",
      ],
      required: true,
    },
    score: { type: String, enum: ["1-0", "0-1", "1/2-1/2"], required: true },
  },
  { _id: false }
);

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    message: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const GameSchema = new Schema<IGame>(
  {
    players: {
      type: [PlayerSchema],
      required: true,
      validate: (v: IPlayer[]) => v.length === 2,
    },

    initialFen: { type: String, required: true, default: "startpos" },
    moves: { type: [String], required: true, default: [] },
    pgn: { type: String, required: true },

    timeControl: { type: TimeControlSchema, required: true },
    result: { type: ResultSchema, required: true },
    analysis: {
      type: AnalysisSchema,
      required: true,
      default: () => ({ isAnalysed: false }),
    },

    spectators: [{ type: Schema.Types.ObjectId, ref: "User" }],
    chat: { type: [ChatMessageSchema], default: [] },

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// 3. Indexes for performance
GameSchema.index({ "players.userId": 1 });
GameSchema.index({ endedAt: -1 });

// 4. Export
export const GameModel = model<IGame>("Game", GameSchema);
