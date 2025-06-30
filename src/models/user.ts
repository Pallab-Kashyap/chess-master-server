import mongoose, { Schema, Document, Types } from "mongoose";

export interface IUser extends Document {
  username: string;
  email: string;
  clerkId: string;
}

const UserSchema: Schema<IUser> = new Schema({
  username: {
    type: String,
    required: [true, "username is required"],
  },
  email: {
    type: String,
    required: [true, "email is required"],
  },
  clerkId: {
    type: String,
    required: [true, "clerkId is required"],
  },
});

const UserModel = mongoose.model<IUser>("User", UserSchema);

export default UserModel;
