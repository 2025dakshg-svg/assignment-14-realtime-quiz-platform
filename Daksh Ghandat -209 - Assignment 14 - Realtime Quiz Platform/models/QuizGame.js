const mongoose = require("mongoose");

const playerResultSchema = new mongoose.Schema(
  {
    playerId: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    score: { type: Number, default: 0 },
    correctCount: { type: Number, default: 0 },
    answeredCount: { type: Number, default: 0 },
    rank: { type: Number, default: 0 },
    connected: { type: Boolean, default: true },
  },
  { _id: false }
);

const quizGameSchema = new mongoose.Schema(
  {
    pin: { type: String, required: true, unique: true },
    roomId: { type: String, required: true },
    hostName: { type: String, default: "Host" },
    category: { type: String, default: "All" },
    status: { type: String, default: "completed" },
    totalQuestions: { type: Number, default: 0 },
    durationSeconds: { type: Number, default: 0 },
    players: { type: [playerResultSchema], default: [] },
    winner: {
      name: { type: String },
      score: { type: Number },
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
    versionKey: false,
  }
);

quizGameSchema.index({ createdAt: -1 });

const QuizGame = mongoose.model("QuizGame", quizGameSchema);

module.exports = QuizGame;