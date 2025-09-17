import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  username: string;
  email: string;
  clerkId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const UserSchema: Schema<IUser> = new Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      trim: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [20, "Username cannot exceed 20 characters"],
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email",
      ],
    },
    clerkId: {
      type: String,
      required: [true, "ClerkId is required"],
      unique: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Add indexes for better query performance
UserSchema.index({ username: 1, email: 1 });

const UserModel = mongoose.model<IUser>("User", UserSchema);

export default UserModel;
