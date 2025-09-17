import mongoose, { Document, Schema, Types } from "mongoose";

// Define rating structure interface
interface IRating {
  rapid: number;
  blitz: number;
  bullet: number;
}

export interface IUserProfile extends Document {
  userId: Types.ObjectId;
  rating: IRating;
  totalGames?: number;
  wins?: number;
  losses?: number;
  draws?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const RatingSchema = new Schema<IRating>(
  {
    rapid: {
      type: Number,
      default: 400,
      min: [0, "Rating cannot be negative"],
      max: [4000, "Rating cannot exceed 4000"],
    },
    blitz: {
      type: Number,
      default: 400,
      min: [0, "Rating cannot be negative"],
      max: [4000, "Rating cannot exceed 4000"],
    },
    bullet: {
      type: Number,
      default: 400,
      min: [0, "Rating cannot be negative"],
      max: [4000, "Rating cannot exceed 4000"],
    },
  },
  { _id: false }
);

const UserProfileSchema = new Schema<IUserProfile>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: [true, "User ID is required"],
      ref: "User",
      unique: true,
      index: true,
    },
    rating: {
      type: RatingSchema,
      required: true,
      default: () => ({
        rapid: 400,
        blitz: 400,
        bullet: 400,
      }),
    },
    totalGames: {
      type: Number,
      default: 0,
      min: [0, "Total games cannot be negative"],
    },
    wins: {
      type: Number,
      default: 0,
      min: [0, "Wins cannot be negative"],
    },
    losses: {
      type: Number,
      default: 0,
      min: [0, "Losses cannot be negative"],
    },
    draws: {
      type: Number,
      default: 0,
      min: [0, "Draws cannot be negative"],
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Add virtual for win rate
UserProfileSchema.virtual("winRate").get(function (this: IUserProfile) {
  if (this.totalGames === 0) return 0;
  return ((this.wins || 0) / (this.totalGames || 1)) * 100;
});

// Add index for better query performance
UserProfileSchema.index({ userId: 1 });

const UserProfileModel = mongoose.model<IUserProfile>(
  "UserProfile",
  UserProfileSchema
);

export default UserProfileModel;
