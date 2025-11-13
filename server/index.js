require('dotenv').config();
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const cookieParser = require("cookie-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;


// ===== DB pool (mysql2/promise) =====
const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "root",
  database: process.env.DB_NAME || "wordcombat",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};
const dbPool = mysql.createPool(DB_CONFIG);

// JWT config
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

// middleware
app.use(express.json());
app.use(cookieParser());

// redirect root to auth page
app.get("/", (req, res) => res.redirect("/auth.html"));

// serve client static files
app.use(express.static(path.join(__dirname, "..", "client")));
app.get("/hub.html", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "hub.html"));
});
app.get("/lobby.html", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "lobby.html"));
});

// ===== ensure DB + users table exist =====
async function initDb() {
  const conn = await dbPool.getConnection();
  try {
    // Create DB if not exists, then ensure using it
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\`;`);
    await conn.query(`USE \`${DB_CONFIG.database}\`;`);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("DB initialized and users table ensured.");
  } finally {
    conn.release();
  }
}
initDb().catch(err => {
  console.error("DB init error:", err);
  // do not crash automatically — but log
});

// ===== auth helpers (DB) =====
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
async function findUserByEmail(email) {
  const [rows] = await dbPool.query("SELECT id, name, email, password_hash FROM users WHERE email = ?", [email]);
  return rows && rows[0] ? rows[0] : null;
}
async function createUser({ name, email, passwordHash }) {
  const [res] = await dbPool.query("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)", [name, email, passwordHash]);
  return { id: res.insertId, name, email };
}

// ===== auth endpoints =====
app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password || typeof password !== "string") {
      return res.status(400).json({ message: "Campos incompletos." });
    }
    if (password.length < 6) return res.status(400).json({ message: "Senha muito curta (mín 6)." });

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) return res.status(409).json({ message: "Email já cadastrado." });

    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    const user = await createUser({ name: name.trim().slice(0,150), email: normalizedEmail, passwordHash: hash });

    const token = signToken({ id: user.id, name: user.name, email: user.email });
    // httpOnly cookie
    res.cookie("wc_token", token, { httpOnly: true, sameSite: "lax" });

    return res.status(201).json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error("Error /api/register:", err);
    return res.status(500).json({ message: "Erro interno." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "Campos incompletos." });

    const normalizedEmail = email.trim().toLowerCase();
    const user = await findUserByEmail(normalizedEmail);
    if (!user) return res.status(401).json({ message: "Credenciais inválidas." });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: "Credenciais inválidas." });

    const token = signToken({ id: user.id, name: user.name, email: user.email });
    res.cookie("wc_token", token, { httpOnly: true, sameSite: "lax" }); // add secure:true in prod with HTTPS

    return res.status(200).json({ id: user.id, name: user.name, email: user.email });
  } catch (err) {
    console.error("Error /api/login:", err);
    return res.status(500).json({ message: "Erro interno." });
  }
});

