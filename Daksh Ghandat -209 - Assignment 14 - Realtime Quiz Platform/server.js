const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const { Server } = require("socket.io");

require("dotenv").config();

const connectDB = require("./config/db");
const QuizGame = require("./models/QuizGame");
const { setupLobbySocket } = require("./sockets/lobbyHandler");
const { setupGameSocket, quizRooms, getCategories } = require("./sockets/gameEngine");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  maxHttpBufferSize: 1e6,
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    activeRooms: quizRooms.size,
    activeGames: Array.from(quizRooms.values()).map((r) => ({
      pin: r.pin,
      status: r.status,
      players: r.players.length,
    })),
  });
});

app.get("/api/categories", (req, res) => {
  res.json({ categories: getCategories() });
});

app.get("/api/games", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const games = await QuizGame.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("-__v")
      .lean();
    res.json({ games });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const start = async () => {
  if (process.env.MONGO_URI) {
    await connectDB();
  } else {
    console.warn("Warning: MONGO_URI is not set — quiz history will not be persisted.");
  }

  io.on("connection", (socket) => {
    console.log(`user:connect ${socket.id}`);

    setupLobbySocket(io, socket);
    setupGameSocket(io, socket);
  });

  const PORT = process.env.PORT || 5000;
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use (e.g. macOS AirPlay/ControlCenter). ` +
          `Set a different PORT in .env and retry.`
      );
    } else {
      console.error("Server error:", error.message);
    }
    process.exit(1);
  });

  server.listen(PORT, () => {
    console.log(`\nQuiz Battle server running at http://localhost:${PORT}`);
    console.log(`Host dashboard : http://localhost:${PORT}/host.html`);
    console.log(`Player pad     : http://localhost:${PORT}/player.html`);
    console.log(`Open both in separate tabs to battle!\n`);
  });
};

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});