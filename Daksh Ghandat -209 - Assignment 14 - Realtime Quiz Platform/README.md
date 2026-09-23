# Assignment 14 — Real-Time Multiplayer Live Quiz Battle (Socket.io)

**Track:** Backend & Real-Time Web · **Level:** Advanced

A high-stakes, interactive **Real-Time Multiplayer Trivia & Quiz Battle Arena** (Kahoot / Quizizz-style) built with **Node.js, Express, Socket.io** and **MongoDB**. The server is the single source of truth: it drives the countdown clocks, validates every answer, awards speed-based bonuses, and broadcasts live leaderboards to every connected participant.

> Live demo: Host dashboard → `http://localhost:5005/host.html` · Player pad → `http://localhost:5005/player.html`

---

## ✨ Features

- 🎪 **PIN-based Lobby Management** — Host creates a room and gets a 4-digit PIN; players join until the quiz starts.
- 🧑‍🏫 **Asymmetric roles** — Host/Auth vs Player handled through a shared Socket.io room with role flags.
- ⏱️ **Server-driven synchronous timers** — The server (not the client) owns the 15s question clock and broadcasts `question:countdown` ticks every second. No client-side drift.
- 🔒 **Anti-cheat validation** — Answers submitted after the timer expires are rejected server-side (`answer:rejected`). The correct answer is never sent to clients before `question:time_up`.
- ⚡ **Speed-based scoring** — `500` base + up to `500` speed bonus, computed from the server-measured elapsed time (up to 1000 pts/question).
- 🏆 **Live leaderboard** — Sorted ranks broadcast after every round and after each submission.
- 🗄️ **MongoDB persistence** — Completed games (winner, final ranks, correct counts) are saved to `quiz_battle` database and browsable via `GET /api/games`.

---

## 🛠️ Tech Stack & Dependencies

```bash
npm init -y
npm install express socket.io cors dotenv mongoose
npm install -D nodemon
```

| Package      | Purpose                              |
| ------------ | ------------------------------------ |
| `express`    | HTTP server + static pages + REST API |
| `socket.io`  | Real-time bidirectional events       |
| `cors`       | Cross-origin access for test clients |
| `dotenv`     | `.env` config (PORT, MONGO_URI)      |
| `mongoose`   | MongoDB ODM for quiz-history storage |
| `nodemon`    | Dev auto-restart                    |

---

## 📁 Directory Structure

```
assignment-14-quiz-socket/
├── public/
│   ├── index.html           # Host / Player entry portal
│   ├── host.html            # Host control screen (live question + leaderboard)
│   ├── player.html          # Mobile-friendly 4-color answer grid
│   ├── style.css            # Shared UI styles
│   └── app.js               # Client socket handlers (role-aware)
├── data/
│   └── questions.json       # Question bank (category, options, correctOption, explanation)
├── sockets/
│   ├── gameEngine.js        # Timers, round transitions, scoring & leaderboard sorting
│   └── lobbyHandler.js      # PIN generation & player joining
├── config/
│   └── db.js                # MongoDB connection
├── models/
│   └── QuizGame.js          # Persisted game/results model
├── server.js                # Express + Socket.io bootstrap, REST endpoints
├── .env                     # PORT + MONGO_URI credentials
├── .env.example
└── README.md
```

---

## 🚀 Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#  PORT=5000
#  MONGO_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/quiz_battle

# 3. Start the server
npm start        # or: npm run dev (nodemon)
```

> **Port note:** the assignment spec runs on `http://localhost:5000`, which is what the code defaults to when `PORT` is unset. On macOS, AirPlay (ControlCenter) sometimes squats port **5000**, and other local projects may take **5001** — this repo's `.env` therefore ships with `PORT=5005` so it runs out-of-the-box. Change `.env` freely.

When the server starts it connects to the MongoDB server (same Atlas cluster used across the previous assignments, `database: quiz_battle`). If MongoDB is unreachable the server still boots and runs fully in-memory.

---

## 🎮 Game Flow & State Machine

```
[Host Creates Room (PIN)]
        ⬇
[Players Join Lobby via PIN]
        ⬇
[Host Clicks "Start Game"]
        ⬇
[Server Broadcasts Question & Starts 15s Timer]
        ⬇
[Players Submit Answers (Server Calculates Speed Score)]
        ⬇
[Timer Expires ➔ Server Reveals Correct Answer & Broadcasts Live Leaderboard]
        ⬇
[Next Question or Final Winner Screen]
```

Room lifecycle: `lobby → starting → playing → revealing → ended` (room auto-deleted 2 min after finish).

---

## 📡 Socket Event Protocol