app.post("/api/logout", (req, res) => {
  res.clearCookie("wc_token");
  return res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {
  try {
    const token = req.cookies && req.cookies.wc_token;
    if (!token) return res.status(401).json({ message: "Não autorizado." });
    let payload;
    try { payload = jwt.verify(token, JWT_SECRET); } catch (e) {
      return res.status(401).json({ message: "Token inválido." });
    }
    return res.json({ id: payload.id, name: payload.name, email: payload.email });
  } catch (err) {
    console.error("Error /api/me:", err);
    return res.status(500).json({ message: "Erro interno." });
  }
});

// ===== CONFIG / game helpers (your original logic) =====
const GRID_SIZE = 15;
const MIN_WORDS_DEFAULT = 8;
const MAX_GLOBAL_ATTEMPTS = 50;
const MAX_TRIES_PER_ATTEMPT = 15;

const defaultWordList = [
  { word: "CASA", hint: "Onde moramos" },
  { word: "LUZ", hint: "Ilumina o ambiente" },
  { word: "MAR", hint: "Água salgada" },
  { word: "LIVRO", hint: "Tem páginas" },
  { word: "SOL", hint: "Estrela quente" },
  { word: "LUA", hint: "Satélite natural da Terra" },
  { word: "RIO", hint: "Curso d'água" },
  { word: "FLOR", hint: "Colorida e perfumada" },
  { word: "VENTO", hint: "Movimento do ar" },
  { word: "PAZ", hint: "Ausência de guerra" },
  { word: "NUVEM", hint: "Branca no céu" },
  { word: "POESIA", hint: "Forma de arte escrita" },
  { word: "ESTRELA", hint: "Brilha no céu" },
  { word: "CHUVA", hint: "Água que cai do céu" },
  { word: "CEU", hint: "Fica acima de nós" }
];

const POINTS_CORRECT = 10;
const POINTS_WRONG = -5;
const DEFAULT_TIMER_SECONDS = 180; // 3 minutos

function coordKey(x, y) { return `${x},${y}`; }

function canPlaceOnGrid(grid, word, x, y, dir) {
  if (dir === "H" && (x < 0 || x + word.length > GRID_SIZE)) return false;
  if (dir === "V" && (y < 0 || y + word.length > GRID_SIZE)) return false;

  for (let i = 0; i < word.length; i++) {
    const xi = dir === "H" ? x + i : x;
    const yi = dir === "H" ? y : y + i;
    const key = coordKey(xi, yi);
    const cur = grid[key];
    if (cur && cur !== word[i]) return false;
    if (!cur) {
      const neighbors = dir === "H" ? [[xi, yi - 1], [xi, yi + 1]] : [[xi - 1, yi], [xi + 1, yi]];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= GRID_SIZE || ny < 0 || ny >= GRID_SIZE) continue;
        if (grid[coordKey(nx, ny)]) return false;
      }
    }
  }

  const beforeKey = dir === "H" ? coordKey(x - 1, y) : coordKey(x, y - 1);
  const afterKey = dir === "H" ? coordKey(x + word.length, y) : coordKey(x, y + word.length);
  if (grid[beforeKey] || grid[afterKey]) return false;
  return true;
}

function placeWordOnGrid(grid, placedWords, word, x, y, dir, hint) {
  for (let i = 0; i < word.length; i++) {
    const key = dir === "H" ? coordKey(x + i, y) : coordKey(x, y + i);
    grid[key] = word[i];
  }
  placedWords.push({ word, x, y, dir, hint, completedBy: null });
}

function findCrossPlacementOnGrid(grid, placedWords, entry) {
  for (const existing of placedWords) {
    for (let i = 0; i < existing.word.length; i++) {
      const letter = existing.word[i];
      for (let j = 0; j < entry.word.length; j++) {
        if (entry.word[j] !== letter) continue;
        let x, y, dir;
        if (existing.dir === "H") {
          x = existing.x + i;
          y = existing.y - j;
          dir = "V";
        } else {
          x = existing.x - j;
          y = existing.y + i;
          dir = "H";
        }
        if (canPlaceOnGrid(grid, entry.word, x, y, dir)) {
          placeWordOnGrid(grid, placedWords, entry.word, x, y, dir, entry.hint);
          return true;
        }
      }
    }
  }
  return false;
}

function generateBoard(wordList = defaultWordList, minWords = MIN_WORDS_DEFAULT) {
  let attempts = 0;
  let success = false;
  let finalPlaced = [];
  let finalGrid = {};

  while (!success && attempts < MAX_GLOBAL_ATTEMPTS) {
    attempts++;
    const grid = {};
    const placedWords = [];
    const pool = wordList.map(w => ({ word: w.word.toString().toUpperCase(), hint: w.hint || "" }))
                         .sort(() => Math.random() - 0.5);

    const first = pool.shift();
    const startX = Math.floor((GRID_SIZE - first.word.length) / 2);
    const startY = Math.floor(GRID_SIZE / 2);
    placeWordOnGrid(grid, placedWords, first.word, startX, startY, "H", first.hint);

    let tries = 0;
    for (const entry of pool) {
      const placed = findCrossPlacementOnGrid(grid, placedWords, entry);
      if (!placed) tries++;
      if (tries > MAX_TRIES_PER_ATTEMPT) break;
    }

    if (placedWords.length >= minWords) {
      success = true;
      finalPlaced = placedWords;
      finalGrid = grid;
      break;
    } else {
      finalPlaced = placedWords;
      finalGrid = grid;
    }
  }

  return { words: finalPlaced.map(p => ({ ...p })) };
}

