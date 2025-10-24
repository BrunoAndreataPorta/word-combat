document.addEventListener("DOMContentLoaded", () => {
  if (!window.game) {
    console.error("window.game não encontrado — verifique se game.js foi carregado antes do main.js");
    return;
  }
  window.game.init();

  const socket = io();
  console.log("Socket tentando conectar...");

  socket.on("connect", () => {
    console.log("Socket conectado:", socket.id);
    if (window.game) window.game.myId = socket.id;
  });
  socket.on("connect_error", (err) => console.error("Erro de conexão socket:", err));

  // fallback local caso init não chegue
  let initArrived = false;
  const FALLBACK_MS = 1200;
  const fallbackTimer = setTimeout(() => {
    if (!initArrived) {
      console.warn(`initState não chegou em ${FALLBACK_MS}ms — gerando puzzle local como fallback`);
      window.game.generateCrossword(8);
    }
  }, FALLBACK_MS);

  function startTimerFromServer(endTime) {
    // endTime em ms
    if (!endTime) return;
    const now = Date.now();
    let secondsLeft = Math.ceil((endTime - now) / 1000);
    if (secondsLeft < 0) secondsLeft = 0;

    // usa startTimer do game se existir
    if (typeof window.game.startTimer === "function") {
      window.game.startTimer(secondsLeft);
      return;
    }

    // fallback simples caso startTimer não exista:
    const timerEl = document.getElementById("timer");
    if (!timerEl) return;
    if (window._mainTimerInterval) clearInterval(window._mainTimerInterval);
    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    timerEl.textContent = formatTime(secondsLeft);
    window._mainTimerInterval = setInterval(() => {
      secondsLeft--;
      timerEl.textContent = formatTime(Math.max(0, secondsLeft));
      if (secondsLeft <= 0) {
        clearInterval(window._mainTimerInterval);
      }
    }, 1000);
  }

  socket.on("initState", (state) => {
    initArrived = true;
    clearTimeout(fallbackTimer);
    console.log("initState recebido (raw):", state);

    // tenta achar palavras em vários formatos
    let words = null;
    if (state) {
      if (state.board && Array.isArray(state.board.words)) words = state.board.words;
      else if (Array.isArray(state.words)) words = state.words;
      else if (Array.isArray(state.board)) words = state.board;
    }

    if (words && words.length) {
      window.game.generateCrosswordFromServer(words);
    } else {
      console.warn("initState sem words válidas — gerando local");
      window.game.generateCrossword(8);
    }

    // start timer a partir do endTime enviado pelo servidor
    if (state && state.endTime) {
      startTimerFromServer(state.endTime);
    }

    if (state && state.scores) renderScores(state.scores);
  });

  socket.on("updateBoard", (state) => {

    // sincroniza timer do servidor (se enviado)
    if (state && state.endTime) startTimerFromServer(state.endTime);

    // atualiza placar global
    if (state && state.scores) renderScores(state.scores);


    console.log("updateBoard recebido:", state);

    if (!window.game || !state.board) return;
    const local = window.game.getState();

    // Atualiza pontuação
    const myScore = state.scores[window.game.myId] || 0;
    window.game.updateScoreDisplay(myScore);

    // Atualiza palavras completadas
    for (const srvWord of state.board.words) {
      const localEntry = local.placedWords.find(
        w => w.x === srvWord.x && w.y === srvWord.y && w.dir === srvWord.dir
      );
      if (srvWord.completedBy && (!localEntry || !localEntry.completed)) {
        window.game.markWordCellsFromServer(srvWord);
      }
    }
  });


  function renderScores(scores) {
    const scoreEl = document.getElementById("score");
    if (!scoreEl) return;
    let html = `<div style="font-weight:700">Placar</div>`;
    Object.entries(scores).forEach(([id, points]) => {
      html += `<div><strong>${id.slice(0, 6)}:</strong> ${points}</div>`;
    });
    scoreEl.innerHTML = html;
  }

  const btn = document.getElementById("generate-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      console.log("Solicitando novo tabuleiro ao servidor (requestNewBoard)");
      socket.emit("requestNewBoard");
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const result = window.game.checkSelectedWord();
      if (result) {
        console.log("Resultado da checagem:", result);
        if (result.correct) {
          // envia word + coords no nível superior para o servidor (x,y,dir)
          socket.emit("wordSolved", {
            word: result.word,
            x: result.coords.x,
            y: result.coords.y,
            dir: result.coords.dir
          });
        }
      } else {
        console.log("Nenhuma palavra selecionada ao pressionar Enter.");
      }
    }
  });

});
