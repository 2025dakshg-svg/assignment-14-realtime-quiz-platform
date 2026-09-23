const {
  createRoom,
  deleteRoom,
  getRoom,
  startGame,
  MAX_PLAYERS,
} = require("./gameEngine");

const MAX_NAME_LENGTH = 24;

const sanitizeName = (raw) => (raw || "").toString().trim().slice(0, MAX_NAME_LENGTH);

const serializeLobby = (room) => ({
  players: room.players.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    connected: p.connected,
  })),
});

const broadcastLobby = (io, room) => {
  io.to(room.roomId).emit("lobby:update", {
    pin: room.pin,
    category: room.category,
    hostName: room.hostName,
    players: serializeLobby(room).players,
  });
};

const setupLobbySocket = (io, socket) => {
  socket.on("quiz:create", (payload) => {
    const room = createRoom({
      hostName: payload && payload.hostName,
      category: payload && payload.category,
    });

    socket.data.pin = room.pin;
    socket.data.role = "host";
    room.hostSocketId = socket.id;
    socket.join(room.roomId);

    socket.emit("quiz:created", {
      pin: room.pin,
      roomId: room.roomId,
      category: room.category,
    });

    broadcastLobby(io, room);
  });

  socket.on("quiz:join", (payload) => {
    const pin = (payload && payload.pin || "").toString().trim();
    const room = getRoom(pin);
    const playerName = sanitizeName(payload && payload.playerName);

    if (!room) {
      socket.emit("quiz:error", { message: "No quiz found with that PIN. Double-check with the host." });
      return;
    }

    if (!playerName) {
      socket.emit("quiz:error", { message: "Player name is required." });
      return;
    }

    if (room.status !== "lobby") {
      socket.emit("quiz:error", { message: "This quiz has already started. You cannot join." });
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("quiz:error", { message: `Lobby is full (max ${MAX_PLAYERS} players).` });
      return;
    }

    if (room.players.some((p) => p.name.toLowerCase() === playerName.toLowerCase())) {
      socket.emit("quiz:error", { message: `"${playerName}" is already in this lobby. Choose another name.` });
      return;
    }

    const player = {
      id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: playerName,
      score: 0,
      correctCount: 0,
      answeredCount: 0,
      answeredCurrent: false,
      selectedOption: null,
      lastResult: null,
      connected: true,
    };

    room.players.push(player);
    room.playerSockets.set(socket.id, player.id);

    socket.data.pin = room.pin;
    socket.data.role = "player";
    socket.join(room.roomId);

    socket.emit("player:joined", {
      playerId: player.id,
      name: player.name,
      pin: room.pin,
      roomId: room.roomId,
      category: room.category,
      hostName: room.hostName,
    });

    broadcastLobby(io, room);
  });

  socket.on("quiz:start", (payload) => {
    const pin = (payload && payload.pin || "").toString().trim();
    const room = getRoom(pin);

    if (!room) {
      socket.emit("quiz:error", { message: "Quiz room not found." });
      return;
    }

    if (socket.data.role !== "host" || socket.id !== room.hostSocketId) {
      socket.emit("quiz:error", { message: "Only the host can start the quiz." });
      return;
    }

    if (room.status !== "lobby") {
      socket.emit("quiz:error", { message: "Quiz has already started." });
      return;
    }

    if (room.players.length === 0) {
      socket.emit("quiz:error", { message: "Wait for at least one player to join." });
      return;
    }

    startGame(io, room);
  });

  socket.on("disconnect", () => {
    const pin = socket.data && socket.data.pin;
    if (!pin) return;

    const room = getRoom(pin);
    if (!room) return;

    if (socket.data.role === "host") {
      console.log(`[lobby] Host left quiz ${pin} — closing room`);
      deleteRoom(pin);
      return;
    }

    const playerId = room.playerSockets.get(socket.id);
    if (!playerId) return;

    room.playerSockets.delete(socket.id);
    const player = room.players.find((p) => p.id === playerId);
    if (!player) return;

    player.connected = false;

    if (room.status === "lobby") {
      room.players = room.players.filter((p) => p.id !== playerId);
    }

    broadcastLobby(io, room);
  });
};

module.exports = { setupLobbySocket, sanitizeName };