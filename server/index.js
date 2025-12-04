// carrega variáveis de ambiente do .env e importa dependências
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
const fs = require("fs");

// cria app express e servidor http + socket.io
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// porta e host configuráveis via ambiente
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// inicializa escuta do servidor (mensagem informativa)
server.listen(PORT, HOST, () => {
  console.log(`Servidor com Socket.IO rodando em http://${HOST === '0.0.0.0' ? '0.0.0.0' : HOST}:${PORT}`);
  console.log("Acesse pelo navegador de outra máquina: http://<IP_LOCAL_DO_HOST>:"+PORT);
});

// diretório e arquivo para persistência das palavras padrões
const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_WORDS_FILE = path.join(DATA_DIR, "defaultWords.json");

// ===== configuração do pool de conexão com MySQL (mysql2/promise) =====
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

// configuração do JWT (segredo e validade)
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const JWT_EXPIRES = process.env.JWT_EXPIRES || "7d";

// middleware do express: parse JSON e cookies
app.use(express.json());
app.use(cookieParser());

// rota raiz redireciona para página de autenticação
app.get("/", (req, res) => res.redirect("/auth.html"));

// entrega arquivos estáticos do cliente
app.use(express.static(path.join(__dirname, "..", "client")));
app.get("/hub.html", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "hub.html"));
});
app.get("/lobby.html", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "lobby.html"));
});

// ===== garante que o banco e a tabela users existam (cria se necessário) =====
async function initDb() {
  const conn = await dbPool.getConnection();
  try {
    // cria database se não existir e seleciona
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\`;`);
    await conn.query(`USE \`${DB_CONFIG.database}\`;`);
    // cria tabela users com campos essenciais
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
// inicializa DB e trata erro sem derrubar app
initDb().catch(err => {
  console.error("DB init error:", err);
  // não encerra o servidor automaticamente — apenas loga o erro
});

// ===== helpers de autenticação (acesso ao DB) =====
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

// ===== endpoints de autenticação =====
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
    res.cookie("wc_token", token, { httpOnly: true, sameSite: "lax" });

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

// ===== CONFIGURAÇÕES E FUNÇÕES AUXILIARES DO JOGO =====
const GRID_SIZE = 15;
const MIN_WORDS_DEFAULT = 8;
const MAX_GLOBAL_ATTEMPTS = 50;
const MAX_TRIES_PER_ATTEMPT = 15;

const MAX_GEN_COUNT = 24;
const DEFAULT_GEN_COUNT = 20;

let defaultWordList = [
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

function sanitizeWord(raw) {
  if (!raw) return "";
  let s = String(raw).toUpperCase();
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[^A-Z]/g, "");
  return s.slice(0, 12);
}

function loadDefaultWordsFromDisk() {
  try {
    if (fs.existsSync(DEFAULT_WORDS_FILE)) {
      const raw = fs.readFileSync(DEFAULT_WORDS_FILE, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        defaultWordList = parsed.map(w => ({
          word: sanitizeWord(w.word),
          hint: (w.hint || "").toString().slice(0, 80)
        })).filter(x => x.word && x.word.length >= 3);
        console.log("defaultWordList carregada de disco:", DEFAULT_WORDS_FILE);
      }
    }
  } catch (err) {
    console.warn("Não foi possível carregar defaultWords do disco:", err.message || err);
  }
}

function persistDefaultWordsToDisk(list) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DEFAULT_WORDS_FILE, JSON.stringify(list, null, 2), "utf8");
    console.log("defaultWordList persistida em disco:", DEFAULT_WORDS_FILE);
  } catch (err) {
    console.warn("Falha ao persistir defaultWords:", err.message || err);
  }
}

loadDefaultWordsFromDisk();

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

