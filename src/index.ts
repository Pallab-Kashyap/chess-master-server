import server from "./app";
import connectDB from "./config/DB";

const PORT = process.env.PORT || 3000

const startServer = async () => {
    try {
        await connectDB()
        server.listen(PORT, () => console.log(`Server running on port: ${PORT}`))
    } catch (error) {
        console.log(error)
        process.exit(1);
    }
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err);
  process.exit(1);
});

startServer()
