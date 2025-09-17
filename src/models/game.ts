import mongoose, { Schema, Document, Types } from "mongoose";
import { GAME_VARIANTS, PLAYER_COLOR, RESULT_TYPES } from "../constants";
import {
  TimeControl,
  PlayerColor,
  GameStatus,
  GameResult,
  Winner,
  DEFAULT_FEN,
} from "../types/game";

// Mongoose Document interfaces (extend Document for persistence)
export interface IPlayer extends Document {
  userId: Types.ObjectId;
  color: PlayerColor;
  preRating: number;
  postRating?: number | null;
}

export interface IMove extends Document {
  move: string;
  from?: string;
  to?: string;
  timeStamp: Date;
}

export interface IResult extends Document {
  winner: Winner;
  reason?: RESULT_TYPES;
  score?: GameResult;
}

export interface IGame extends Document {
  players: IPlayer[];
  status: GameStatus;
  initialFen: string;
  moves: IMove[];
  fenHistory?: string[];
  pgn: string;
  result?: IResult;
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
    color: {
      type: String,
      enum: ["white", "black"],
      required: true,
    },
    preRating: {
      type: Number,
      required: true,
      min: 0,
      max: 4000,
    },
    postRating: {
      type: Number,
      default: null,
      min: 0,
      max: 4000,
    },
  },
  { _id: false }
);

const MoveSchema = new Schema<IMove>(
  {
    move: {
      type: String,
      required: true,
      trim: true,
    },
    from: {
      type: String,
      trim: true,
    },
    to: {
      type: String,
      trim: true,
    },
    timeStamp: {
      type: Date,
      required: true,
      default: Date.now,
    },
  },
  { _id: false }
);

const ResultSchema = new Schema<IResult>(
  {
    winner: {
      type: String,
      enum: ["white", "black", null],
      default: null,
    },
    reason: {
      type: String,
      enum: Object.values(RESULT_TYPES),
    },
    score: {
      type: String,
      enum: ["1-0", "0-1", "1/2-1/2"],
    },
  },
  { _id: false }
);

const GameSchema = new Schema<IGame>(
  {
    players: {
      type: [PlayerSchema],
      required: true,
      validate: {
        validator: (v: IPlayer[]) => v.length === 2,
        message: "A game must have exactly 2 players",
      },
    },

    status: {
      type: String,
      enum: ["completed", "on-going"],
      default: "on-going",
    },

    initialFen: {
      type: String,
      required: true,
      default: DEFAULT_FEN,
    },

    moves: {
      type: [MoveSchema],
      required: true,
      default: [],
    },

    fenHistory: {
      type: [String],
      default: [],
    },

    pgn: {
      type: String,
      required: true,
      default: "",
    },

    result: {
      type: ResultSchema,
      required: false,
    },

    variant: {
      type: String,
      enum: Object.values(GAME_VARIANTS),
      required: true,
    },

    timeControl: {
      time: {
        type: Number,
        required: true,
        min: 1,
      },
      increment: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
      },
    },

    startedAt: {
      type: Date,
      default: Date.now,
    },

    endedAt: {
      type: Date,
    },
  },
  {
    timestamps: true, // This adds createdAt and updatedAt automatically
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

GameSchema.index({ "players.userId": 1 });
GameSchema.index({ endedAt: -1 });

const GameModel = mongoose.model<IGame>("Game", GameSchema);

export default GameModel;