### 🎪 Lobby & Game Control
| Event | Direction | Payload / Description |
| --- | --- | --- |
| `quiz:create` | Host → Server | `{ hostName, category }` — creates room + 4-digit PIN |
| `quiz:created` | Server → Host | `{ pin, roomId, category }` |
| `quiz:join` | Player → Server | `{ pin, playerName }` — validates PIN, name, duplicates & full lobby |
| `player:joined` | Server → Player | `{ playerId, name, pin, hostName, category }` |
| `lobby:update` | Server → Room | `{ pin, category, hostName, players: [{id, name, score, connected}] }` |
| `quiz:start` | Host → Server | `{ pin }` (host-only, requires ≥1 player) |
| `quiz:starting` | Server → Room | `{ startInSeconds, totalQuestions, category }` |
| `quiz:error` | Server → Sender | `{ message }` — join/start validation errors |

### ⏱️ Question Round & Live Gameplay
| Event | Direction | Payload / Description |
| --- | --- | --- |
| `question:start` | Server → Room | `{ questionIndex, totalQuestions, question, options[], timeLimitSeconds }` — **no correct answer** |
| `question:countdown` | Server → Room | `{ questionIndex, remainingSeconds }` — 1 Hz sync ticks |
| `answer:submit` | Player → Server | `{ pin, selectedOption, timeTakenMs }` |
| `answer:result` | Server → Player | `{ isCorrect, selectedOption, correctOption?, pointsAwarded, timeTakenMs }` |
| `answer:rejected` | Server → Player | `{ reason, message }` — too late / non-live window |
| `round:answers` | Server → Room | `{ questionIndex, answered, total }` — live answered counter |
| `question:time_up` | Server → Room | `{ correctOption, explanation, answerDistribution[] }` |
| `leaderboard:update` | Server → Room | `{ leaderboard: [{ rank, name, score, correctCount }] }` |
| `quiz:ended` | Server → Room | `{ winner: {name, score}, finalRanks[] }` |
| `error` | Server → Sender | generic socket errors |

---

## 🧮 Server-Side Scoring Algorithm

```js
// Score = Base (500) + Speed Bonus (up to 500)  → max 1000 pts per question
function calculateScore(isCorrect, timeTakenMs, totalTimeLimitMs = 15000) {
  if (!isCorrect) return 0;
  const timeRemaining = Math.max(0, totalTimeLimitMs - timeTakenMs);
  const speedBonus = Math.round((timeRemaining / totalTimeLimitMs) * 500);
  const baseScore = 500;
  return baseScore + speedBonus;
}
```

Anti-cheat details:

- The **server measures elapsed time** from `roundStartedAt` — a client-claimed `timeTakenMs` is clamped but the server independently rejects any submission arriving after `Date.now() - roundStartedAt > 15000`.
- One answer per player per question (`answeredCurrent` flag).
- `selectedOption` must be a valid index within the current question's options.
- Submissions while the round is not `playing` (before start, or after time-up) are rejected.
- The correct answer is never broadcast in `question:start`.

---

## 🧪 Testing & Verification Guide

1. `npm start` and open `http://localhost:5005`.
2. **Tab 1:** Host view → enter a name, pick **Tech**, click **Create Quiz**, note the 4-digit PIN.
3. **Tab 2 & 3:** Player view → enter the PIN as "Player 1" and "Player 2".
4. From the host screen click **Start Game**.
5. Answer fast on Player 1; wait ~10s before answering on Player 2.
6. ✅ Player 1 scores more points (speed bonus: fast ≈ 1000, slow ≈ 700).
7. ✅ Neither player can submit after the timer expires — the server sends `answer:rejected` and late submissions are ignored.
8. Open `http://localhost:5005/api/games` to see the completed battle persisted in MongoDB.

A scripted 3-socket E2E run was used during development to verify: room creation, duplicate + late-join rejections, speed-based scoring, post-expiry rejection, leaderboard ranks, `quiz:ended` and MongoDB persistence.

---

## 🔌 REST Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | server status + active rooms |
| `GET /api/categories` | categories available from `questions.json` |
| `GET /api/games?limit=20` | last completed games from MongoDB |

---

## 📊 Grading Rubric Coverage

| Evaluation Component | Marks | Where |
| --- | --- | --- |
| Lobby & PIN-based room management | 25 | `sockets/lobbyHandler.js` |
| Server-controlled synchronous clocks | 25 | `sockets/gameEngine.js` (ticker + `question:countdown`) |
| Speed scoring & anti-cheat | 20 | `calculateScore` + `answer:submit` validation |
| Real-time leaderboard & ranks | 15 | `buildLeaderboard`, `leaderboard:update` |
| Dual interface (host + player) | 15 | `public/host.html`, `public/player.html` |

---

## 📤 Submission

Repository name: **`itm-assignment-14-quiz-socket`**. Include the sample questions in `data/questions.json` and a short video demo of a 3-player battle.