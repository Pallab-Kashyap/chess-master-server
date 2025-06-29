import { Server } from "socket.io";
import server from "../app";

const io = new Server(server)

export default io
