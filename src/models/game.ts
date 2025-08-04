import mongoose, { Schema, Document, Types } from "mongoose";
import { GAME_VARIANTS, PLAYER_COLOR, RESULT_TYPES, TimeControl } from "../constants";

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

export interface IResult extends Document {
  winner: PLAYER_COLOR | null;
  reason: RESULT_TYPES;
  score: "1-0" | "0-1" | "1/2-1/2";
}

export interface IGame extends Document {
  players: IPlayer[];
  status: "completed" | "on-going";
  initialFen: string;
  moves: IMove[];
  fenHistory?: string[];
  pgn: string;
  result: IResult;
  variant: GAME_VARIANTS;
  timeControl: TimeControl;
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

const MoveSchema = new Schema<IMove>({
  move: {
    type: String,
    required: true
  },
  from: {
    type: String
  },
  to: {
    type: String
  },
  timeStamp: {
    type: Date,
    required: true
  }
})

const ResultSchema = new Schema<IResult>(
  {
    winner: { type: String, enum: ["white", "black", null], default: null },
    reason: {
      type: String,
      enum: RESULT_TYPES,
    },
    score: { type: String, enum: ["1-0", "0-1", "1/2-1/2"] },
  },
  { _id: false }
);

const GameSchema = new Schema<IGame>({
  players: {
    type: [PlayerSchema],
    required: true,
    validate: (v: IPlayer[]) => v.length === 2,
  },

  status: {
    type: String,
    enum: ["completed", "on-going"],
    default: "on-going",
  },

  initialFen: { type: String, required: true, default: "" },
  moves: { type: [MoveSchema], required: true, default: [] },
  fenHistory: { type: [String], default: [] },
  pgn: { type: String, required: true, default: "" },

  result: { type: ResultSchema, required: true },

  variant: { type: String, enum: Object.values(GAME_VARIANTS), required: true },
  timeControl: {
    time: {
      type: Number,
      required: true,
    },
    increment: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date },
});

GameSchema.index({ "players.userId": 1 });
GameSchema.index({ endedAt: -1 });

const GameModel = mongoose.model<IGame>("Game", GameSchema);

export default GameModel;
