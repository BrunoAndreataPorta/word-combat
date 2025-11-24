// lobby.js — controladora do lobby (mostra tema da sala em destaque)
// Comentários em português explicando responsabilidades e trechos-chave.
document.addEventListener("DOMContentLoaded", () => {
  // Função auxiliar: busca dados do usuário em /api/me
  async function getMe() {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  (async () => {
    // valida autenticação; se não autenticado, redireciona para auth
    const me = await getMe();
    if (!me) {
      window.location.href = "/auth.html";
      return;
    }
    // atualiza nome do usuário no topo do lobby
    document.getElementById("me-name").textContent = me.name || "—";

    // lê room id da querystring (se a página foi aberta com ?room=)
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    let currentRoom = roomFromUrl || null;
    if (currentRoom) {
      const ridEl = document.getElementById("room-id");
      if (ridEl) ridEl.textContent = currentRoom;
    }

    // referências aos elementos do DOM usadas no script (cache para performance)
    const btnLogout = document.getElementById("btn-logout");
    const playerListEl = document.getElementById("player-list");
    const startBtn = document.getElementById("start-btn");
    const leaveBtn = document.getElementById("leave-btn");
    const lobbyHeaderEl = document.querySelector(".lobby-header"); // onde o badge de tema será inserido
    const roomIdEl = document.getElementById("room-id");

    // bind seguro para logout (só liga se o botão existir)
    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
        window.location.href = "/auth.html";
      });
    }

    // abre conexão socket.io
    const socket = io();
    let mySocketId = null;
    let amIHost = false;

    // criação/atualização do badge que mostra o tema da sala no lobby
    // se theme for falsy o badge é removido
    function updateRoomThemeBadge(theme, useGen = false) {
      if (!lobbyHeaderEl) return;
      const existing = document.getElementById("room-theme-badge");

      // se não há tema, remove badge existente e retorna
      if (!theme) {
        if (existing) existing.remove();
        return;
      }

      const label = useGen ? `Tema (IA): ${theme}` : `Tema: ${theme}`;

      // se já existe apenas atualiza o texto
      if (existing) {
        existing.textContent = label;
        return;
      }

      // cria novo badge pequeno e discreto para exibir o tema
      const badge = document.createElement("div");
      badge.id = "room-theme-badge";
      badge.style.fontSize = "13px";
      badge.style.color = "var(--muted)";
      badge.style.marginTop = "6px";
      badge.style.display = "inline-block";
      badge.style.padding = "6px 8px";
      badge.style.borderRadius = "8px";
      badge.style.background = "rgba(15,23,36,0.03)";
      badge.style.border = "1px solid rgba(0,0,0,0.04)";
      badge.style.marginLeft = "8px";
      badge.textContent = label;

      // insere o badge próximo ao bloco que contém o room-id
      const firstCol = lobbyHeaderEl.querySelector("div");
      if (firstCol) {
        firstCol.appendChild(badge);
      } else {
        // fallback caso a estrutura esperada seja diferente
        lobbyHeaderEl.appendChild(badge);
      }
    }

    // ao conectar, guarda socket.id e tenta juntar na sala automaticamente se veio ?room=
    socket.on("connect", () => {
      mySocketId = socket.id;
      if (currentRoom) {
        socket.emit("joinRoom", { roomId: currentRoom }, (res) => {
          if (!res || !res.ok) {
            alert("Erro ao entrar na sala. Você será redirecionado ao hub.");
            window.location.href = "/hub.html";
          } else {
            currentRoom = res.roomId;
            if (roomIdEl) roomIdEl.textContent = currentRoom;
          }
        });
      }
    });

    // controla visibilidade/estado do botão "Iniciar" — só host pode iniciar
    function setStartBtnHostVisibility(isHost) {
      if (!startBtn) return;
      if (isHost) {
        startBtn.disabled = false;
        startBtn.style.opacity = "1";
        startBtn.style.pointerEvents = "auto";
        startBtn.style.cursor = "pointer";
        startBtn.title = "";
      } else {
        startBtn.disabled = true;
        startBtn.style.opacity = "0.32";
        startBtn.style.pointerEvents = "none";
        startBtn.style.cursor = "default";
        startBtn.title = "Somente o host pode iniciar a partida";
      }
    }
    setStartBtnHostVisibility(false);

    // overlay mostrado enquanto o servidor gera o tabuleiro (feedback visual)
    let genOverlay = null;
    function showGeneratingOverlay(msg) {
      if (genOverlay) return;
      genOverlay = document.createElement("div");
      genOverlay.id = "gen-overlay";
      genOverlay.style.position = "fixed";
      genOverlay.style.inset = "0";
      genOverlay.style.background = "rgba(0,0,0,0.45)";
      genOverlay.style.display = "flex";
      genOverlay.style.alignItems = "center";
      genOverlay.style.justifyContent = "center";
      genOverlay.style.zIndex = "2500";
      genOverlay.innerHTML = `<div style="background:#fff;padding:18px;border-radius:8px; text-align:center; width:320px; max-width:90%;">
          <h3 style="margin:0 0 8px 0;">Aguarde</h3>
          <p style="margin:0 0 12px 0; font-weight:600;">${msg || 'ESPERE — O TABULEIRO ESTÁ SENDO GERADO'}</p>
        </div>`;
      document.body.appendChild(genOverlay);
    }
    function hideGeneratingOverlay() {
      if (!genOverlay) return;
      document.body.removeChild(genOverlay);
      genOverlay = null;
    }

    // trata eventos enviados pelo servidor indicando geração do board
    socket.on("boardGenerating", (payload) => {
      showGeneratingOverlay(payload && payload.message ? payload.message : "ESPERE — O TABULEIRO ESTÁ SENDO GERADO");
    });

    // quando receber update/init do board, remove overlay (se estava mostrando)
    socket.on("updateBoard", (state) => {
      hideGeneratingOverlay();
    });
    socket.on("initState", (state) => {
      hideGeneratingOverlay();
    });

    // atualizações do lobby (lista de jogadores, host e aiOptions/tema)
    socket.on("lobbyUpdate", (data) => {
      const roomId = data && data.roomId;
      // ignora updates de salas diferentes da que estamos
      if (roomId && currentRoom && roomId !== currentRoom) return;

      const players = (data && data.players) || {};
      const hostId = data && data.hostId;
      const aiOptions = data && data.aiOptions ? data.aiOptions : null;

      // se o servidor informou aiOptions com tema, atualiza badge
      if (aiOptions && aiOptions.theme) {
        updateRoomThemeBadge(aiOptions.theme, !!aiOptions.useGen);
      } else {
        // senão remove badge
        updateRoomThemeBadge(null);
      }

      // atualiza flag de host e ajusta UI do botão iniciar
      amIHost = !!(hostId && mySocketId && hostId === mySocketId);
      setStartBtnHostVisibility(amIHost);

      renderPlayers(players, hostId);
    });

    // ao criar sala (createRoom) o servidor responde com createRoomResult
    socket.on("createRoomResult", (res) => {
      if (res && res.ok && res.roomId) {
        currentRoom = res.roomId;
        if (roomIdEl) roomIdEl.textContent = currentRoom;
        // pede lista de salas atualizada para obter aiOptions/tema da nova sala
        socket.emit("requestRoomList");
      }
    });

    // joinRoomResult (quando chega sem callback) — atualiza currentRoom e solicita infos
    socket.on("joinRoomResult", (res) => {
      if (res && res.ok && res.roomId) {
        currentRoom = res.roomId;
        if (roomIdEl) roomIdEl.textContent = currentRoom;
        socket.emit("requestRoomList");
      } else if (res && !res.ok) {
        alert("Erro ao entrar na sala: " + (res.message || "Desconhecido"));
        window.location.href = "/hub.html";
      }
    });

    // event: sala iniciou o jogo -> redireciona cliente para index (jogo)
    socket.on("gameStarting", (payload) => {
      if (payload && payload.roomId && currentRoom && payload.roomId === currentRoom) {
        window.location.href = `/index.html?room=${encodeURIComponent(currentRoom)}`;
      }
    });

    socket.on("connect_error", (err) => console.error("Erro de conexão socket:", err));

    // tratamento do clique em "Iniciar" — apenas o host pode disparar startGame
    if (startBtn) {
      startBtn.addEventListener("click", () => {
        if (!amIHost) return;
        if (!currentRoom) { alert("Você não está em uma sala válida."); return; }
        startBtn.disabled = true;
        socket.emit("startGame", { roomId: currentRoom });
        setTimeout(() => { startBtn.disabled = false; }, 3000);
      });
    }

    // sair da sala: avisa servidor e volta ao hub; limpa badge de tema
    if (leaveBtn) {
      leaveBtn.addEventListener("click", () => {
        if (currentRoom) socket.emit("leaveRoom", { roomId: currentRoom });
        updateRoomThemeBadge(null);
        window.location.href = "/hub.html";
      });
    }

    // renderiza a lista de jogadores no lobby (nome + badge de host + indicação "você")
    function renderPlayers(players = {}, hostId = null) {
      if (!playerListEl) return;
      playerListEl.innerHTML = "";
      for (const [id, name] of Object.entries(players)) {
        const displayName = name || "(convidado)";
        const isHost = id === hostId;
        const isMe = id === mySocketId;
        const el = document.createElement("div");
        el.className = "player-item";
        el.innerHTML = `<div><strong>${escapeHtml(displayName)}</strong> ${isHost ? '<span class="host-badge">(host)</span>' : ''} ${isMe ? '<span style="margin-left:8px; color:var(--muted); font-size:12px">(você)</span>' : ''}</div>
                        <div style="font-size:12px; color:var(--muted)">${escapeHtml(id.slice(0,6))}</div>`;
        playerListEl.appendChild(el);
      }
    }

    // utilitário simples para escapar texto antes de injetar no HTML (evita XSS)
    function escapeHtml(s) {
      if (!s) return "";
      return s.replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'})[c]);
    }
  })();
});