// escreve uma palavra no grid e registra em placedWords
// agora também inicializa attemptedBy: [] para rastrear tentativas incorretas
function placeWordOnGrid(grid, placedWords, word, x, y, dir, hint) {
  for (let i = 0; i < word.length; i++) {
    const key = dir === "H" ? coordKey(x + i, y) : coordKey(x, y + i);
    grid[key] = word[i];
  }
  placedWords.push({ word, x, y, dir, hint, completedBy: null, attemptedBy: [] });
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

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
    const pool = shuffleArray(wordList.map(w => ({ word: sanitizeWord(w.word), hint: w.hint || "" })));

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

  // garantimos que cada word tenha attemptedBy (em caso de versões antigas)
  return { words: finalPlaced.map(p => ({ ...p, attemptedBy: Array.isArray(p.attemptedBy) ? p.attemptedBy : [] })) };
}

// ===== estado do jogo (fallback global quando não há salas ativas) =====
let gameState = {
  board: generateBoard(defaultWordList, MIN_WORDS_DEFAULT),
  scores: {}, // mapa socketId -> pontos
  endTime: null,
  ended: false
};
// garante attemptedBy no board global inicial
if (gameState.board && Array.isArray(gameState.board.words)) {
  gameState.board.words.forEach(w => { w.attemptedBy = Array.isArray(w.attemptedBy) ? w.attemptedBy : []; });
}

let hostId = null;
const players = {};
const rooms = {};

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
      players: r.players || {},
      aiOptions: r.aiOptions || null
    };
  }
  return out;
}

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

function emitFullState(targetSocket = null, eventName = null) {
  const payload = {
    board: gameState.board,
    scores: gameState.scores,
    endTime: gameState.endTime,
    hostId,
    ended: gameState.ended,
    players
  };
  if (targetSocket) {
    const ev = eventName || "initState";
    targetSocket.emit(ev, payload);
  } else {
    const ev = eventName || "updateBoard";
    io.emit(ev, payload);
  }
}

let _endTimerTimeout = null;
function scheduleEndTimer() {
  if (!gameState.endTime) {
    console.log("scheduleEndTimer: endTime não definido — nada agendado.");
    return;
  }
  if (_endTimerTimeout) {
    clearTimeout(_endTimerTimeout);
    _endTimerTimeout = null;
  }
  const msLeft = Math.max(0, gameState.endTime - Date.now());
  if (msLeft === 0) {
    finalizeGame();
  } else {
    console.log(`scheduleEndTimer: agendando finalização global em ${msLeft}ms`);
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

function isValidDir(d){ return d === "H" || d === "V"; }
function toIntSafe(v){ const n = Number(v); return Number.isFinite(n) ? Math.floor(n) : null; }

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

function buildGenPrompt(count = DEFAULT_GEN_COUNT, theme = null) {
  return `
Você é um gerador de listas de palavras para um jogo de palavras-cruzadas em português.
Gere um array JSON com exatamente ${count} objetos em português.
Formato: [{"word":"PALAVRA","hint":"Dica curta em português"}, ...]
Regras:
- Palavra em maiúsculas, apenas letras (A-Z e letras sem acentos e sem espaços em PT-BR). Min 3 e máx 12 caracteres.
- Dica curta (2-8 palavras), sem quebras de linha.
- Tema: ${theme || 'geral'}
Responda APENAS com o JSON (sem explicações).
  `.trim();
}

const genCache = new Map();
const GEN_CACHE_TTL = 5 * 60 * 1000;

async function fetchGeneratedWords(count = DEFAULT_GEN_COUNT, theme = null) {
  const key = process.env.GENAI_API_KEY;
  if (!key) throw new Error("GENAI_API_KEY não definido no servidor.");

  count = Math.max(4, Math.min(MAX_GEN_COUNT, Number(count) || DEFAULT_GEN_COUNT));

  const cacheKey = `c${count}:t${theme || "null"}`;
  const cached = genCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < GEN_CACHE_TTL) {
    console.log(`[GenAI][cache] HIT for ${cacheKey} - reusing ${cached.words.length} words`);
    return cached.words.slice(0, count);
  }

  const modelCandidates = [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
  ];

  const prompt = buildGenPrompt(count, theme);
  const bodyContent = { contents: [{ parts: [{ text: prompt }] }] };

  const maxAttemptsPerModel = 1;
  const baseDelay = 300;
  const requestTimeout = 25000;

  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
  function jitter(n){ return n + Math.floor(Math.random() * Math.max(100, n)); }

  function extractTextFromResponse(rdata) {
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
        console.log(`[GenAI] tentando modelo "${modelId}" (attempt ${attempt}) tema="${theme || 'geral'}" count=${count}`);
        const res = await axios.post(url, bodyContent, {
          headers: { "Content-Type": "application/json" },
          timeout: requestTimeout
        });

        const text = extractTextFromResponse(res.data);
        if (!text) throw new Error("Resposta vazia da API GenAI.");

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
          const word = sanitizeWord(rawWord);
          const hint = (item.hint || "").toString().slice(0, 80);
          return { word, hint };
        }).filter(x => x.word && x.word.length >= 3);

        if (!clean.length) throw new Error("Nenhuma palavra válida encontrada no output.");

        console.log(`[GenAI] sucesso com ${modelId} -> ${clean.length} palavras`);
        console.log(`[GenAI] palavras geradas (tema=${theme || 'geral'}): ${clean.map(c => c.word).join(", ")}`);

        genCache.set(cacheKey, { words: clean, ts: Date.now() });
        return clean;
      } catch (err) {
        lastErr = err;
        const status = err.response?.status || "no-status";
        const snippet = err.response?.data ? (typeof err.response.data === "string" ? err.response.data : JSON.stringify(err.response.data)).slice(0,1200) : "";
        console.warn(`[GenAI] erro em ${modelId} (attempt ${attempt}) status=${status} msg=${err.message}`);
        if (snippet) console.warn(`[GenAI] response.data (trunc): ${snippet}`);

        const retryable = [429, 500, 502, 503, 504].includes(err.response?.status);
        if (!retryable) {
          console.warn(`[GenAI] erro não-retryable em ${modelId}, pulando para o próximo modelo.`);
          break;
        }

        const delay = jitter(baseDelay * Math.pow(2, attempt - 1));
        console.log(`[GenAI] aguardando ${delay}ms antes da próxima tentativa...`);
        await sleep(delay);
      }
    }
  }

  console.error("GenAI: todas as tentativas falharam. Último erro:", lastErr?.message || lastErr);
  throw lastErr || new Error("GenAI falhou sem mensagem de erro.");
}

