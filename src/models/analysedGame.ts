import mongoose, { Schema, Document, Types } from "mongoose";

// Interface for individual move analysis
interface IMoveAnalysis {
  moveNumber: number;
  move: string;
  evaluation?: number; // Engine evaluation (centipawns)
  bestMove?: string;
  accuracy?: number; // Move accuracy percentage
  classification?:
    | "book"
    | "excellent"
    | "good"
    | "inaccuracy"
    | "mistake"
    | "blunder";
  timeSpent?: number; // Time spent on this move in milliseconds
}

// Interface for game analysis result
export interface IAnalysedGame extends Document {
  gameId: Types.ObjectId;
  userId: Types.ObjectId; // User who requested the analysis
  engineName?: string; // e.g., "Stockfish 15"
  engineDepth?: number; // Analysis depth
  analysisDate: Date;

  // Overall game analysis
  whiteAccuracy?: number; // Average accuracy for white
  blackAccuracy?: number; // Average accuracy for black
  totalMoves: number;

  // Move-by-move analysis
  moveAnalysis: IMoveAnalysis[];

  // Game classification
  openingName?: string;
  gamePhases?: {
    opening: number; // Number of opening moves
    middlegame: number; // Number of middlegame moves
    endgame: number; // Number of endgame moves
  };

  // Analysis completion status
  status: "pending" | "analyzing" | "completed" | "failed";
  errorMessage?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

const MoveAnalysisSchema = new Schema<IMoveAnalysis>(
  {
    moveNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    move: {
      type: String,
      required: true,
      trim: true,
    },
    evaluation: {
      type: Number,
      // Evaluation in centipawns (positive = advantage for white)
    },
    bestMove: {
      type: String,
      trim: true,
    },
    accuracy: {
      type: Number,
      min: 0,
      max: 100,
    },
    classification: {
      type: String,
      enum: ["book", "excellent", "good", "inaccuracy", "mistake", "blunder"],
    },
    timeSpent: {
      type: Number,
      min: 0,
    },
  },
  { _id: false }
);

const AnalysedGameSchema: Schema<IAnalysedGame> = new Schema(
  {
    gameId: {
      type: Schema.Types.ObjectId,
      required: [true, "Game ID is required"],
      ref: "Game",
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: [true, "User ID is required"],
      ref: "User",
      index: true,
    },
    engineName: {
      type: String,
      default: "Stockfish 15",
      trim: true,
    },
    engineDepth: {
      type: Number,
      default: 20,
      min: 1,
      max: 50,
    },
    analysisDate: {
      type: Date,
      default: Date.now,
    },
    whiteAccuracy: {
      type: Number,
      min: 0,
      max: 100,
    },
    blackAccuracy: {
      type: Number,
      min: 0,
      max: 100,
    },
    totalMoves: {
      type: Number,
      required: true,
      min: 0,
    },
    moveAnalysis: {
      type: [MoveAnalysisSchema],
      default: [],
    },
    openingName: {
      type: String,
      trim: true,
    },
    gamePhases: {
      opening: {
        type: Number,
        default: 0,
        min: 0,
      },
      middlegame: {
        type: Number,
        default: 0,
        min: 0,
      },
      endgame: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    status: {
      type: String,
      enum: ["pending", "analyzing", "completed", "failed"],
      default: "pending",
      index: true,
    },
    errorMessage: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Add compound indexes for better query performance
AnalysedGameSchema.index({ gameId: 1, userId: 1 });
AnalysedGameSchema.index({ userId: 1, analysisDate: -1 });
AnalysedGameSchema.index({ status: 1, createdAt: 1 });

// Add virtual for average accuracy
AnalysedGameSchema.virtual("averageAccuracy").get(function (
  this: IAnalysedGame
) {
  if (!this.whiteAccuracy || !this.blackAccuracy) return null;
  return (this.whiteAccuracy + this.blackAccuracy) / 2;
});

const AnalysedGameModel = mongoose.model<IAnalysedGame>(
  "AnalysedGame",
  AnalysedGameSchema
);

export default AnalysedGameModel;
