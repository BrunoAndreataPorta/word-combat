document.addEventListener("DOMContentLoaded", () => {
  async function getMe() {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  (async () => {
    const me = await getMe();
    if (!me) {
      window.location.href = "/auth.html";
      return;
    }

    const meNameEl = document.getElementById("me-name");
    if (meNameEl) meNameEl.textContent = me.name || "—";

    // room from query
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    let currentRoom = roomFromUrl || null;
    if (currentRoom) {
      const ridEl = document.getElementById("room-id");
      if (ridEl) ridEl.textContent = currentRoom;
    }

    // profile / logout
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
        window.location.href = "/auth.html";
      });
    }
    
    // player list / controls (guarded)
    const playerListEl = document.getElementById("player-list");
    const startBtn = document.getElementById("start-btn");
    const leaveBtn = document.getElementById("leave-btn");

    const socket = io();
    let mySocketId = null;
    let amIHost = false; // flag confiável sobre se este cliente é host

    socket.on("connect", () => {
      mySocketId = socket.id;
      if (currentRoom) {
        socket.emit("joinRoom", { roomId: currentRoom }, (res) => {
          if (!res || !res.ok) {
            alert("Erro ao entrar na sala. Você será redirecionado ao hub.");
            window.location.href = "/hub.html";
          } else {
            currentRoom = res.roomId;
            const ridEl = document.getElementById("room-id");
            if (ridEl) ridEl.textContent = currentRoom;
          }
        });
      }
    });

    // botão de começar habilitado apenas para o host
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

    // OVERLAY para mostrar enquanto o tabuleiro esta sendo feito
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

    socket.on("boardGenerating", (payload) => {
      showGeneratingOverlay(payload && payload.message ? payload.message : "ESPERE — O TABULEIRO ESTÁ SENDO GERADO");
    });

    socket.on("updateBoard", (state) => {
      hideGeneratingOverlay();
    });
    socket.on("initState", (state) => {
      hideGeneratingOverlay();
    });

    socket.on("lobbyUpdate", (data) => {
      const roomId = data && data.roomId;
      if (roomId && currentRoom && roomId !== currentRoom) return; // ignore unrelated room updates
      const players = (data && data.players) || {};
      const hostId = data && data.hostId;

      amIHost = !!(hostId && mySocketId && hostId === mySocketId);
      setStartBtnHostVisibility(amIHost);

      renderPlayers(players, hostId);
    });

    socket.on("createRoomResult", (res) => {
      if (res && res.ok && res.roomId) {
        currentRoom = res.roomId;
        const ridEl = document.getElementById("room-id");
        if (ridEl) ridEl.textContent = currentRoom;
      }
    });

    socket.on("joinRoomResult", (res) => {
      if (res && res.ok && res.roomId) {
        currentRoom = res.roomId;
        const ridEl = document.getElementById("room-id");
        if (ridEl) ridEl.textContent = currentRoom;
      } else if (res && !res.ok) {
        alert("Erro ao entrar na sala: " + (res.message || "Desconhecido"));
        window.location.href = "/hub.html";
      }
    });

    socket.on("gameStarting", (payload) => {
      if (payload && payload.roomId && currentRoom && payload.roomId === currentRoom) {
        window.location.href = `/index.html?room=${encodeURIComponent(currentRoom)}`;
      }
    });

    socket.on("connect_error", (err) => console.error("Erro de conexão socket:", err));

    if (startBtn) {
      startBtn.addEventListener("click", () => {
        if (!amIHost) return;

        if (!currentRoom) { alert("Você não está em uma sala válida."); return; }
        startBtn.disabled = true;
        socket.emit("startGame", { roomId: currentRoom });
        setTimeout(() => { startBtn.disabled = false; }, 3000);
      });
    }

    if (leaveBtn) {
      leaveBtn.addEventListener("click", () => {
        if (currentRoom) socket.emit("leaveRoom", { roomId: currentRoom });
        window.location.href = "/hub.html";
      });
    }

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

    function escapeHtml(s) {
      if (!s) return "";
      return s.replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'})[c]);
    }
  })();
});