app.post("/api/generate-words", async (req, res) => {
  try {
    const { count = DEFAULT_GEN_COUNT, theme = null, replaceDefault = false } = req.body || {};

    try {
      const words = await fetchGeneratedWords(count, theme);
      if (Array.isArray(words) && words.length) {
        const clean = words.slice(0, count).map(w => ({
          word: sanitizeWord(w.word),
          hint: (w.hint || "").toString().slice(0, 80)
        })).filter(x => x.word && x.word.length >= 3);

        if (clean.length) {
          console.log(`[api/generate-words] retorno final (tema=${theme || 'geral'}): ${clean.map(c => c.word).join(", ")}`);

          if (replaceDefault) {
            defaultWordList = clean.map(w => ({ word: w.word, hint: w.hint || "" }));
            persistDefaultWordsToDisk(defaultWordList);
            console.log("defaultWordList substituída pela GenAI via /api/generate-words (replaceDefault=true).");
          }
          return res.json({ ok: true, words: clean, fallback: false });
        }
      }
      throw new Error("GenAI retornou formato inválido ou vazio.");
    } catch (err) {
      console.warn("GenAI falhou:", err.message || err);
      const fallback = (defaultWordList || []).slice(0, count).map(w => ({ word: sanitizeWord(w.word), hint: w.hint || "" }));
      console.log(`[api/generate-words] fallback usado: ${fallback.map(c => c.word).join(", ")}`);
      return res.json({ ok: true, words: fallback, fallback: true });
    }
  } catch (err) {
    console.error("Erro /api/generate-words:", err);
    const fallback = (defaultWordList || []).slice(0, DEFAULT_GEN_COUNT).map(w => ({ word: sanitizeWord(w.word), hint: w.hint || "" }));
    return res.status(500).json({ ok: false, message: "Erro no servidor.", words: fallback });
  }
});

