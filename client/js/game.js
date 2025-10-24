(function () {
  const GRID_SIZE = 15;
  const CELL_SIZE = 40;
  const MIN_WORDS_DEFAULT = 8;
  const MAX_GLOBAL_ATTEMPTS = 50;
  const MAX_TRIES_PER_ATTEMPT = 15;
  const DEFAULT_TIMER_SECONDS = 180; // 3 minutos
  const POINTS_CORRECT = 10;
  const POINTS_WRONG = -5;

  // DOM refs (setados em init)
  let container = null;
  let cluesContainer = null;
  let scoreDisplay = null;
  let timerDisplay = null;

  let wordList = [
    { word: "casa", hint: "Onde moramos" },
    { word: "luz", hint: "Ilumina o ambiente" },
    { word: "mar", hint: "Água salgada" },
    { word: "livro", hint: "Tem páginas" },
    { word: "sol", hint: "Estrela quente" },
    { word: "lua", hint: "Satélite natural da Terra" },
    { word: "rio", hint: "Curso d'água" },
    { word: "flor", hint: "Colorida e perfumada" },
    { word: "vento", hint: "Movimento do ar" },
    { word: "paz", hint: "Ausência de guerra" },
    { word: "nuvem", hint: "Branca no céu" },
    { word: "poesia", hint: "Forma de arte escrita" },
    { word: "estrela", hint: "Brilha no céu" },
    { word: "chuva", hint: "Água que cai do céu" },
    { word: "ceu", hint: "Fica acima de nós" }
  ];

  let grid = {};            // map "x,y" -> letter (UPPERCASE)
  let placedWords = [];     // array { word (UPPER), x, y, dir, hint, completed, attempted }
  let cellWords = {};       // map "x,y" -> [ { entry, index } ... ]
  let cellLocks = {};       // map "x,y" -> true  (celulas já completadas e travadas)
  let cellRefs = {};        // map "x,y" -> input element
  let selectedWord = null;  // entry object currently selected (from placedWords)
  let score = 0;
  let timerInterval = null;
  let overlay = null;
  let overlayTitle = null;
  let overlayMessage = null;
  let overlayButton = null;

  // ===== UTIL =====
  function normalizeLetter(l) { return (l || "").toUpperCase(); }
  function coordKey(x, y) { return `${x},${y}`; }
  function parseCoord(key) { const [x,y] = key.split(",").map(Number); return { x, y }; }
  function isLockedKey(key) { return !!cellLocks[key]; }

  // ===== INIT =====
  function init(options = {}) {
    container = document.getElementById("grid-container");
    cluesContainer = document.getElementById("clues");
    scoreDisplay = document.getElementById("score");
    timerDisplay = document.getElementById("timer");

    if (options.wordList && Array.isArray(options.wordList) && options.wordList.length) {
      wordList = options.wordList;
    }

    if (scoreDisplay) scoreDisplay.textContent = `Pontuação: ${score}`;

    // overlay reutilizável
    overlay = document.createElement("div");
    overlay.id = "game-overlay";
    overlay.style.display = "none";
    overlay.innerHTML = `
      <div class="game-card">
        <h2></h2>
        <p></p>
        <div style="margin-top:16px;">
          <button class="btn">Jogar Novamente</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlayTitle = overlay.querySelector("h2");
    overlayMessage = overlay.querySelector("p");
    overlayButton = overlay.querySelector("button");
    overlayButton.addEventListener("click", () => {
      hideOverlay();
      resetGame();
    });
  }

  //logica de posicionamento
  function placeWordAt(word, x, y, dir, hint) {
    for (let i = 0; i < word.length; i++) {
      const key = dir === "H" ? coordKey(x + i, y) : coordKey(x, y + i);
      grid[key] = word[i];
    }
    placedWords.push({ word, x, y, dir, hint, completed: false, attempted: false });
  }

  function placeFirstWord(word, hint) {
    const startX = Math.floor((GRID_SIZE - word.length) / 2);
    const startY = Math.floor(GRID_SIZE / 2);
    placeWordAt(word, startX, startY, "H", hint);
  }

  function canPlace(word, x, y, dir) {
    if (dir === "H" && (x < 0 || x + word.length > GRID_SIZE)) return false;
    if (dir === "V" && (y < 0 || y + word.length > GRID_SIZE)) return false;

    for (let i = 0; i < word.length; i++) {
      const xi = dir === "H" ? x + i : x;
      const yi = dir === "H" ? y : y + i;
      const key = coordKey(xi, yi);
      const cur = grid[key];

      if (cur && cur !== word[i]) return false;

      if (!cur) {
        const neighbors = dir === "H"
          ? [[xi, yi - 1], [xi, yi + 1]]
          : [[xi - 1, yi], [xi + 1, yi]];
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

  function findCrossPlacement(entry) {
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
          if (canPlace(entry.word, x, y, dir)) {
            placeWordAt(entry.word, x, y, dir, entry.hint);
            return true;
          }
        }
      }
    }
    return false;
  }

  // mapping
  function buildNumberMap() {
    const map = {};
    let num = 1;
    for (const entry of placedWords) {
      const key = coordKey(entry.x, entry.y);
      if (!map[key]) map[key] = num++;
    }
    return map;
  }

  function buildCellWordMap() {
    cellWords = {};
    for (const entry of placedWords) {
      for (let i = 0; i < entry.word.length; i++) {
        const x = entry.dir === "H" ? entry.x + i : entry.x;
        const y = entry.dir === "H" ? entry.y : entry.y + i;
        const key = coordKey(x, y);
        if (!cellWords[key]) cellWords[key] = [];
        cellWords[key].push({ entry, index: i });
      }
    }
  }

  // renderizar o tabuleiro
  function renderGrid() {
    if (!container) {
      console.warn("Grid container não inicializado. Chame game.init() primeiro.");
      return;
    }

    // limpar referências anteriores
    cellRefs = {};
    container.style.gridTemplateColumns = `repeat(${GRID_SIZE}, ${CELL_SIZE}px)`;
    container.innerHTML = "";

    const numberMap = buildNumberMap();

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const key = coordKey(x, y);
        const cellContainer = document.createElement("div");
        cellContainer.className = "cell-container";

        const input = document.createElement("input");
        input.className = "cell";
        input.type = "text";
        input.setAttribute("inputmode", "text");
        input.setAttribute("maxlength", "1");
        input.style.textTransform = "uppercase";
        input.dataset.coord = key;

        if (grid[key]) {
          input.dataset.letter = grid[key].toUpperCase();
          input.disabled = false;
          if (cellLocks[key]) {
            input.value = input.dataset.letter;
            input.disabled = true;
            input.classList.add("correct");
          } else {
            input.value = "";
          }
        } else {
          input.dataset.letter = "";
          input.disabled = true;
        }

        // listeners
        input.addEventListener("input", (e) => handleInput(e, input));
        input.addEventListener("keydown", (e) => handleKeyDown(e, input));
        input.addEventListener("click", () => handleCellClick(key));

        cellRefs[key] = input;
        cellContainer.appendChild(input);

        if (numberMap[key]) {
          const number = document.createElement("div");
          number.className = "cell-number";
          number.textContent = numberMap[key];
          cellContainer.appendChild(number);
        }

        container.appendChild(cellContainer);
      }
    }

    buildCellWordMap();
    renderClues(numberMap);
  }

  // input handlers
  function handleInput(e, input) {
    const key = input.dataset.coord;
    if (isLockedKey(key)) {
      input.value = input.dataset.letter || "";
      return;
    }

    let v = normalizeLetter(e.target.value);
    if (!v.match(/^[A-Z]$/)) {
      e.target.value = "";
      return;
    }
    e.target.value = v;

    if (cellWords[key]) {
      for (const { entry } of cellWords[key]) {
        entry.attempted = false;
      }
    }

    if (selectedWord) moveToNextCell(input);
  }

  function handleKeyDown(e, input) {
    if (e.key === "Backspace") {
      const key = input.dataset.coord;
      if (isLockedKey(key)) { e.preventDefault(); return; }
      if (!selectedWord) return;

      const { x: cx, y: cy } = parseCoord(key);
      for (let i = 0; i < selectedWord.word.length; i++) {
        const xi = selectedWord.dir === "H" ? selectedWord.x + i : selectedWord.x;
        const yi = selectedWord.dir === "H" ? selectedWord.y : selectedWord.y + i;
        if (xi === cx && yi === cy) {
          if (input.value) {
            input.value = "";
          } else {
            for (let j = i - 1; j >= 0; j--) {
              const px = selectedWord.dir === "H" ? selectedWord.x + j : selectedWord.x;
              const py = selectedWord.dir === "H" ? selectedWord.y : selectedWord.y + j;
              const pk = coordKey(px, py);
              const prevInput = cellRefs[pk];
              if (!prevInput) continue;
              if (isLockedKey(pk)) continue;
              if (prevInput.disabled) continue;
              prevInput.focus();
              prevInput.value = "";
              break;
            }
          }
          e.preventDefault();
          break;
        }
      }
    }
  }

  function handleCellClick(key) {
    const options = cellWords[key];
    if (!options) return;

    if (options.length === 1) selectWord(options[0].entry);
    else {
      if (!selectedWord || (selectedWord !== options[0].entry && selectedWord !== options[1].entry)) {
        selectWord(options[0].entry);
      } else {
        const other = options[0].entry === selectedWord ? options[1].entry : options[0].entry;
        selectWord(other);
      }
    }
  }

  // selecionar e navegar
  function selectWord(entry) {
    Object.values(cellRefs).forEach(el => el.classList.remove("highlighted"));
    selectedWord = entry;

    for (let i = 0; i < entry.word.length; i++) {
      const x = entry.dir === "H" ? entry.x + i : entry.x;
      const y = entry.dir === "H" ? entry.y : entry.y + i;
      const k = coordKey(x, y);
      const el = cellRefs[k];
      if (el) el.classList.add("highlighted");
    }

    updateCluesHighlight(entry);

    for (let i = 0; i < entry.word.length; i++) {
      const x = entry.dir === "H" ? entry.x + i : entry.x;
      const y = entry.dir === "H" ? entry.y : entry.y + i;
      const k = coordKey(x, y);
      const el = cellRefs[k];
      if (el && !el.disabled && !isLockedKey(k) && !el.value) { el.focus(); return; }
    }
  }

  function moveToNextCell(currentInput) {
    if (!selectedWord) return;
    const { x: cx, y: cy } = parseCoord(currentInput.dataset.coord);
    let startIndex = 0;

    // encontra o índice atual corretamente
    for (let i = 0; i < selectedWord.word.length; i++) {
      const x = selectedWord.dir === "H" ? selectedWord.x + i : selectedWord.x;
      const y = selectedWord.dir === "H" ? selectedWord.y : selectedWord.y + i;
      if (x === cx && y === cy) {
        startIndex = i + 1;
        break;
      }
    }

    // move para o próximo índice livre (considerando direção)
    for (let i = startIndex; i < selectedWord.word.length; i++) {
      const x = selectedWord.dir === "H" ? selectedWord.x + i : selectedWord.x;
      const y = selectedWord.dir === "H" ? selectedWord.y : selectedWord.y + i;
      const k = coordKey(x, y);
      const el = cellRefs[k];
      if (!el) continue;
      if (el.disabled) continue;
      if (isLockedKey(k)) continue; // ignora células travadas
      el.focus();
      break;
    }
  }


  // Retorna resultado para que o main.js possa emitir ao servidor se quiser
  function checkSelectedWord() {
    if (!selectedWord) return null;

    let correct = true;
    for (let i = 0; i < selectedWord.word.length; i++) {
      const x = selectedWord.dir === "H" ? selectedWord.x + i : selectedWord.x;
      const y = selectedWord.dir === "H" ? selectedWord.y : selectedWord.y + i;
      const k = coordKey(x, y);
      const el = cellRefs[k];
      if (!el) continue;
      if ((el.value || "").toUpperCase() !== (el.dataset.letter || "").toUpperCase()) {
        correct = false;
        break;
      }
    }

    markWordCells(selectedWord, correct);

    // atualiza score local
    if (correct && !selectedWord.completed) {
      score += POINTS_CORRECT;
      selectedWord.completed = true;
      selectedWord.attempted = true;
      markClueAsComplete(selectedWord);
    } else if (!correct && !selectedWord.completed && !selectedWord.attempted) {
      score += POINTS_WRONG;
      selectedWord.attempted = true;
    }

    if (scoreDisplay) scoreDisplay.textContent = `Pontuação: ${score}`;

    checkVictory();

    // Retorna info para o main.js emitir
    return {
      correct,
      word: selectedWord.word,
      coords: { x: selectedWord.x, y: selectedWord.y, dir: selectedWord.dir }
    };
  }

  // marca células sem alterar as que já estão travadas
  // entryPassed pode ser um objeto vindo do servidor (com completedBy) ou uma referência local
  function markWordCells(entryPassed, correct) {
    // tenta casar com placedWords para manter referência local consistente
    let entry = null;
    if (entryPassed && entryPassed.x !== undefined && entryPassed.y !== undefined && entryPassed.dir) {
      entry = placedWords.find(e => e.x === entryPassed.x && e.y === entryPassed.y && e.dir === entryPassed.dir && e.word.toUpperCase() === (entryPassed.word || "").toString().toUpperCase());
    }
    if (!entry) {
      // se não encontrou, pode ser que passed seja exatamente a referência já (ou word only)
      entry = entryPassed;
    }

    // marca cada célula
    for (let i = 0; i < entry.word.length; i++) {
      const x = entry.dir === "H" ? entry.x + i : entry.x;
      const y = entry.dir === "H" ? entry.y : entry.y + i;
      const k = coordKey(x, y);
      const el = cellRefs[k];
      if (!el) continue;

      // se a célula já está confirmada por outra palavra, não altere-a
      if (isLockedKey(k)) continue;

      el.classList.remove("correct", "wrong");

      if (correct) {
        el.classList.add("correct");
        el.value = normalizeLetter(el.dataset.letter || entry.word[i]);
        el.disabled = true;
        cellLocks[k] = true;
      } else {
        el.classList.add("wrong");
        el.disabled = false;
        cellLocks[k] = false;
      }
    }

    // se veio do servidor com completedBy, atualize o placedWords correspondente
    if (entryPassed && entryPassed.completedBy) {
      if (entry) entry.completed = true;
    }
  }

  function markWordCellsFromServer(srvWord) {
    for (let i = 0; i < srvWord.word.length; i++) {
      const x = srvWord.dir === "H" ? srvWord.x + i : srvWord.x;
      const y = srvWord.dir === "H" ? srvWord.y : srvWord.y + i;
      const key = `${x},${y}`;
      const input = document.querySelector(`input[data-coord="${key}"]`);
      if (!input) continue;

      input.value = srvWord.word[i].toUpperCase();
      input.disabled = true;
      if (srvWord.completedBy && srvWord.completedBy !== window.game.myId) {
        input.classList.add("correct-other"); // diferente se for o outro jogador
      } else {
        input.classList.add("correct");
      }
    }

    const entry = placedWords.find(w =>
      w.x === srvWord.x && w.y === srvWord.y && w.dir === srvWord.dir
    );
    if (entry) {
      entry.completed = true;
      entry.completedBy = srvWord.completedBy;
    }

    markClueAsComplete(srvWord);
  }


  function updateScoreForEntry(entry, correct) {
    if (correct && !entry.completed) {
      score += POINTS_CORRECT;
      entry.completed = true;
      entry.attempted = true;
      markClueAsComplete(entry);
    } else if (!correct && !entry.completed && !entry.attempted) {
      score += POINTS_WRONG;
      entry.attempted = true;
    }
    if (scoreDisplay) scoreDisplay.textContent = `Pontuação: ${score}`;
  }

  // dicas
  function renderClues(numberMap) {
    if (!cluesContainer) return;
    const across = [];
    const down = [];

    for (const entry of placedWords) {
      const num = numberMap[coordKey(entry.x, entry.y)];
      const hintText = entry.hint || entry.clue || "";
      const clue = { num, text: `${num}. ${hintText}`, entry };
      if (entry.dir === "H") across.push(clue);
      else down.push(clue);
    }

    across.sort((a, b) => a.num - b.num);
    down.sort((a, b) => a.num - b.num);

    cluesContainer.innerHTML = `
      <h2>Dicas</h2>
      <strong>Horizontais:</strong>
      <ul id="across-list">
        ${across.map(c => `<li data-x="${c.entry.x}" data-y="${c.entry.y}" data-dir="H">${c.text}</li>`).join("")}
      </ul>
      <strong>Verticais:</strong>
      <ul id="down-list">
        ${down.map(c => `<li data-x="${c.entry.x}" data-y="${c.entry.y}" data-dir="V">${c.text}</li>`).join("")}
      </ul>
    `;

    attachClueEvents();
  }

  function attachClueEvents() {
    if (!cluesContainer) return;
    cluesContainer.querySelectorAll("li").forEach(li => {
      li.addEventListener("click", () => {
        const x = parseInt(li.dataset.x, 10);
        const y = parseInt(li.dataset.y, 10);
        const dir = li.dataset.dir;
        const entry = placedWords.find(w => w.x === x && w.y === y && w.dir === dir);
        if (entry) selectWord(entry);
      });
    });
  }

  function updateCluesHighlight(entry) {
    if (!cluesContainer) return;
    cluesContainer.querySelectorAll("li").forEach(li => {
      const same =
        parseInt(li.dataset.x, 10) === entry.x &&
        parseInt(li.dataset.y, 10) === entry.y &&
        li.dataset.dir === entry.dir;
      li.classList.toggle("active", same);
    });
  }

  function markClueAsComplete(entry) {
    if (!cluesContainer) return;
    const li = cluesContainer.querySelector(`li[data-x="${entry.x}"][data-y="${entry.y}"][data-dir="${entry.dir}"]`);
    if (li) li.classList.add("completed");
  }

  // overylay
  function checkVictory() {
    if (!placedWords || placedWords.length === 0) return;
    const all = placedWords.every(w => w.completed);
    if (all) showVictoryScreen();
  }

  function showVictoryScreen() {
    const ov = document.createElement("div");
    ov.id = "game-overlay";
    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = `
      <h2>🎉 Vitória!</h2>
      <p>Sua pontuação final: ${score}</p>
      <div style="margin-top:16px;">
        <button id="play-again" class="btn">Jogar Novamente</button>
      </div>
    `;
    ov.appendChild(card);
    document.body.appendChild(ov);

    document.getElementById("play-again").addEventListener("click", () => {
      document.body.removeChild(ov);
      score = 0;
      if (scoreDisplay) scoreDisplay.textContent = `Pontuação: ${score}`;
      generateCrossword(MIN_WORDS_DEFAULT);
    });
  }

  // ===== GENERATION / RESET (modo solo - idêntico ao seu) =====
  function generateCrossword(minWords = MIN_WORDS_DEFAULT) {
    let attempts = 0;
    let success = false;

    while (!success && attempts < MAX_GLOBAL_ATTEMPTS) {
      attempts++;
      grid = {};
      placedWords = [];
      cellWords = {};
      cellLocks = {};
      cellRefs = {};
      selectedWord = null;

      const pool = [...wordList].map(w => ({ word: w.word.toUpperCase(), hint: w.hint })).sort(() => Math.random() - 0.5);
      const first = pool.shift();
      placeFirstWord(first.word, first.hint);

      let tries = 0;
      for (const entry of pool) {
        const placed = findCrossPlacement(entry);
        if (!placed) tries++;
        if (tries > MAX_TRIES_PER_ATTEMPT) break;
      }

      if (placedWords.length >= minWords) success = true;
    }

    placedWords.forEach(p => { p.completed = !!p.completed; p.attempted = !!p.attempted; });

    renderGrid();
    startTimer(DEFAULT_TIMER_SECONDS);
  }

  function resetBoardState() {
    grid = {};
    placedWords = [];
    cellWords = {};
    cellLocks = {};
    cellRefs = {};
    selectedWord = null;
  }

  function resetGame() {
    score = 0;
    if (scoreDisplay) scoreDisplay.textContent = `Pontuação: ${score}`;
    generateCrossword(MIN_WORDS_DEFAULT);
  }

  // ===== TIMER =====
  function startTimer(seconds = DEFAULT_TIMER_SECONDS) {
    stopTimer();
    let timeLeft = seconds;
    if (!timerDisplay) {
      console.warn("Timer não encontrado no HTML!");
      return;
    }

    timerDisplay.textContent = formatTime(timeLeft);

    timerInterval = setInterval(() => {
      timeLeft--;
      timerDisplay.textContent = formatTime(timeLeft);
      if (timeLeft <= 0) {
        stopTimer();
        showGameOver();
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
  }

  function showGameOver() {
    const overlayEl = document.createElement("div");
    overlayEl.id = "game-overlay";
    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = `
      <h2>⏱️ Tempo Esgotado!</h2>
      <p>Sua pontuação final: ${score}</p>
      <div style="margin-top:16px;">
        <button id="play-again" class="btn">Jogar Novamente</button>
      </div>
    `;
    overlayEl.appendChild(card);
    document.body.appendChild(overlayEl);

    document.getElementById("play-again").addEventListener("click", () => {
      document.body.removeChild(overlayEl);
      score = 0;
      if (scoreDisplay) scoreDisplay.textContent = `Pontuação: ${score}`;
      generateCrossword(MIN_WORDS_DEFAULT);
    });
  }

  // ===== SERVER -> CLIENT: montar o board vindo do servidor =====
  // words: array de { word, x, y, dir, hint? || clue?, completedBy? }
  function generateCrosswordFromServer(words) {
    resetBoardState();

    // normaliza e popula grid/placedWords (guardamos word em UPPERCASE)
    words.forEach(entry => {
      const hint = entry.hint || entry.clue || "";
      const wordUp = (entry.word || "").toString().toUpperCase();
      for (let i = 0; i < wordUp.length; i++) {
        const xi = entry.dir === "H" ? entry.x + i : entry.x;
        const yi = entry.dir === "H" ? entry.y : entry.y + i;
        grid[coordKey(xi, yi)] = wordUp[i];
      }
      placedWords.push({
        word: wordUp,
        x: entry.x,
        y: entry.y,
        dir: entry.dir,
        hint,
        completed: !!entry.completedBy,
        attempted: false
      });
    });

    renderGrid();

    // trava as células que já vieram como completed
    placedWords.forEach(p => {
      if (p.completed) {
        markWordCells(p, true);
      }
    });
  }

  // ===== API =====
  window.game = {
    init,
    generateCrossword,            // modo solo
    generateCrosswordFromServer,  // modo multiplayer (usa board vindo do servidor)
    renderGrid,
    selectWord,
    checkSelectedWord,            // retorna {correct, word, coords} ou null
    setCustomWordList: (list) => {
      if (!Array.isArray(list)) return;
      wordList = list;
    },
    resetScore: () => {
      score = 0;
      if (scoreDisplay) scoreDisplay.textContent = `Pontuação: ${score}`;
    },
    getState: () => ({
      grid,
      placedWords,
      score,
      cellLocks
    }),
    updateScoreDisplay: (val) => {
      if (scoreDisplay) scoreDisplay.textContent = `Pontuação: ${val}`;
    },
    markWordCellsFromServer, // <- usada para aplicar palavras acertadas por outro jogador
    startTimer,
    stopTimer,
    GRID_SIZE,
    myId: null // <- será preenchido em main.js (socket.on("connect"))
  };
  })();
