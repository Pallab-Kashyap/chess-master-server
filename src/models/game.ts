import mongoose, { Schema, Document, Types } from "mongoose";
import { GameTimeControll, PLAYER_COLOR, RESULT_TYPES } from "../constants";

export interface IPlayer extends Document {
  userId: Types.ObjectId;
  color: PLAYER_COLOR;
  preRating: number;
  postRating: number;
}

export interface IMove extends Document {
  move: string;
  from?: string;
  to?: string;
  timeStamp: Date;
}

export interface IAnalysis extends Document {
  isAnalysed: boolean;
  accuracy: {
    white: number;
    black: number;
  };
  analisis?: Types.ObjectId;
}

export interface IResult extends Document {
  winner: PLAYER_COLOR | null;
  reason: RESULT_TYPES;
  score: "1-0" | "0-1" | "1/2-1/2";
}

export interface IGame extends Document {
  players: IPlayer[];
  initialFen: string;
  moves: string[];
  fenHistory?: string[];
  pgn: string;
  timeControl: GameTimeControll;
  result: IResult;
  analysis: IAnalysis;
  variant?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  endedAt?: Date;
}

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
  },
  { _id: false }
);

const AnalysisSchema = new Schema<IAnalysis>(
  {
    isAnalysed: { type: Boolean, required: true, default: false },
    accuracy: {
      white: {
        type: Number,
      },
      black: {
        type: Number,
      },
    },
    analisis: {
      type: Types.ObjectId,
      ref: "Analysis",
    },
  },
  { _id: false }
);

const ResultSchema = new Schema<IResult>(
  {
    winner: { type: String, enum: ["white", "black", null], default: null },
    reason: {
      type: String,
      enum: RESULT_TYPES,
      required: true,
    },
    score: { type: String, enum: ["1-0", "0-1", "1/2-1/2"], required: true },
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
    fenHistory: { type: [String], default: [] },
    pgn: { type: String, required: true },

    result: { type: ResultSchema, required: true },
    analysis: {
      type: AnalysisSchema,
      required: true,
      default: () => ({ isAnalysed: false }),
    },

    variant: { type: String, default: "standard" },

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

GameSchema.index({ "players.userId": 1 });
GameSchema.index({ endedAt: -1 });

const GameModel = mongoose.model<IGame>("Game", GameSchema);

export default GameModel;
