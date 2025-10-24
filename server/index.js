const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// pontuação / tempo
const POINTS_CORRECT = 10;
const POINTS_WRONG = -5;
const DEFAULT_TIMER_SECONDS = 180; // 3 minutos

app.use(express.static(path.join(__dirname, "..", "client")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "client", "index.html"));
});

// ===== CONFIG =====
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

let gameState = {
  board: generateBoard(defaultWordList, MIN_WORDS_DEFAULT),
  scores: {},
  endTime: Date.now() + DEFAULT_TIMER_SECONDS * 1000
};

let hostId = null;

// helper para emitir estado completo (board + scores + endTime)
function emitFullState(targetSocket = null) {
  const payload = { board: gameState.board, scores: gameState.scores, endTime: gameState.endTime, hostId };
  if (targetSocket) targetSocket.emit("initState", payload);
  else io.emit("updateBoard", payload);
}

io.on("connection", (socket) => {
  console.log("Novo jogador:", socket.id);

  if (!hostId) hostId = socket.id;
  if (!(socket.id in gameState.scores)) gameState.scores[socket.id] = 0;

  // envia initState somente para esse cliente
  socket.emit("initState", { board: gameState.board, scores: gameState.scores, endTime: gameState.endTime, hostId });
  console.log("emit initState para", socket.id);

  // host pede novo tabuleiro
  socket.on("requestNewBoard", () => {
    if (socket.id !== hostId) {
      console.log("requestNewBoard ignorado de", socket.id, "— não é host", hostId);
      return;
    }
    console.log("Host solicitou novo board:", socket.id);
    gameState.board = generateBoard(defaultWordList, MIN_WORDS_DEFAULT);
    gameState.endTime = Date.now() + DEFAULT_TIMER_SECONDS * 1000;
    // broadcasta novo estado
    io.emit("updateBoard", { board: gameState.board, scores: gameState.scores, endTime: gameState.endTime, hostId });
  });

  // Quando alguém resolve palavra
  socket.on("wordSolved", ({ word, x, y, dir }) => {
    const entry = gameState.board.words.find(
      w => w.word === word && w.x === x && w.y === y && w.dir === dir
    );

    if (!entry) return;
    if (!entry.completedBy) {
      entry.completedBy = socket.id;
      gameState.scores[socket.id] = (gameState.scores[socket.id] || 0) + POINTS_CORRECT;
    }

    io.emit("updateBoard", gameState);
  });


    socket.on("disconnect", () => {
      console.log("Jogador saiu:", socket.id);
      delete gameState.scores[socket.id];
      if (socket.id === hostId) {
        const remaining = Object.keys(gameState.scores);
        hostId = remaining.length ? remaining[0] : null;
      }
      // broadcast para atualizar placar/estado
      io.emit("updateBoard", { board: gameState.board, scores: gameState.scores, endTime: gameState.endTime, hostId });
    });
  });

server.listen(PORT, () => {
  console.log(`Servidor com Socket.IO rodando em http://localhost:${PORT}`);
});
