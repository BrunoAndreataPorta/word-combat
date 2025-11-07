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
    document.getElementById("me-name").textContent = me.name || "—";

    // room from query
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get("room");
    let currentRoom = roomFromUrl || null;
    if (currentRoom) document.getElementById("room-id").textContent = currentRoom;

    // profile / logout
    document.getElementById("btn-profile").addEventListener("click", () => {
      alert(`Nome: ${me.name}\nEmail: ${me.email}`);
    });
    document.getElementById("btn-logout").addEventListener("click", async () => {
      try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
      window.location.href = "/auth.html";
    });

    const playerListEl = document.getElementById("player-list");
    const startBtn = document.getElementById("start-btn");
    const leaveBtn = document.getElementById("leave-btn");

    const socket = io();
    let mySocketId = null;
    socket.on("connect", () => {
      mySocketId = socket.id;
      if (currentRoom) {
        // use callback ack to know if join succeeded
        socket.emit("joinRoom", { roomId: currentRoom }, (res) => {
          if (!res || !res.ok) {
            alert("Erro ao entrar na sala. Você será redirecionado ao hub.");
            window.location.href = "/hub.html";
          } else {
            currentRoom = res.roomId;
            document.getElementById("room-id").textContent = currentRoom;
          }
        });
      }
    });

    // lobbyUpdate: may be global or room-scoped. If roomId present, only handle if matches currentRoom.
    socket.on("lobbyUpdate", (data) => {
      const roomId = data && data.roomId;
      if (roomId && currentRoom && roomId !== currentRoom) return; // ignore unrelated room updates
      const players = (data && data.players) || {};
      const hostId = data && data.hostId;
      renderPlayers(players, hostId);
    });

    socket.on("createRoomResult", (res) => {
      // not used here but keep for completeness
    });

    socket.on("joinRoomResult", (res) => {
      // if server emits joinRoomResult (without callback), handle fallback
      if (res && res.ok && res.roomId) {
        currentRoom = res.roomId;
        document.getElementById("room-id").textContent = currentRoom;
      } else if (res && !res.ok) {
        alert("Erro ao entrar na sala: " + (res.message || "Desconhecido"));
        window.location.href = "/hub.html";
      }
    });

    socket.on("gameStarting", (payload) => {
      // server may emit room-specific gameStarting { roomId }
      if (payload && payload.roomId && currentRoom && payload.roomId === currentRoom) {
        window.location.href = `/index.html?room=${encodeURIComponent(currentRoom)}`;
      }
    });

    socket.on("connect_error", (err) => console.error("Erro de conexão socket:", err));

    startBtn.addEventListener("click", () => {
      if (!currentRoom) { alert("Você não está em uma sala válida."); return; }
      startBtn.disabled = true;
      socket.emit("startGame", { roomId: currentRoom });
      setTimeout(() => { startBtn.disabled = false; }, 3000);
    });

    leaveBtn.addEventListener("click", () => {
      if (currentRoom) socket.emit("leaveRoom", { roomId: currentRoom });
      window.location.href = "/hub.html";
    });

    function renderPlayers(players = {}, hostId = null) {
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
