// main.js — controla a interação cliente <-> servidor durante a partida
document.addEventListener("DOMContentLoaded", () => {
  // verifica se o módulo de jogo (window.game) foi carregado
  if (!window.game) {
    console.error("window.game não encontrado — verifique se game.js foi carregado antes do main.js");
    return;
  }
  // inicializa referências/DOM do jogo
  window.game.init();

  // pega room da query se existir (para partidas em sala)
  const urlParams = new URLSearchParams(window.location.search);
  const roomIdFromUrl = urlParams.get("room");

  // conecta socket.io (o servidor usa cookie httpOnly p/ auth)
  const socket = io();
  console.log("Socket tentando conectar...");

  socket.on("connect", () => {
    console.log("Socket conectado:", socket.id);
    if (window.game) window.game.myId = socket.id;

    // se abrimos esta página com ?room=ID, tenta entrar automaticamente na sala
    if (roomIdFromUrl) {
      console.log("Solicitando joinRoom automático para:", roomIdFromUrl);
      socket.emit("joinRoom", { roomId: roomIdFromUrl });
    }

    // preenche o nome do usuário no topo, se /api/me responder
    (async () => {
      try {
        const res = await fetch("/api/me");
        if (res.ok) {
          const me = await res.json();
          const el = document.getElementById("me-name-top");
          if (el) el.textContent = me.name || "—";
        }
      } catch (e) { /* ignorar falhas de fetch */ }
    })();
  });
  socket.on("connect_error", (err) => console.error("Erro de conexão socket:", err));

  // fallback local caso initState demore demais a chegar
  let initArrived = false;
  const FALLBACK_MS = 1200;
  const fallbackTimer = setTimeout(() => {
    if (!initArrived) {
      console.warn(`initState não chegou em ${FALLBACK_MS}ms — gerando puzzle local como fallback`);
      window.game.generateCrossword(8);
    }
  }, FALLBACK_MS);

  // inicia o timer do cliente de acordo com endTime vindo do servidor
  function startTimerFromServer(endTime) {
    if (!endTime) return;
    const now = Date.now();
    let secondsLeft = Math.ceil((endTime - now) / 1000);
    if (secondsLeft < 0) secondsLeft = 0;

    // se o próprio módulo game tem startTimer, delega a responsabilidade
    if (typeof window.game.startTimer === "function") {
      window.game.startTimer(secondsLeft);
      return;
    }

    // fallback: manipula elemento #timer diretamente
    const timerEl = document.getElementById("timer");
    if (!timerEl) return;
    if (window._mainTimerInterval) clearInterval(window._mainTimerInterval);
    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
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

  // overlay local para mostrar enquanto servidor gera o tabuleiro
  let serverGenOverlay = null;
  function showServerGenOverlay(msg) {
    if (serverGenOverlay) return;
    serverGenOverlay = document.createElement("div");
    serverGenOverlay.id = "server-gen-overlay";
    serverGenOverlay.style.position = "fixed";
    serverGenOverlay.style.inset = "0";
    serverGenOverlay.style.background = "rgba(0,0,0,0.45)";
    serverGenOverlay.style.display = "flex";
    serverGenOverlay.style.alignItems = "center";
    serverGenOverlay.style.justifyContent = "center";
    serverGenOverlay.style.zIndex = "4000";
    serverGenOverlay.innerHTML = `<div style="background:#fff;padding:18px;border-radius:8px; text-align:center; width:320px; max-width:90%;">
        <h3 style="margin:0 0 8px 0;">Aguarde</h3>
        <p style="margin:0; font-weight:600;">${(msg || 'ESPERE — O TABULEIRO ESTÁ SENDO GERADO').toString()}</p>
      </div>`;
    document.body.appendChild(serverGenOverlay);
  }
  function hideServerGenOverlay() {
    if (!serverGenOverlay) return;
    document.body.removeChild(serverGenOverlay);
    serverGenOverlay = null;
  }

  // eventos que indicam que o servidor está gerando o board
  socket.on("boardGenerating", (payload) => {
    showServerGenOverlay(payload && payload.message ? payload.message : "ESPERE — O TABULEIRO ESTÁ SENDO GERADO");
  });

  // initState: estado inicial enviado pelo servidor quando o cliente se conecta (ou entra em sala)
  socket.on("initState", (state) => {
    initArrived = true;
    clearTimeout(fallbackTimer);
    hideServerGenOverlay();

    console.log("initState recebido (raw):", state);

    // extrai palavras do payload — compatibiliza formatos possíveis
    let words = null;
    if (state) {
      if (state.board && Array.isArray(state.board.words)) words = state.board.words;
      else if (Array.isArray(state.words)) words = state.words;
      else if (Array.isArray(state.board)) words = state.board;
    }

    // se o servidor enviou um board válido, monta-o; senão gera localmente
    if (words && words.length) {
      window.game.generateCrosswordFromServer(words);
    } else {
      console.warn("initState sem words válidas — gerando local");
      window.game.generateCrossword(8);
    }

    // se houver tempo restante e estivermos em sala, sincroniza timer
    if (state && state.endTime && roomIdFromUrl) {
      startTimerFromServer(state.endTime);
    }

    // renderiza placar vindo do servidor, se houver
    if (state && state.scores) renderScores(state.scores, state.players || {});

    try {
      if (window.game && typeof window.game.setRemoteState === "function") {
        window.game.setRemoteState(state.scores || {}, state.players || {});
      }
    } catch (e) { console.warn("setRemoteState falhou:", e); }
  });


  // updateBoard: atualizações periódicas do servidor (palavras completadas, scores, fim de jogo)
  socket.on("updateBoard", (state) => {
    hideServerGenOverlay();

    if (state && state.endTime && roomIdFromUrl) startTimerFromServer(state.endTime);

    if (state && state.scores) renderScores(state.scores, state.players || {});

    console.log("updateBoard recebido:", state);

    if (!window.game || !state.board) return;
    const local = window.game.getState();

    // atualiza score do jogador local usando o mapa de scores do servidor
    const myScore = (state.scores && window.game.myId) ? (state.scores[window.game.myId] || 0) : 0;
    window.game.updateScoreDisplay(myScore);

    // aplica mudanças vindas do servidor (marcar células completadas por outros)
    for (const srvWord of state.board.words) {
      const localEntry = local.placedWords.find(
        w => w.x === srvWord.x && w.y === srvWord.y && w.dir === srvWord.dir
      );
      if (srvWord.completedBy && (!localEntry || !localEntry.completed)) {
        window.game.markWordCellsFromServer(srvWord);
      }
    }
    try {
      if (window.game && typeof window.game.setRemoteState === "function") {
        window.game.setRemoteState(state.scores || {}, state.players || {});
      }
    } catch (e) { console.warn("setRemoteState falhou:", e); }
  });

  // log quando a partida está prestes a começar
  socket.on("gameStarting", (payload) => {
    console.log("gameStarting recebido:", payload);
  });

  // pequeno som/efeito — beeps para notificar final de jogo
  function playBeep(duration = 0.14, freq = 880, type = 'sine') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      o.start();
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      setTimeout(() => { o.stop(); ctx.close(); }, duration * 1000 + 50);
    } catch (e) { console.warn("Audio não disponível:", e); }
  }

  // quando o servidor emite gameEnded, mostra a tela final com vencedor e pontuações
  socket.on("gameEnded", (data) => {
    console.log("gameEnded recebido:", data);
    playBeep(0.14, 880, 'sine');

    const youId = socket.id;
    const winnerId = data && data.winnerId;
    const winnerScore = data && data.winnerScore;
    const winnerName = (data.players && data.players[winnerId]) || (winnerId ? winnerId.slice(0,6) : "—");
    const youWin = (winnerId === youId);

    let title = "Partida Encerrada";
    let message = "";
    if (youWin) {
      title = "🎉 Você venceu!";
      message = `Pontos: ${winnerScore}`;
    } else {
      title = "Partida Encerrada";
      message = `Vencedor: ${winnerName} — ${winnerScore} pontos`;
    }

    const myScore = (data && data.scores && window.game && window.game.myId) ? (data.scores[window.game.myId] || 0) : null;

    // usa API do módulo game para exibir tela final (overlay)
    window.game.showFinalScreen({
      title,
      message,
      scoreVal: myScore !== null ? myScore : winnerScore
    });
  });


  // utilitário para escapar HTML (prevenir XSS)
  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'})[c]);
  }

  // renderiza o placar lateral com jogadores (apenas usuários autenticados aparecem)
  function renderScores(scores = {}, players = {}) {
    const scoreEl = document.getElementById("score");
    if (!scoreEl) return;

    const myId = (window.game && window.game.myId) ? window.game.myId : socket.id;

    // monta lista apenas com players autenticados (nome truthy)
    const list = [];

    Object.entries(players || {}).forEach(([id, name]) => {
      if (!name) return; // ignora convidados
      list.push({
        id,
        name: String(name),
        score: Number((scores && scores[id]) || 0)
      });
    });

    const myScore = (scores && (scores[myId] !== undefined)) ? scores[myId] : (window.game && window.game.getState ? (window.game.getState().score || 0) : 0);

    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (a.name || "").localeCompare(b.name || "");
    });

    let html = `<span class="label">Placar</span><span class="value">${String(myScore || 0)}</span>`;

    if (list.length > 0) {
      html += `<div class="players-list" style="margin-top:8px;">`;
      for (const p of list) {
        const isMe = p.id === myId;
        html += `<div class="player-row" style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px;">
          <div style="display:flex;gap:8px;align-items:center;">
            ${isMe ? '<strong style="margin-right:6px">(Você)</strong>' : ''}
            <span class="player-name">${escapeHtml(p.name)}</span>
          </div>
          <div class="player-score" style="font-weight:700;">${escapeHtml(String(p.score))}</div>
        </div>`;
      }
      html += `</div>`;
    }

    scoreEl.innerHTML = html;
  }

  // listener global para cliques — usado para botão "Voltar ao Hub" dentro do overlay final
  document.addEventListener("click", (ev) => {
    const t = ev.target;
    if (!t) return;
    if (t.id === "final-back-hub") {
      try {
        const params = new URLSearchParams(window.location.search);
        const rid = params.get("room");
        if (rid && socket && socket.connected) {
          socket.emit("leaveRoom", { roomId: rid });
        }
      } catch (e) {}

      window.location.href = "/hub.html";
    }
  });

  // pressionar Enter checa a palavra selecionada e notifica o servidor:
  // - em acerto -> wordSolved
  // - em erro  -> wordAttempt (servidor aplica -5 apenas na primeira tentativa deste jogador pra essa palavra)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const result = window.game.checkSelectedWord();
      if (result) {
        const params = new URLSearchParams(window.location.search);
        const rid = params.get("room");
        const payload = {
          word: result.word,
          x: result.coords.x,
          y: result.coords.y,
          dir: result.coords.dir
        };
        if (rid) payload.roomId = rid;

        if (result.correct) {
          socket.emit("wordSolved", payload);
        } else {
          // nova emissão para tentativas incorretas — o servidor aplicará -5 (uma vez por jogador por palavra)
          socket.emit("wordAttempt", payload);
        }
      }
    }
  });

  // profile + logout (comportamento local do modal de perfil)
  (function wireProfile() {
    const profileBtn = document.getElementById("btn-profile");
    const logoutBtn = document.getElementById("btn-logout");
    const profileModal = document.getElementById("profile-modal");
    const profileName = document.getElementById("profile-name");
    const profileEmail = document.getElementById("profile-email");
    const profileClose = document.getElementById("profile-close");
    const profileLogout = document.getElementById("profile-logout");

    async function loadMe() {
      try {
        const res = await fetch("/api/me");
        if (!res.ok) return null;
        return await res.json();
      } catch (e) { return null; }
    }

    async function openProfile() {
      const me = await loadMe();
      if (me) {
        if (profileName) profileName.textContent = me.name || "—";
        if (profileEmail) profileEmail.textContent = me.email || "—";
      }
      if (profileModal) {
        profileModal.style.display = "flex";
        profileModal.setAttribute("aria-hidden", "false");
        // desabilita rolagem e interações do fundo
        document.body.style.overflow = "hidden";
        document.documentElement.classList.add("modal-open");
      }
    }
    function closeProfile() {
      if (profileModal) {
        profileModal.style.display = "none";
        profileModal.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
        document.documentElement.classList.remove("modal-open");
      }
    }
    async function doLogout() {
      try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
      window.location.href = "/auth.html";
    }

    if (profileBtn) profileBtn.addEventListener("click", openProfile);
    if (profileClose) profileClose.addEventListener("click", closeProfile);
    if (profileLogout) profileLogout.addEventListener("click", doLogout);
    if (logoutBtn) logoutBtn.addEventListener("click", doLogout);
  })();

});
