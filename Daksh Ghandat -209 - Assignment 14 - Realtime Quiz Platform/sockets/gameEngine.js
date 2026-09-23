const fs = require("fs");
const path = require("path");
const QuizGame = require("../models/QuizGame");

const TIME_LIMIT_MS = 15000;
const TICK_MS = 250;
const BETWEEN_QUESTIONS_MS = 4000;
const START_DELAY_MS = 3000;
const ROOM_TTL_AFTER_END_MS = 2 * 60 * 1000;
const MAX_PLAYERS = 8;
const MAX_QUESTIONS = 5;

const questionPath = path.join(__dirname, "..", "data", "questions.json");
const rawBank = JSON.parse(fs.readFileSync(questionPath, "utf8"));
const QUESTION_BANK = Array.isArray(rawBank) ? rawBank : rawBank.questions || [];

const quizRooms = new Map();
let playerSeq = 0;

const shuffle = (list) => {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const generatePin = () => {
  let pin;
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
  } while (quizRooms.has(pin));
  return pin;
};

const createRoom = ({ hostName, category }) => {
  const pin = generatePin();
  const room = {
    pin,
    roomId: `quiz_${pin}`,
    hostName: (hostName || "Host").toString().trim().slice(0, 24) || "Host",
    category: (category || "All").toString().trim().slice(0, 24) || "All",
    hostSocketId: null,
    players: [],
    playerSockets: new Map(),
    status: "lobby",
    questions: [],
    currentQuestionIndex: -1,
    roundStartedAt: 0,
    ticker: null,
    phaseTimer: null,
    durationSeconds: 0,
    startedAt: 0,
  };
  quizRooms.set(pin, room);
  return room;
};

const getRoom = (pin) => quizRooms.get(pin);

const deleteRoom = (pin) => {
  const room = quizRooms.get(pin);
  if (!room) return;
  if (room.ticker) clearInterval(room.ticker);
  if (room.phaseTimer) clearTimeout(room.phaseTimer);
  quizRooms.delete(pin);
};

const getQuestionBank = () => QUESTION_BANK;

const getCategories = () => {
  const set = new Set(QUESTION_BANK.map((q) => q.category).filter(Boolean));
  return ["All", ...set];
};

const pickQuestions = (category) => {
  let pool = QUESTION_BANK;
  if (category && category !== "All") {
    pool = pool.filter((q) => q.category === category);
  }
  if (pool.length === 0) pool = QUESTION_BANK;
  return shuffle(pool).slice(0, Math.min(MAX_QUESTIONS, pool.length));
};

const calculateScore = (isCorrect, timeTakenMs, totalTimeLimitMs = TIME_LIMIT_MS) => {
  if (!isCorrect) return 0;
  if (timeTakenMs >= totalTimeLimitMs) return 0;
  const timeRemaining = Math.max(0, totalTimeLimitMs - timeTakenMs);
  const speedBonus = Math.round((timeRemaining / totalTimeLimitMs) * 500);
  const baseScore = 500;
  return baseScore + speedBonus;
};

const buildLeaderboard = (room) => {
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  return sorted.map((p, i) => ({
    rank: i + 1,
    name: p.name,
    score: p.score,
    correctCount: p.correctCount,
    connected: p.connected,
  }));
};

const emitLeaderboard = (io, room) => {
  io.to(room.roomId).emit("leaderboard:update", {
    leaderboard: buildLeaderboard(room),
  });
};

const getPlayerBySocket = (room, socketId) => {
  const playerId = room.playerSockets.get(socketId);
  if (!playerId) return null;
  return room.players.find((p) => p.id === playerId) || null;
};

const startGame = (io, room) => {
  if (room.status !== "lobby") return;

  room.questions = pickQuestions(room.category);
  room.currentQuestionIndex = -1;
  room.startedAt = Date.now();
  room.status = "starting";

  room.players.forEach((p) => {
    p.score = 0;
    p.correctCount = 0;
    p.answeredCount = 0;
    p.answeredCurrent = false;
    p.selectedOption = null;
    p.lastResult = null;
  });

  io.to(room.roomId).emit("quiz:starting", {
    startInSeconds: START_DELAY_MS / 1000,
    totalQuestions: room.questions.length,
    category: room.category,
  });

  room.phaseTimer = setTimeout(() => {
    startNextQuestion(io, room);
  }, START_DELAY_MS);
};

const startNextQuestion = (io, room) => {
  room.currentQuestionIndex += 1;

  if (room.currentQuestionIndex >= room.questions.length) {
    endGame(io, room);
    return;
  }

  const question = room.questions[room.currentQuestionIndex];
  room.status = "playing";
  room.roundStartedAt = Date.now();

  room.players.forEach((p) => {
    p.answeredCurrent = false;
    p.selectedOption = null;
    p.lastResult = null;
  });

  io.to(room.roomId).emit("question:start", {
    questionIndex: room.currentQuestionIndex + 1,
    totalQuestions: room.questions.length,
    question: question.question,
    options: question.options,
    timeLimitSeconds: TIME_LIMIT_MS / 1000,
  });

  startRoundTicker(io, room);
};

const startRoundTicker = (io, room) => {
  if (room.ticker) clearInterval(room.ticker);

  let lastBroadcastSecond = null;
  room.ticker = setInterval(() => {
    if (room.status !== "playing") return;

    const elapsed = Date.now() - room.roundStartedAt;
    const remainingMs = TIME_LIMIT_MS - elapsed;

    if (remainingMs <= 0) {
      clearInterval(room.ticker);
      room.ticker = null;
      endRound(io, room);
      return;
    }

    const remainingSeconds = Math.ceil(remainingMs / 1000);
    if (remainingSeconds !== lastBroadcastSecond) {
      lastBroadcastSecond = remainingSeconds;
      io.to(room.roomId).emit("question:countdown", {
        questionIndex: room.currentQuestionIndex + 1,
        remainingSeconds,
      });
    }
  }, TICK_MS);
};