// ===== manipuladores socket.io (integração com cookie/JWT) =====
io.on("connection", (socket) => {
  console.log("Novo jogador conectado (socket):", socket.id);

  const header = socket.handshake && socket.handshake.headers && socket.handshake.headers.cookie;
  let username = null;
  if (header) {
    const cookies = parseCookieHeader(header);
    const token = cookies.wc_token;
    if (token) {
      try {
        const payload = jwt.verify(token, JWT_SECRET);
        username = payload.name || null;
      } catch (e) {}
    }
  }

  if (username) {
    players[socket.id] = username;
    console.log("Socket associado a username:", socket.id, "→", username);
  } else {
    players[socket.id] = null;
  }

  if (!hostId) hostId = socket.id;
  if (!(socket.id in gameState.scores)) gameState.scores[socket.id] = 0;

  emitFullState(socket, "initState");
  console.log("initState enviado para", socket.id);

  io.emit("roomList", buildRoomListPayload());
  io.emit("lobbyUpdate", { players, hostId });

  // criar sala (aceita aiOptions)
  socket.on("createRoom", ({ name, aiOptions } = {}) => {
    const roomCount = aiOptions && aiOptions.count ? Math.max(4, Math.min(MAX_GEN_COUNT, Number(aiOptions.count) || DEFAULT_GEN_COUNT)) : undefined;
    const roomId = genRoomId();
    rooms[roomId] = {
      name: name ? name.toString().slice(0, 80) : null,
      hostId: socket.id,
      hostName: players[socket.id] || null,
      players: { [socket.id]: players[socket.id] || null },
      gameState: null,
      timer: null,
      _deletionTimeout: null,
      aiOptions: aiOptions ? {
        useGen: !!aiOptions.useGen,
        count: roomCount || DEFAULT_GEN_COUNT,
        theme: aiOptions.theme ? aiOptions.theme.toString().slice(0,80) : null,
        replaceDefault: !!aiOptions.replaceDefault
      } : null
    };
    socket.join(roomId);
    cancelRoomDeletion(roomId);
    io.emit("roomList", buildRoomListPayload());
    socket.emit("createRoomResult", { ok: true, roomId });
    io.to(roomId).emit("lobbyUpdate", { players: rooms[roomId].players, hostId: rooms[roomId].hostId, roomId, aiOptions: rooms[roomId].aiOptions });
    console.log("Sala criada:", roomId, "por", socket.id, "aiOptions:", rooms[roomId].aiOptions);
  });

  socket.on("requestRoomList", () => {
    socket.emit("roomList", buildRoomListPayload());
  });

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

      if (room.hostName && players[socket.id] && room.hostName === players[socket.id]) {
        room.hostId = socket.id;
        console.log(`Reatribuído host da sala ${roomId} para socket ${socket.id} (reconexão do host: ${room.hostName})`);
      }

      io.to(roomId).emit("lobbyUpdate", { players: room.players, hostId: room.hostId, roomId, aiOptions: room.aiOptions });
      io.emit("roomList", buildRoomListPayload());

      console.log(`${socket.id} entrou na sala ${roomId} (username: ${players[socket.id] || "guest"})`);
      if (typeof callback === "function") callback({ ok: true, roomId });
      socket.emit("joinRoomResult", { ok: true, roomId });

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

    io.to(roomId).emit("lobbyUpdate", { players: room.players, hostId: room.hostId, roomId, aiOptions: room.aiOptions });
    io.emit("roomList", buildRoomListPayload());
  });

  socket.on("startGame", async ({ roomId, useGen = undefined, count = DEFAULT_GEN_COUNT, theme = null, replaceDefault = undefined } = {}) => {
    try {
      count = Math.max(4, Math.min(MAX_GEN_COUNT, Number(count) || DEFAULT_GEN_COUNT));

      let roomAi = null;
      if (roomId && rooms[roomId] && rooms[roomId].aiOptions) {
        roomAi = rooms[roomId].aiOptions;
      }

      const effectiveUseGen = (typeof useGen === "boolean") ? useGen : (!!roomAi && !!roomAi.useGen);
      const effectiveCount = (typeof count === "number") ? count : (roomAi && roomAi.count) ? roomAi.count : DEFAULT_GEN_COUNT;
      const effectiveTheme = (typeof theme === "string" && theme.trim().length) ? theme.trim() : (roomAi && roomAi.theme) ? roomAi.theme : null;
      const effectiveReplaceDefault = (typeof replaceDefault === "boolean") ? replaceDefault : (!!roomAi && !!roomAi.replaceDefault);

      console.log(`[startGame] roomId=${roomId || 'global'} effectiveUseGen=${!!effectiveUseGen} effectiveCount=${effectiveCount} effectiveTheme=${effectiveTheme || 'null'}`);

      let wordPool = (defaultWordList || []).slice(0).map(w => ({ word: sanitizeWord(w.word), hint: w.hint || "" }));

      if (effectiveUseGen && typeof fetchGeneratedWords === "function") {
        try {
          if (roomId) {
            io.to(roomId).emit("boardGenerating", { message: "ESPERE — O TABULEIRO ESTÁ SENDO GERADO" });
          } else {
            io.emit("boardGenerating", { message: "ESPERE — O TABULEIRO ESTÁ SENDO GERADO" });
          }

          const genTimeoutMs = 30000;
          const genStartTs = Date.now();

          const generated = await Promise.race([
            (async () => {
              const res = await fetchGeneratedWords(effectiveCount, effectiveTheme);
              console.log(`[GenAI] tempo total de geração: ${Date.now() - genStartTs}ms (tema=${effectiveTheme || 'geral'})`);
              return res;
            })(),
            new Promise(resolve => setTimeout(() => resolve(null), genTimeoutMs))
          ]);

          if (Array.isArray(generated) && generated.length) {
            const cleaned = generated.slice(0, effectiveCount).map(w => ({
              word: sanitizeWord(w.word),
              hint: (w.hint || "").toString().slice(0, 80)
            })).filter(x => x.word && x.word.length >= 3);

            if (cleaned.length) {
              wordPool = cleaned;
              console.log(`GenAI: geradas ${wordPool.length} palavras (tema=${effectiveTheme || "geral"})`);
              console.log(`[startGame] palavras usadas: ${wordPool.map(w=>w.word).join(", ")}`);
              if (effectiveReplaceDefault) {
                defaultWordList = wordPool.map(w => ({ word: w.word, hint: w.hint || "" }));
                persistDefaultWordsToDisk(defaultWordList);
                console.log("defaultWordList substituída pela GenAI via startGame (replaceDefault=true).");
              }
            } else {
              console.warn("GenAI retornou palavras inválidas — usando fallback local.");
            }
          } else {
            console.warn("GenAI não respondeu a tempo ou retornou nulo — usando fallback local.");
            console.log(`[startGame] fallback words: ${wordPool.map(w=>w.word).join(", ")}`);
          }
        } catch (err) {
          console.warn("Erro ao gerar palavras com GenAI, usando fallback local. Erro:", err?.message || err);
          console.log(`[startGame] fallback words (erro): ${wordPool.map(w=>w.word).join(", ")}`);
        }
      } else if (effectiveUseGen) {
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

        // garante attemptedBy
        if (room.gameState.board && Array.isArray(room.gameState.board.words)) {
          room.gameState.board.words.forEach(w => { w.attemptedBy = Array.isArray(w.attemptedBy) ? w.attemptedBy : []; });
        }

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

      // garante attemptedBy para cada palavra do board global
      if (gameState.board && Array.isArray(gameState.board.words)) {
        gameState.board.words.forEach(w => { w.attemptedBy = Array.isArray(w.attemptedBy) ? w.attemptedBy : []; });
      }

      const current = Array.from(io.sockets.sockets.keys());
      for (const sId of current) gameState.scores[sId] = gameState.scores[sId] || 0;
      scheduleEndTimer();
      io.emit("gameStarting");
      emitFullState(null, "updateBoard");

    } catch (err) {
      console.error("Erro em startGame:", err);
    }
  });

  // marca palavra como resolvida (room-aware)
  socket.on("wordSolved", (payload) => {
    try {
      if (!payload || typeof payload !== "object") return;

      const roomId = payload.roomId;
      const word = sanitizeWord(payload.word || "");
      const x = toIntSafe(payload.x);
      const y = toIntSafe(payload.y);
      const dir = (payload.dir || "").toString();

      if (!word || x === null || y === null || !isValidDir(dir)) {
        console.log("wordSolved inválido de", socket.id, payload);
        return;
      }

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

        const allDone = room.gameState.board.words.every(w => w.completedBy);
        if (allDone) {
          room.gameState.ended = true;
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

      const allDoneGlobal = gameState.board.words.every(w => w.completedBy);
      if (allDoneGlobal) {
        gameState.ended = true;
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

  // tenta aplicar penalidade por tentativa incorreta (uma vez por jogador por palavra)
  socket.on("wordAttempt", (payload) => {
    try {
      if (!payload || typeof payload !== "object") return;
      const roomId = payload.roomId;
      const word = sanitizeWord(payload.word || "");
      const x = toIntSafe(payload.x);
      const y = toIntSafe(payload.y);
      const dir = (payload.dir || "").toString();

      if (!word || x === null || y === null || !isValidDir(dir)) return;

      // sala-scoped
      if (roomId) {
        const room = rooms[roomId];
        if (!room || !room.gameState) return;
        if (room.gameState.ended || (room.gameState.endTime && Date.now() > room.gameState.endTime)) return;

        const entry = room.gameState.board.words.find(
          w => w.word === word && w.x === x && w.y === y && w.dir === dir
        );
        if (!entry) return;
        if (entry.completedBy) return;

        entry.attemptedBy = entry.attemptedBy || [];
        if (!entry.attemptedBy.includes(socket.id)) {
          entry.attemptedBy.push(socket.id);
          room.gameState.scores[socket.id] = (room.gameState.scores[socket.id] || 0) + POINTS_WRONG;
          console.log(`Tentativa incorreta por ${socket.id} na sala ${roomId} para ${word}. Pontos: ${room.gameState.scores[socket.id]}`);
          io.to(roomId).emit("updateBoard", {
            board: room.gameState.board,
            scores: room.gameState.scores,
            endTime: room.gameState.endTime,
            hostId: room.hostId,
            ended: room.gameState.ended,
            players: room.players
          });
        }
        return;
      }

      // global fallback
      if (gameState.ended || (gameState.endTime && Date.now() > gameState.endTime)) return;
      const entry = gameState.board.words.find(
        w => w.word === word && w.x === x && w.y === y && w.dir === dir
      );
      if (!entry) return;
      if (entry.completedBy) return;

      entry.attemptedBy = entry.attemptedBy || [];
      if (!entry.attemptedBy.includes(socket.id)) {
        entry.attemptedBy.push(socket.id);
        gameState.scores[socket.id] = (gameState.scores[socket.id] || 0) + POINTS_WRONG;
        console.log(`Tentativa incorreta por ${socket.id} (global) para ${word}. Pontos: ${gameState.scores[socket.id]}`);
        emitFullState(null, "updateBoard");
      }
    } catch (err) {
      console.error("Erro ao processar wordAttempt:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("Jogador saiu:", socket.id);

    const affectedRooms = [];

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
            scheduleRoomDeletion(rId, 10000);
            io.emit("roomList", buildRoomListPayload());
            continue;
          }
        }
        io.to(rId).emit("lobbyUpdate", { players: room.players, hostId: room.hostId, roomId: rId });
      }
    }

    delete gameState.scores[socket.id];
    delete players[socket.id];

    if (socket.id === hostId) {
      const remaining = Object.keys(gameState.scores);
      hostId = remaining.length ? remaining[0] : null;
      console.log("Host saiu — novo hostId:", hostId);
    }

    io.emit("roomList", buildRoomListPayload());
    io.emit("lobbyUpdate", { players, hostId });

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
            players
          });
        }
      });
    }

  });

}); // fim io.on connection

// inicia servidor
server.listen(PORT, () => {
  console.log(`Servidor com Socket.IO rodando em http://localhost:${PORT}`);
});
