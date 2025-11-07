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

    // profile & logout
    document.getElementById("btn-logout").addEventListener("click", async () => {
      try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
      window.location.href = "/auth.html";
    });

    document.getElementById("btn-profile").addEventListener("click", () => {
      alert(`Nome: ${me.name}\nEmail: ${me.email}`);
    });

    const roomNameInput = document.getElementById("room-name");
    const createBtn = document.getElementById("create-room");
    const refreshBtn = document.getElementById("refresh-rooms");
    const roomsList = document.getElementById("rooms-list");

    const socket = io();
    socket.on("connect", () => {
      socket.emit("requestRoomList");
    });

    socket.on("roomList", (list) => {
      roomsList.innerHTML = "";
      const keys = Object.keys(list || {});
      if (!keys.length) {
        roomsList.innerHTML = `<div class="empty">Nenhuma sala criada ainda.</div>`;
        return;
      }
      keys.forEach(id => {
        const r = list[id];
        const playersCount = Object.keys(r.players || {}).length;
        const el = document.createElement("div");
        el.className = "room";
        el.innerHTML = `<div class="meta"><strong>${id}</strong> ${r.name ? "- " + escapeHtml(r.name) : ""} <span class="small">(${playersCount} jogador${playersCount===1? "":"es"})</span></div>
          <div class="actions">
            <button class="btn join" data-id="${id}">Entrar</button>
          </div>`;
        roomsList.appendChild(el);
      });

      roomsList.querySelectorAll("button.join").forEach(b => {
        b.addEventListener("click", (ev) => {
          const rid = b.dataset.id;
          b.disabled = true;
          socket.emit("joinRoom", { roomId: rid }, (res) => {
            b.disabled = false;
            if (res && res.ok && res.roomId) {
              window.location.href = `/lobby.html?room=${encodeURIComponent(res.roomId)}`;
            } else {
              alert("Erro ao entrar na sala: " + (res && res.message ? res.message : "Desconhecido"));
            }
          });
        });
      });
    });

    createBtn.addEventListener("click", () => {
      const name = roomNameInput.value.trim();
      createBtn.disabled = true;
      createBtn.textContent = "Criando...";
      socket.emit("createRoom", { name }, (ack) => {
        // server also emits createRoomResult; but safe to rely on ack if provided
        createBtn.disabled = false;
        createBtn.textContent = "Criar Sala";
      });
    });

    socket.on("createRoomResult", (res) => {
      createBtn.disabled = false;
      createBtn.textContent = "Criar Sala";
      if (res && res.ok && res.roomId) {
        window.location.href = `/lobby.html?room=${encodeURIComponent(res.roomId)}`;
      } else {
        alert("Erro criando sala: " + (res && res.message ? res.message : "Desconhecido"));
      }
    });

    refreshBtn.addEventListener("click", () => socket.emit("requestRoomList"));

    socket.on("connect_error", (err) => {
      console.error("Erro de conexão socket:", err);
      roomsList.innerHTML = `<div class="empty">Erro de conexão com o servidor.</div>`;
    });

    function escapeHtml(s) {
      if (!s) return "";
      return s.replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'})[c]);
    }
  })();
});