const endRound = (io, room) => {
  room.status = "revealing";

  const question = room.questions[room.currentQuestionIndex];
  const answerCounts = question.options.map(() => 0);
  room.players.forEach((p) => {
    if (p.selectedOption !== null && p.selectedOption >= 0) {
      answerCounts[p.selectedOption] += 1;
    }
  });

  io.to(room.roomId).emit("question:time_up", {
    questionIndex: room.currentQuestionIndex + 1,
    correctOption: question.correctOption,
    explanation: question.explanation,
    answerDistribution: answerCounts,
  });

  emitLeaderboard(io, room);

  room.phaseTimer = setTimeout(() => {
    startNextQuestion(io, room);
  }, BETWEEN_QUESTIONS_MS);
};

const endGame = async (io, room) => {
  room.status = "ended";
  room.durationSeconds = Math.round((Date.now() - room.startedAt) / 1000);

  const finalRanks = room.players
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      id: p.id,
      rank: i + 1,
      name: p.name,
      score: p.score,
      correctCount: p.correctCount,
      connected: p.connected,
    }));

  const winner = finalRanks[0] || null;

  io.to(room.roomId).emit("quiz:ended", {
    winner: winner ? { name: winner.name, score: winner.score } : null,
    finalRanks,
  });

  await persistGame(room, finalRanks, winner);

  room.phaseTimer = setTimeout(() => {
    deleteRoom(room.pin);
  }, ROOM_TTL_AFTER_END_MS);
};

const persistGame = async (room, finalRanks, winner) => {
  try {
    await QuizGame.create({
      pin: room.pin,
      roomId: room.roomId,
      hostName: room.hostName,
      category: room.category,
      status: "completed",
      totalQuestions: room.questions.length,
      durationSeconds: room.durationSeconds,
      players: finalRanks.map((r) => ({
        playerId: r.id,
        name: r.name,
        score: r.score,
        correctCount: r.correctCount,
        answeredCount: r.correctCount,
        rank: r.rank,
        connected: r.connected,
      })),
      winner,
    });
    console.log(`[game] Persisted game ${room.pin} (${finalRanks.length} players)`);
  } catch (error) {
    console.error(`[game] Failed to persist game ${room.pin}: ${error.message}`);
  }
};

const setupGameSocket = (io, socket) => {
  socket.on("answer:submit", (payload) => {
    const room = getRoom(socket.data && socket.data.pin);
    if (!room) {
      socket.emit("error", { message: "Quiz room not found." });
      return;
    }

    const player = getPlayerBySocket(room, socket.id);
    if (!player) {
      socket.emit("error", { message: "You are not part of this quiz." });
      return;
    }

    if (room.status !== "playing") {
      socket.emit("answer:rejected", {
        reason: room.status === "lobby" ? "not_started" : "unavailable",
        message: "Answers are only accepted while a question is live.",
      });
      return;
    }

    if (player.answeredCurrent) {
      socket.emit("error", { message: "You already answered this question." });
      return;
    }

    const selectedOption = Number(payload && payload.selectedOption);
    if (
      !Number.isInteger(selectedOption) ||
      selectedOption < 0 ||
      !room.questions[room.currentQuestionIndex] ||
      selectedOption >= room.questions[room.currentQuestionIndex].options.length
    ) {
      socket.emit("error", { message: "Invalid option selected." });
      return;
    }

    const serverElapsedMs = Date.now() - room.roundStartedAt;
    if (serverElapsedMs > TIME_LIMIT_MS) {
      player.answeredCurrent = true;
      socket.emit("answer:rejected", {
        reason: "too_late",
        message: "Time is up — answer rejected.",
      });
      return;
    }

    const clientTimeTakenMs = Math.max(0, Math.min(Number(payload.timeTakenMs) || 0, TIME_LIMIT_MS));

    const question = room.questions[room.currentQuestionIndex];
    const isCorrect = selectedOption === question.correctOption;
    const timeTakenMs = Math.min(serverElapsedMs, clientTimeTakenMs || serverElapsedMs);
    const points = calculateScore(isCorrect, timeTakenMs);

    player.answeredCurrent = true;
    player.selectedOption = selectedOption;
    player.answeredCount += 1;
    player.lastResult = { isCorrect, points, selectedOption, timeTakenMs };

    if (isCorrect) {
      player.score += points;
      player.correctCount += 1;
    }

    socket.emit("answer:result", {
      isCorrect,
      selectedOption,
      correctOption: isCorrect ? null : question.correctOption,
      pointsAwarded: points,
      timeTakenMs,
    });

    const answered = room.players.filter((p) => p.answeredCurrent).length;
    io.to(room.roomId).emit("round:answers", {
      questionIndex: room.currentQuestionIndex + 1,
      answered,
      total: room.players.length,
    });

    emitLeaderboard(io, room);
  });
};

module.exports = {
  quizRooms,
  TIME_LIMIT_MS,
  MAX_PLAYERS,
  START_DELAY_MS,
  createRoom,
  getRoom,
  deleteRoom,
  getQuestionBank,
  getCategories,
  calculateScore,
  startGame,
  setupGameSocket,
};