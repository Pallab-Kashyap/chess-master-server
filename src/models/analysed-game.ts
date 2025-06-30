import mongoose, { Schema, Document, Types } from "mongoose";

export interface IAnalysis extends Document {
  username: string;
  email: string;
  clerkId: string;
}

const AnalysisSchema: Schema<IAnalysis> = new Schema({
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

const AnalysisModel = mongoose.model<IAnalysis>("Analysis", AnalysisSchema);

export default AnalysisModel;
