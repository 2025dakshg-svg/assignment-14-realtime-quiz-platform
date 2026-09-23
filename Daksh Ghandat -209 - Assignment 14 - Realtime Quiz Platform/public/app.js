/* Assignment 14 — Quiz Battle Arena client socket handlers */
(function () {
  "use strict";

  const role = document.body.dataset.role;
  const socket = io();

  const $ = (id) => document.getElementById(id);
  const show = (id) => {
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    $(id).classList.remove("hidden");
  };
  const RING_C = 2 * Math.PI * 52;

  const setTimer = (seconds, maxSeconds) => {
    const num = document.querySelector(".timer-num");
    const fg = $("timerFg");
    const max = maxSeconds || 15;
    const clamped = Math.max(0, Math.min(seconds, max));
    if (num) num.textContent = String(clamped);
    if (fg) {
      fg.style.strokeDashoffset = String(RING_C * (1 - clamped / max));
      fg.classList.toggle("low", clamped <= 5);
    }
  };

  const answerColors = [
    ["A", "btn-red"],
    ["B", "btn-blue"],
    ["C", "btn-yellow"],
    ["D", "btn-green"],
  ];

  /* =====================================================
     HOST DASHBOARD
  ===================================================== */
  if (role === "host") {
    let pin = null;
    let players = [];

    fetch("/api/categories")
      .then((r) => r.json())
      .then((data) => {
        const sel = $("categorySelect");
        sel.innerHTML = "";
        (data.categories || ["All"]).forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c;
          opt.textContent = c;
          sel.appendChild(opt);
        });
      })
      .catch(() => {
        const sel = $("categorySelect");
        sel.innerHTML = '<option value="All">All</option>';
      });

    $("btnCreateQuiz").addEventListener("click", () => {
      const hostName = $("hostName").value.trim() || "Host";
      const category = $("categorySelect").value || "All";
      $("createErr").classList.add("hidden");
      socket.emit("quiz:create", { hostName, category });
    });

    socket.on("quiz:created", (data) => {
      pin = data.pin;
      $("topbarMeta").textContent = "Game PIN:";
      $("pinDisplay").textContent = data.pin;
      $("lobbyCategory").textContent = "Category: " + data.category;
      $("btnStartGame").disabled = true;
      show("view-lobby");
    });

    socket.on("lobby:update", (data) => {
      players = data.players || [];
      const roster = $("rosterHost");
      roster.innerHTML = "";
      $("playerCount").textContent = players.length;
      if (players.length === 0) {
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = "No players yet — share the PIN!";
        roster.appendChild(li);
      }
      players.forEach((p) => {
        const li = document.createElement("li");
        const dot = document.createElement("span");
        dot.className = "dot" + (p.connected ? "" : " offline");
        const name = document.createElement("span");
        name.textContent = p.name;
        li.appendChild(dot);
        li.appendChild(name);
        roster.appendChild(li);
      });
      $("btnStartGame").disabled = players.length === 0;
      $("startErr").classList.add("hidden");
    });

    $("btnStartGame").addEventListener("click", () => {
      if (!pin) return;
      $("startErr").classList.add("hidden");
      socket.emit("quiz:start", { pin });
    });

    socket.on("quiz:starting", (data) => {
      show("view-game");
      $("hostQuestion").textContent = `Get ready! ${data.totalQuestions} questions, starting in ${data.startInSeconds}…`;
      $("hostOptions").innerHTML = "";
      $("revealBox").classList.add("hidden");
      setTimer(data.startInSeconds, data.startInSeconds);
    });

    socket.on("question:start", (data) => {
      show("view-game");
      $("qCounter").textContent = `Q ${data.questionIndex} / ${data.totalQuestions}`;
      $("roundTicker").textContent = `0/${players.length || 0} answered`;
      $("hostQuestion").textContent = data.question;
      $("revealBox").classList.add("hidden");
      setTimer(data.timeLimitSeconds, data.timeLimitSeconds);

      const box = $("hostOptions");
      box.innerHTML = "";
      data.options.forEach((opt, i) => {
        const el = document.createElement("div");
        el.className = "option-box";
        el.dataset.index = i;
        el.textContent = `${String.fromCharCode(65 + i)}. ${opt}`;
        box.appendChild(el);
      });
    });

    socket.on("question:countdown", (data) => {
      setTimer(data.remainingSeconds, 15);
    });

    socket.on("round:answers", (data) => {
      $("roundTicker").textContent = `${data.answered}/${data.total} answered`;
    });

    socket.on("question:time_up", (data) => {
      const box = $("hostOptions");
      Array.from(box.children).forEach((el, i) => {
        el.classList.toggle("correct", i === data.correctOption);
        el.classList.toggle("incorrect", i !== data.correctOption);
      });

      const qtext = $("hostQuestion");
      const correctLabel = box.children[data.correctOption]
        ? box.children[data.correctOption].textContent
        : `Option ${String.fromCharCode(65 + data.correctOption)}`;
      $("revealAnswer").textContent = qtext.textContent + " → " + correctLabel;
      $("revealExpl").textContent = data.explanation;

      const total = (data.answerDistribution || []).reduce((a, b) => a + b, 0) || 1;
      const bars = $("distBars");
      bars.innerHTML = "";
      data.answerDistribution.forEach((count, i) => {
        const row = document.createElement("div");
        row.className = "dist-row";
        const label = document.createElement("span");
        label.textContent = String.fromCharCode(65 + i);
        const track = document.createElement("div");
        track.className = "dist-track";
        const fill = document.createElement("div");
        fill.className = "dist-fill";
        fill.style.width = Math.round((count / total) * 100) + "%";
        track.appendChild(fill);
        const num = document.createElement("span");
        num.textContent = count;
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(num);
        bars.appendChild(row);
      });

      $("revealBox").classList.remove("hidden");
    });

    socket.on("leaderboard:update", (data) => {
      const ol = $("hostLeaderboard");
      ol.innerHTML = "";
      data.leaderboard.forEach((row, i) => {
        const li = document.createElement("li");
        li.className = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
        const rank = document.createElement("span");
        rank.className = "rank";
        rank.textContent = row.rank;
        const name = document.createElement("span");
        name.className = "leader-name";
        name.textContent = row.name;
        const score = document.createElement("span");
        score.className = "leader-score";
        score.textContent = row.score;
        li.appendChild(rank);
        li.appendChild(name);
        li.appendChild(score);
        ol.appendChild(li);
      });
    });

    socket.on("quiz:ended", (data) => {
      $("winnerBox").textContent = data.winner
        ? `${data.winner.name} wins with ${data.winner.score} points!`
        : "No winner this time.";

      const ol = $("finalRanks");
      ol.innerHTML = "";
      data.finalRanks.forEach((row, i) => {
        const li = document.createElement("li");
        li.className = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
        li.innerHTML = `<span class="rank">${row.rank}</span><span class="leader-name">${row.name}</span><span class="leader-score">${row.score} pts</span>`;
        ol.appendChild(li);
      });
      show("view-results");
    });

    socket.on("quiz:error", (d) => {
      $("startErr").textContent = (d && d.message) || "Something went wrong.";
      $("startErr").classList.remove("hidden");
    });

    socket.on("error", (d) => {
      $("startErr").textContent = (d && d.message) || "Something went wrong.";
      $("startErr").classList.remove("hidden");
    });
  }

  /* =====================================================
     PLAYER GAME PAD
  ===================================================== */
  if (role === "player") {
    let pin = null;
    let myPlayerId = null;
    let myScore = 0;
    let answered = false;
    let roundStartAt = 0;
    let correctOption = null;
    let myOption = null;

    const renderPad = (options) => {
      const pad = $("answerPad");
      pad.innerHTML = "";
      answerColors.forEach(([letter, cls], i) => {
        const btn = document.createElement("button");
        btn.className = "answer-btn " + cls;
        btn.dataset.index = i;
        btn.textContent = letter;
        btn.addEventListener("click", () => submitAnswer(i));
        pad.appendChild(btn);
      });
    };

    const submitAnswer = (index) => {
      if (answered) return;
      answered = true;
      myOption = index;

      const timeTakenMs = Math.max(0, Date.now() - roundStartAt);
      socket.emit("answer:submit", { pin, selectedOption: index, timeTakenMs });

      disablePad();
      const fb = $("playerFeedback");
      fb.textContent = "Answer locked in…";
      fb.className = "player-feedback";
      fb.classList.remove("hidden");
    };

    const disablePad = () => {
      document.querySelectorAll(".answer-btn").forEach((b) => (b.disabled = true));
    };

    const revealPad = () => {
      document.querySelectorAll(".answer-btn").forEach((btn, i) => {
        if (i === correctOption) btn.classList.add("correct");
        else if (myOption === i) btn.classList.add("incorrect");
        else btn.classList.add("incorrect");
      });
    };

    $("btnJoin").addEventListener("click", () => {
      pin = $("playerPin").value.trim();
      const playerName = $("playerName").value.trim();
      $("joinErr").classList.add("hidden");
      if (!pin || pin.length !== 4) {
        $("joinErr").textContent = "Enter the 4-digit PIN from your host.";
        $("joinErr").classList.remove("hidden");
        return;
      }
      if (!playerName) {
        $("joinErr").textContent = "Enter a nickname.";
        $("joinErr").classList.remove("hidden");
        return;
      }
      socket.emit("quiz:join", { pin, playerName });
    });

    socket.on("player:joined", (data) => {
      myPlayerId = data.playerId;
      $("playerTopMeta").textContent = data.name;
      $("lobbyPinLabel").textContent = data.pin;
      $("waitHost").textContent = `Hosted by ${data.hostName} • ${data.category}`;
      show("view-wait");
    });

    socket.on("quiz:starting", (data) => {
      const w = document.querySelector(".wait-text");
      if (w) w.textContent = `Get ready! Quiz starting in ${data.startInSeconds}…`;
    });

    socket.on("question:start", (data) => {
      answered = false;
      myOption = null;
      correctOption = null;
      roundStartAt = Date.now();
      $("playerQCounter").textContent = `Q ${data.questionIndex} / ${data.totalQuestions}`;
      $("playerQuestion").textContent = data.question;
      $("playerTimerNum").textContent = String(data.timeLimitSeconds);
      $("miniLeader").classList.add("hidden");

      const fb = $("playerFeedback");
      fb.classList.add("hidden");
      fb.className = "player-feedback";

      renderPad(data.options);
      show("view-game");
    });

    socket.on("question:countdown", (data) => {
      const el = $("playerTimerNum");
      if (el) el.textContent = String(data.remainingSeconds);
    });

    socket.on("answer:result", (data) => {
      const fb = $("playerFeedback");
      fb.classList.remove("hidden");
      if (data.isCorrect) {
        fb.className = "player-feedback good";
        fb.textContent = `Correct! +${data.pointsAwarded} pts (${(data.timeTakenMs / 1000).toFixed(2)}s)`;
      } else {
        fb.className = "player-feedback bad";
        fb.textContent = `Wrong answer. +${data.pointsAwarded} pts`;
      }
      if (!data.isCorrect && data.correctOption !== null && data.correctOption !== undefined) {
        correctOption = data.correctOption;
      } else if (data.isCorrect) {
        correctOption = myOption;
      }
    });

    socket.on("answer:rejected", (data) => {
      const fb = $("playerFeedback");
      fb.className = "player-feedback bad";
      fb.textContent = (data && data.message) || "Answer rejected.";
      fb.classList.remove("hidden");
      if (data && data.reason === "too_late") {
        answered = true;
        disablePad();
      }
    });

    socket.on("question:time_up", (data) => {
      if (correctOption === null) correctOption = data.correctOption;
      disablePad();
      revealPad();
    });

    socket.on("leaderboard:update", (data) => {
      const ml = $("miniLeader");
      ml.classList.remove("hidden");
      const myName = $("playerName").value.trim();
      const ol = document.createElement("ol");
      ol.className = "leaderboard final";
      data.leaderboard.forEach((row, i) => {
        const li = document.createElement("li");
        li.className = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
        const isMe = row.name === myName;
        const star = isMe ? " ⭐" : "";
        li.innerHTML = `<span class="rank">${row.rank}</span><span class="leader-name">${row.name}${star}</span><span class="leader-score">${row.score}</span>`;
        if (isMe) li.style.border = "2px solid var(--accent-2)";
        ol.appendChild(li);
      });
      ml.innerHTML = "";
      const title = document.createElement("h3");
      title.textContent = "Leaderboard";
      ml.appendChild(title);
      ml.appendChild(ol);
      myScore = (data.leaderboard.find((r) => r.name === myName) || {}).score || 0;
      $("playerScorePill").textContent = myScore + " pts";
    });

    socket.on("quiz:ended", (data) => {
      const me = $("playerName").value.trim();
      const myRow = data.finalRanks.find((r) => r.name === me);
      const rankTxt = myRow ? `You finished #${myRow.rank} with ${myRow.score} points.` : "Game over!";
      $("playerFinalScore").textContent = rankTxt;
      $("playerWinner").textContent = data.winner
        ? `${data.winner.name} wins with ${data.winner.score} points!`
        : "No winner this time.";

      const ol = $("playerFinalRanks");
      ol.innerHTML = "";
      data.finalRanks.forEach((row, i) => {
        const li = document.createElement("li");
        li.className = i === 0 ? "top1" : i === 1 ? "top2" : i === 2 ? "top3" : "";
        const star = row.name === me ? " ⭐ (you)" : "";
        li.innerHTML = `<span class="rank">${row.rank}</span><span class="leader-name">${row.name}${star}</span><span class="leader-score">${row.score} pts</span>`;
        ol.appendChild(li);
      });
      show("view-results");
    });

    $("btnPlayAgain").addEventListener("click", () => {
      window.location.reload();
    });

    socket.on("quiz:error", (d) => {
      $("joinErr").textContent = (d && d.message) || "Something went wrong.";
      $("joinErr").classList.remove("hidden");
    });

    socket.on("error", (d) => {
      $("joinErr").textContent = (d && d.message) || "Something went wrong.";
      $("joinErr").classList.remove("hidden");
    });
  }
})();