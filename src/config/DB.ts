import mongoose from "mongoose";

const connectDB = async () => {
  const db_url =
    process.env.NODE_ENV === "development"
      ? process.env.DB_CONNECTION_URL_DEV
      : process.env.DB_CONNECTION_URL_PROD;

  if (!db_url) {
    throw new Error("DB_CONNECTION_URL missing");
  } else {
    await mongoose.connect(db_url);
  }
};

export default connectDB;