// ===== game state (global fallback) =====
let gameState = {
  board: generateBoard(defaultWordList, MIN_WORDS_DEFAULT),
  scores: {}, // socketId -> points
  endTime: Date.now() + DEFAULT_TIMER_SECONDS * 1000,
  ended: false
};

let hostId = null;

// mapa socketId -> username (pode ser null para guest)
const players = {};

// ===== Rooms/Salas =====
const rooms = {}; // roomId -> { name, hostId, hostName, players: { socketId: username }, gameState?, timer?, _deletionTimeout? }

function genRoomId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 5; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function buildRoomListPayload() {
  const out = {};
  for (const [id, r] of Object.entries(rooms)) {
    out[id] = {
      name: r.name || null,
      hostId: r.hostId,
      hostName: r.hostName || null,
      players: r.players || {}
    };
  }
  return out;
}

// ===== Helpers para remoção agendada de salas (grace period) =====
function scheduleRoomDeletion(roomId, delayMs = 10000) {
  const room = rooms[roomId];
  if (!room) return;
  if (room._deletionTimeout) clearTimeout(room._deletionTimeout);
  room._deletionTimeout = setTimeout(() => {
    if (!rooms[roomId]) return;
    const playersCount = rooms[roomId].players ? Object.keys(rooms[roomId].players).length : 0;
    if (playersCount === 0) {
      delete rooms[roomId];
      console.log(`Sala removida por timeout: ${roomId}`);
      io.emit("roomList", buildRoomListPayload());
    } else {
      console.log(`Sala ${roomId} tinha players ao timeout — não removida.`);
      cancelRoomDeletion(roomId);
    }
  }, delayMs);
  console.log(`Agendado remoção da sala ${roomId} em ${delayMs}ms`);
}

function cancelRoomDeletion(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  if (room._deletionTimeout) {
    clearTimeout(room._deletionTimeout);
    room._deletionTimeout = null;
    console.log(`Cancelada remoção agendada da sala ${roomId}`);
  }
}

// ===== emit full state helper (global) =====
function emitFullState(targetSocket = null, eventName = null) {
  const payload = {
    board: gameState.board,
    scores: gameState.scores,
    endTime: gameState.endTime,
    hostId,
    ended: gameState.ended,
    players // global players map
  };
  if (targetSocket) {
    const ev = eventName || "initState";
    targetSocket.emit(ev, payload);
  } else {
    const ev = eventName || "updateBoard";
    io.emit(ev, payload);
  }
}

// timer (global fallback)
let _endTimerTimeout = null;
function scheduleEndTimer() {
  if (_endTimerTimeout) {
    clearTimeout(_endTimerTimeout);
    _endTimerTimeout = null;
  }
  const msLeft = Math.max(0, gameState.endTime - Date.now());
  if (msLeft === 0) {
    finalizeGame();
  } else {
    _endTimerTimeout = setTimeout(() => {
      finalizeGame();
    }, msLeft + 50);
  }
}
function finalizeGame() {
  if (gameState.ended) return;
  gameState.ended = true;
  console.log("Tempo do jogo esgotou — finalizando (global).");
  emitFullState(null, "updateBoard");
}
scheduleEndTimer();

function isValidDir(d){ return d === "H" || d === "V"; }
function toIntSafe(v){ const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : null; }

// ===== socket auth helper (parse cookie header) =====
function parseCookieHeader(cookieHeader = "") {
  const cookies = {};
  cookieHeader.split(";").forEach(part => {
    const [k, ...v] = part.split("=");
    const key = (k || "").trim();
    if (!key) return;
    cookies[key] = decodeURIComponent((v || []).join("="));
  });
  return cookies;
}

// util: prompt builder
function buildGenPrompt(count = 12, theme = null) {
  return `
Você é um gerador de listas de palavras para um jogo de palavras-cruzadas em português.
Gere um array JSON com exatamente ${count} objetos em português.
Formato: [{"word":"PALAVRA","hint":"Dica curta em português"}, ...]
Regras:
- Palavra em maiúsculas, apenas letras (A-Z e letras acentuadas em PT-BR). Min 3 e máx 12 caracteres.
- Dica curta (2-8 palavras), sem quebras de linha.
- Tema: ${theme || 'geral'}
Responda APENAS com o JSON (sem explicações).
  `.trim();
}

async function fetchGeneratedWords(count = 12, theme = null) {
  const key = process.env.GENAI_API_KEY;
  if (!key) throw new Error("GENAI_API_KEY não definido no servidor.");

  // modelos candidatos (ordem de preferência)
  const modelCandidates = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",

  ];

  const prompt = buildGenPrompt(count, theme);
  const bodyContent = { contents: [{ parts: [{ text: prompt }] }] };

  const maxAttemptsPerModel = 2; // tente no máximo 2 vezes por modelo
  const baseDelay = 300; // ms base para backoff
  const requestTimeout = 15000; // 15s por tentativa

  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
  function jitter(n){ return n + Math.floor(Math.random() * Math.max(100, n)); }

  function extractTextFromResponse(rdata) {
    // tenta várias formas comuns encontradas nas respostas da API
    const cand = rdata?.candidates?.[0];
    if (cand) {
      const c = cand.content;
      if (Array.isArray(c)) {
        for (const block of c) {
          if (block?.parts && Array.isArray(block.parts) && block.parts[0]?.text) return block.parts[0].text;
          if (block?.text) return block.text;
        }
      } else if (c?.parts && Array.isArray(c.parts) && c.parts[0]?.text) {
        return c.parts[0].text;
      }
    }
    if (rdata?.output?.[0]?.content) return rdata.output[0].content;
    return typeof rdata === "string" ? rdata : JSON.stringify(rdata);
  }

  let lastErr = null;

  for (const modelId of modelCandidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`;

    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      try {
        console.log(`[GenAI] tentando modelo "${modelId}" (attempt ${attempt})`);
        const res = await axios.post(url, bodyContent, {
          headers: { "Content-Type": "application/json" },
          timeout: requestTimeout
        });

        const text = extractTextFromResponse(res.data);
        if (!text) throw new Error("Resposta vazia da API GenAI.");

        // tenta parsear JSON puro ou extrair array JSON dentro do texto
        let parsed = null;
        try { parsed = JSON.parse(text); }
        catch (e) {
          const m = (text || "").match(/\[.*\]/s);
          if (m) {
            try { parsed = JSON.parse(m[0]); } catch (e2) { parsed = null; }
          }
        }

        if (!Array.isArray(parsed) || parsed.length === 0) {
          throw new Error(`GenAI retornou formato inesperado (modelo ${modelId}).`);
        }

        const clean = parsed.slice(0, count).map(item => {
          const rawWord = (item.word || "").toString();
          const word = rawWord.toUpperCase().replace(/[^A-Z\u00C0-\u017F]/g, "").slice(0, 12);
          const hint = (item.hint || "").toString().slice(0, 80);
          return { word, hint };
        }).filter(x => x.word && x.word.length >= 3);

        if (!clean.length) throw new Error("Nenhuma palavra válida encontrada no output.");

        console.log(`[GenAI] sucesso com ${modelId} -> ${clean.length} palavras`);
        return clean;

      } catch (err) {
        lastErr = err;
        const status = err.response?.status || "no-status";
        const snippet = err.response?.data ? (typeof err.response.data === "string" ? err.response.data : JSON.stringify(err.response.data)).slice(0,1200) : "";
        console.warn(`[GenAI] erro em ${modelId} (attempt ${attempt}) status=${status} msg=${err.message}`);
        if (snippet) console.warn(`[GenAI] response.data (trunc): ${snippet}`);

        // somente retry para códigos retryable
        const retryable = [429, 500, 502, 503, 504].includes(err.response?.status);
        if (!retryable) {
          console.warn(`[GenAI] erro não-retryable em ${modelId}, pulando para o próximo modelo.`);
          break; // pula para o próximo modelo
        }

        const delay = jitter(baseDelay * Math.pow(2, attempt - 1));
        console.log(`[GenAI] aguardando ${delay}ms antes da próxima tentativa...`);
        await sleep(delay);
      }
    } // attempts
  } // models

  console.error("GenAI: todas as tentativas falharam. Último erro:", lastErr?.message || lastErr);
  throw lastErr || new Error("GenAI falhou sem mensagem de erro.");
}

app.post("/api/generate-words", async (req, res) => {
  try {
    const { count = 12, theme = null } = req.body || {};

    try {
      const words = await fetchGeneratedWords(count, theme);
      return res.json({ ok: true, words });
    } catch (err) {
      console.warn("GenAI falhou:", err.message || err);
      // fallback para sua lista local
      const fallback = (defaultWordList || []).slice(0, count).map(w => ({ word: w.word.toString().toUpperCase(), hint: w.hint }));
      return res.json({ ok: true, words: fallback, fallback: true });
    }
  } catch (err) {
    console.error("Erro /api/generate-words:", err);
    const fallback = (defaultWordList || []).slice(0, 12).map(w => ({ word: w.word.toString().toUpperCase(), hint: w.hint }));
    return res.status(500).json({ ok: false, message: "Erro no servidor.", words: fallback });
  }
});

// ===== socket.io connection handling (integrated with cookie/JWT auth) =====
io.on("connection", (socket) => {
  console.log("Novo jogador conectado (socket):", socket.id);

  // extract token from handshake cookies
  const header = socket.handshake && socket.handshake.headers && socket.handshake.headers.cookie;
  let username = null;
  if (header) {
    const cookies = parseCookieHeader(header);
    const token = cookies.wc_token;
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        username = payload.name || null;
      } catch (e) {
        // invalid token -> ignore
      }
    }
  }

  if (username) {
    players[socket.id] = username;
    console.log("Socket associado a username:", socket.id, "→", username);
  } else {
    players[socket.id] = null;
  }

  // assign host if none
  if (!hostId) hostId = socket.id;
  if (!(socket.id in gameState.scores)) gameState.scores[socket.id] = 0;

  // send initState to this client only (global fallback)
  emitFullState(socket, "initState");
  console.log("initState enviado para", socket.id);

  // broadcast rooms and lobby summary
  io.emit("roomList", buildRoomListPayload());
  io.emit("lobbyUpdate", { players, hostId });

  // ---- Rooms handlers ----
  socket.on("createRoom", ({ name } = {}) => {
    const roomId = genRoomId();
    rooms[roomId] = {
      name: name ? name.toString().slice(0, 80) : null,
      hostId: socket.id,
      hostName: players[socket.id] || null,
      players: { [socket.id]: players[socket.id] || null },
      gameState: null,
      timer: null,
      _deletionTimeout: null
    };
    socket.join(roomId);
    cancelRoomDeletion(roomId);
    io.emit("roomList", buildRoomListPayload());
    socket.emit("createRoomResult", { ok: true, roomId });
    io.to(roomId).emit("lobbyUpdate", { players: rooms[roomId].players, hostId: rooms[roomId].hostId, roomId });
    console.log("Sala criada:", roomId, "por", socket.id);
  });

  socket.on("requestRoomList", () => {
    socket.emit("roomList", buildRoomListPayload());
  });

  // joinRoom supports callback ack
  socket.on("joinRoom", (data = {}, callback) => {
    try {
      const roomId = data && data.roomId;
      console.log("joinRoom recebido de", socket.id, "payload:", data);

      if (!roomId || !rooms[roomId]) {
        const msg = "Sala não encontrada.";
        console.warn("joinRoom falhou (nao encontrada):", roomId);
        console.log("Salas ativas agora:", Object.keys(rooms));
        io.emit("roomList", buildRoomListPayload());
        if (typeof callback === "function") callback({ ok: false, message: msg, roomId });
        socket.emit("joinRoomResult", { ok: false, message: msg, roomId });
        return;
      }

      const room = rooms[roomId];
      room.players[socket.id] = players[socket.id] || null;
      socket.join(roomId);
      cancelRoomDeletion(roomId);

      // reconnection: if the username equals hostName, reassign hostId to this socket
      if (room.hostName && players[socket.id] && room.hostName === players[socket.id]) {
        room.hostId = socket.id;
        console.log(`Reatribuído host da sala ${roomId} para socket ${socket.id} (reconexão do host: ${room.hostName})`);
      }

      io.to(roomId).emit("lobbyUpdate", { players: room.players, hostId: room.hostId, roomId });
      io.emit("roomList", buildRoomListPayload());

      console.log(`${socket.id} entrou na sala ${roomId} (username: ${players[socket.id] || "guest"})`);
      if (typeof callback === "function") callback({ ok: true, roomId });
      socket.emit("joinRoomResult", { ok: true, roomId });
      // envia estado da sala diretamente para o socket que entrou (evita ver board global)
      if (room.gameState) {
        socket.emit("initState", {
          board: room.gameState.board,
          scores: room.gameState.scores,
          endTime: room.gameState.endTime,
          hostId: room.hostId,
          ended: room.gameState.ended,
          players: room.players
        });
      } else {
        // se o jogo ainda não começou na sala, envie um init leve (opcional)
        socket.emit("initState", {
          board: gameState.board,
          scores: gameState.scores,
          endTime: gameState.endTime,
          hostId,
          ended: gameState.ended,
          players: room.players
        });
      }
    } catch (err) {
      console.error("Erro em joinRoom:", err);
      if (typeof callback === "function") callback({ ok: false, message: "Erro ao entrar na sala." });
      socket.emit("joinRoomResult", { ok: false, message: "Erro ao entrar na sala." });
    }
  });

  socket.on("leaveRoom", ({ roomId } = {}) => {
    if (!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    delete room.players[socket.id];
    socket.leave(roomId);

    if (socket.id === room.hostId) {
      const remaining = Object.keys(room.players);
      if (remaining.length) {
        room.hostId = remaining[0];
        room.hostName = room.players[room.hostId];
        cancelRoomDeletion(roomId);
      } else {
        scheduleRoomDeletion(roomId, 10000);
        io.emit("roomList", buildRoomListPayload());
        return;
      }
    }

    io.to(roomId).emit("lobbyUpdate", { players: room.players, hostId: room.hostId, roomId });
    io.emit("roomList", buildRoomListPayload());
  });

  socket.on("startGame", async ({ roomId, useGen = false, count = 12, theme = null } = {}) => {
    try {
      // limites defensivos
      count = Math.max(4, Math.min(16, Number(count) || 12));
      let wordPool = (defaultWordList || []).slice(0).map(w => ({ word: w.word.toString().toUpperCase(), hint: w.hint || "" }));

      if (useGen && typeof fetchGeneratedWords === "function") {
        try {
          // não bloqueia demais: se a GenAI demorar, seguimos com fallback
          const genTimeoutMs = 4000; // ajuste entre 2000-6000ms conforme preferir
          const generated = await Promise.race([
            fetchGeneratedWords(count, theme),
            new Promise(resolve => setTimeout(() => resolve(null), genTimeoutMs))
          ]);

          if (Array.isArray(generated) && generated.length) {
            wordPool = generated.slice(0, count);
            console.log(`GenAI: geradas ${wordPool.length} palavras (theme=${theme || 'geral'})`);
          } else {
            console.warn("GenAI não respondeu a tempo ou retornou nulo — usando fallback local.");
          }
        } catch (err) {
          console.warn("Erro ao gerar palavras com GenAI, usando fallback local. Erro:", err?.message || err);
        }
      } else if (useGen) {
        console.warn("useGen solicitado mas fetchGeneratedWords não encontrado — usando fallback local.");
      }

      // --- geração do tabuleiro usando wordPool ---
      if (roomId) {
        const room = rooms[roomId];
        if (!room) {
          console.warn("startGame: roomId inválido", roomId);
          return;
        }
        if (socket.id !== room.hostId) {
          console.log("startGame ignorado — não é host da sala:", socket.id);
          return;
        }

        const board = generateBoard(wordPool, MIN_WORDS_DEFAULT);
        const endTime = Date.now() + DEFAULT_TIMER_SECONDS * 1000;
        room.gameState = { board, scores: {}, endTime, ended: false };

        for (const sId of Object.keys(room.players)) room.gameState.scores[sId] = room.gameState.scores[sId] || 0;

        if (room.timer) clearTimeout(room.timer);
        const msLeft = Math.max(0, endTime - Date.now());
        room.timer = setTimeout(() => {
          if (room.gameState) room.gameState.ended = true;
          io.to(roomId).emit("updateBoard", {
            board: room.gameState.board,
            scores: room.gameState.scores,
            endTime: room.gameState.endTime,
            hostId: room.hostId,
            ended: true,
            players: room.players
          });
        }, msLeft + 50);

        io.to(roomId).emit("gameStarting", { roomId });
        io.to(roomId).emit("updateBoard", {
          board: room.gameState.board,
          scores: room.gameState.scores,
          endTime: room.gameState.endTime,
          hostId: room.hostId,
          ended: false,
          players: room.players
        });
        return;
      }

      // fallback global
      if (socket.id !== hostId) {
        console.log("startGame global ignorado — não é host:", socket.id);
        return;
      }

      gameState = {
        board: generateBoard(wordPool, MIN_WORDS_DEFAULT),
        scores: {},
        endTime: Date.now() + DEFAULT_TIMER_SECONDS * 1000,
        ended: false
      };
      const current = Array.from(io.sockets.sockets.keys());
      for (const sId of current) gameState.scores[sId] = gameState.scores[sId] || 0;
      scheduleEndTimer();
      io.emit("gameStarting");
      emitFullState(null, "updateBoard");

    } catch (err) {
      console.error("Erro em startGame:", err);
    }
  });



  // wordSolved (room-aware)
  socket.on("wordSolved", (payload) => {
    try {
      if (!payload || typeof payload !== "object") return;

      const roomId = payload.roomId;
      const word = (payload.word || "").toString().toUpperCase();
      const x = toIntSafe(payload.x);
      const y = toIntSafe(payload.y);
      const dir = (payload.dir || "").toString();

      if (!word || x === null || y === null || !isValidDir(dir)) {
        console.log("wordSolved inválido de", socket.id, payload);
        return;
      }

      // room-specific handling
      if (roomId) {
        const room = rooms[roomId];
        if (!room || !room.gameState) {
          console.log("wordSolved: room inválida ou jogo não iniciado:", roomId);
          return;
        }
        if (room.gameState.ended || (room.gameState.endTime && Date.now() > room.gameState.endTime)) {
          console.log("wordSolved ignorado — jogo da sala acabado:", socket.id, word);
          return;
        }
        const entry = room.gameState.board.words.find(
          w => w.word === word && w.x === x && w.y === y && w.dir === dir
        );
        if (!entry) { console.log("wordSolved sala não corresponde:", payload); return; }
        if (entry.completedBy) { console.log("wordSolved sala já completada:", entry.completedBy); return; }

        entry.completedBy = socket.id;
        room.gameState.scores[socket.id] = (room.gameState.scores[socket.id] || 0) + POINTS_CORRECT;
        console.log(`Palavra ${word} resolvida por ${socket.id} na sala ${roomId}. Pontos: ${room.gameState.scores[socket.id]}`);

        // if last word completed -> evaluate winner and broadcast final result (optional improvement)
        const allDone = room.gameState.board.words.every(w => w.completedBy);
        if (allDone) {
          room.gameState.ended = true;
          // compute winner by score
          const scores = room.gameState.scores;
          let bestId = null, bestScore = -Infinity;
          for (const [sId, pts] of Object.entries(scores)) {
            if (pts > bestScore) { bestScore = pts; bestId = sId; }
          }
          io.to(roomId).emit("gameEnded", { winnerId: bestId, winnerScore: bestScore, scores, players: room.players });
        }

        io.to(roomId).emit("updateBoard", {
          board: room.gameState.board,
          scores: room.gameState.scores,
          endTime: room.gameState.endTime,
          hostId: room.hostId,
          ended: room.gameState.ended,
          players: room.players
        });
        return;
      }

      // fallback: global gameState
      if (gameState.ended || (gameState.endTime && Date.now() > gameState.endTime)) {
        console.log("wordSolved ignorado — jogo global acabado:", socket.id, word);
        return;
      }

      const entry = gameState.board.words.find(
        w => w.word === word && w.x === x && w.y === y && w.dir === dir
      );
      if (!entry) {
        console.log("wordSolved não corresponde a entrada válida:", { word, x, y, dir }, "de", socket.id);
        return;
      }
      if (entry.completedBy) {
        console.log("wordSolved ignorado — já completada por", entry.completedBy);
        return;
      }

      entry.completedBy = socket.id;
      gameState.scores[socket.id] = (gameState.scores[socket.id] || 0) + POINTS_CORRECT;
      console.log(`Palavra ${word} resolvida por ${socket.id} (${players[socket.id] || "guest"}). Pontos: ${gameState.scores[socket.id]}`);

      // if last global word done -> finalize
      const allDoneGlobal = gameState.board.words.every(w => w.completedBy);
      if (allDoneGlobal) {
        gameState.ended = true;
        // compute global winner
        const scores = gameState.scores;
        let bestId = null, bestScore = -Infinity;
        for (const [sId, pts] of Object.entries(scores)) {
          if (pts > bestScore) { bestScore = pts; bestId = sId; }
        }
        io.emit("gameEnded", { winnerId: bestId, winnerScore: bestScore, scores, players });
      }

      emitFullState(null, "updateBoard");
    } catch (err) {
      console.error("Erro ao processar wordSolved:", err);
    }
  });

  // disconnect: limpar players e remover de rooms se necessário (agenda exclusão)
  socket.on("disconnect", () => {
    console.log("Jogador saiu:", socket.id);

    // track rooms that need updateBoard/lobbyUpdate
    const affectedRooms = [];

    // remove from any room
    for (const [rId, room] of Object.entries(rooms)) {
      if (room.players && room.players[socket.id] !== undefined) {
        delete room.players[socket.id];
        socket.leave(rId);
        affectedRooms.push(rId);

        if (socket.id === room.hostId) {
          const remaining = Object.keys(room.players);
          if (remaining.length) {
            room.hostId = remaining[0];
            room.hostName = room.players[room.hostId];
            cancelRoomDeletion(rId);
          } else {
            // schedule deletion if empty
            scheduleRoomDeletion(rId, 10000);
            io.emit("roomList", buildRoomListPayload());
            continue;
          }
        }
        // emit lobbyUpdate only to affected room
        io.to(rId).emit("lobbyUpdate", { players: room.players, hostId: room.hostId, roomId: rId });
      }
    }

    // cleanup global
    delete gameState.scores[socket.id];
    delete players[socket.id];

    if (socket.id === hostId) {
      const remaining = Object.keys(gameState.scores);
      hostId = remaining.length ? remaining[0] : null;
      console.log("Host saiu — novo hostId:", hostId);
    }

    // atualiza listas globais
    io.emit("roomList", buildRoomListPayload());
    io.emit("lobbyUpdate", { players, hostId });

    // Emit updateBoard only to affected rooms that have a gameState running
    for (const rId of affectedRooms) {
      const room = rooms[rId];
      if (room && room.gameState) {
        io.to(rId).emit("updateBoard", {
          board: room.gameState.board,
          scores: room.gameState.scores,
          endTime: room.gameState.endTime,
          hostId: room.hostId,
          ended: room.gameState.ended,
          players: room.players
        });
      }
    }

    // If there are connected sockets outside any room, send them the global state
    const socketsInRooms = new Set();
    for (const r of Object.values(rooms)) {
      if (r.players) Object.keys(r.players).forEach(sid => socketsInRooms.add(sid));
    }
    const allConnected = Array.from(io.sockets.sockets.keys());
    const outsiders = allConnected.filter(sid => !socketsInRooms.has(sid));
    if (outsiders.length && gameState && Array.isArray(gameState.board.words)) {
      outsiders.forEach(sid => {
        const s = io.sockets.sockets.get(sid);
        if (s) {
          s.emit("updateBoard", {
            board: gameState.board,
            scores: gameState.scores,
            endTime: gameState.endTime,
            hostId,
            ended: gameState.ended,
            players // global players map
          });
        }
      });
    }

  });

}); // end io.on connection

// start server
server.listen(PORT, () => {
  console.log(`Servidor com Socket.IO rodando em http://localhost:${PORT}`);
});
