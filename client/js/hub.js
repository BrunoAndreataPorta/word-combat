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

    // profile & logout (aplicando guards para evitar erros quando elementos forem removidos)
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
        window.location.href = "/auth.html";
      });
    }
    
    const btnProfile = document.getElementById("btn-profile");
    if (btnProfile) {
      btnProfile.addEventListener("click", () => {
        // se profile.js estiver presente, use-o; senão caia para alert (compatibilidade)
        if (window.profileUI && typeof window.profileUI.open === "function") {
          window.profileUI.open();
        } else {
          alert(`Nome: ${me.name}\nEmail: ${me.email}`);
        }
      });
    }

    const roomNameInput = document.getElementById("room-name");
    const createBtn = document.getElementById("create-room");
    const refreshBtn = document.getElementById("refresh-rooms");
    const roomsList = document.getElementById("rooms-list");

    const socket = io();
    socket.on("connect", () => {
      // pede a lista de salas ao conectar (server deve responder com 'roomList')
      socket.emit("requestRoomList");
    });

    socket.on("roomList", (list) => {
      if (!roomsList) return;
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

    // Cria modal com - "Gerar com IA" + Tema
    if (createBtn) {
      createBtn.addEventListener("click", () => {
        showCreateModal();
      });
    }

    function showCreateModal() {
      if (document.getElementById("create-room-modal")) return;

      const modal = document.createElement("div");
      modal.id = "create-room-modal";
      modal.style.position = "fixed";
      modal.style.inset = "0";
      modal.style.background = "rgba(0,0,0,0.45)";
      modal.style.display = "flex";
      modal.style.alignItems = "center";
      modal.style.justifyContent = "center";
      modal.style.zIndex = "2000";

      modal.innerHTML = `
        <div style="background:#fff; padding:18px; border-radius:8px; width:420px; max-width:96%; box-shadow:0 8px 24px rgba(0,0,0,0.2);">
          <h3 style="margin:0 0 8px 0;">Criar Sala</h3>
          <div style="margin-bottom:8px;">
            <label>Nome da sala (opcional)</label>
            <input id="modal-room-name" class="input" style="width:100%; margin-top:6px;" placeholder="Ex: Amigos" />
          </div>
          <div style="margin-bottom:8px;">
            <label><input type="checkbox" id="modal-use-gen" /> Gerar com IA</label>
          </div>
          <div style="margin-bottom:8px;">
            <label>Tema (opcional)</label>
            <input id="modal-theme" class="input" style="width:100%; margin-top:6px;" placeholder="ex: animais" disabled />
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
            <button id="modal-cancel" class="btn secondary">Cancelar</button>
            <button id="modal-create" class="btn">Criar Sala</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      const useGen = modal.querySelector("#modal-use-gen");
      const themeInput = modal.querySelector("#modal-theme");
      const nameInput = modal.querySelector("#modal-room-name");
      const cancelBtn = modal.querySelector("#modal-cancel");
      const createNow = modal.querySelector("#modal-create");

      function setAiControlsEnabled(enable) {
        themeInput.disabled = !enable;
        if (!enable) {
          themeInput.value = "";
        }
      }

      if (useGen) useGen.addEventListener("change", () => {
        setAiControlsEnabled(!!useGen.checked);
      });

      if (cancelBtn) cancelBtn.addEventListener("click", () => {
        document.body.removeChild(modal);
      });

      if (createNow) {
        createNow.addEventListener("click", () => {
          const name = (nameInput.value || "").trim();

          const aiOptions = {
            useGen: !!useGen.checked,
            theme: (themeInput.value || "").trim() || null,
            count: 20,
            replaceDefault: false 
          };

          createNow.disabled = true;
          createBtn.disabled = true;

          socket.once("createRoomResult", (res) => {
            createNow.disabled = false;
            createBtn.disabled = false;
            if (res && res.ok && res.roomId) {
              window.location.href = `/lobby.html?room=${encodeURIComponent(res.roomId)}`;
            } else {
              alert("Falha ao criar sala: " + (res && res.message ? res.message : "Erro desconhecido"));
            }
          });

          socket.emit("createRoom", { name, aiOptions });

          document.body.removeChild(modal);
        });
      }
    }

    if (refreshBtn) refreshBtn.addEventListener("click", () => socket.emit("requestRoomList"));

    socket.on("connect_error", (err) => {
      console.error("Erro de conexão socket:", err);
      if (roomsList) roomsList.innerHTML = `<div class="empty">Erro de conexão com o servidor.</div>`;
    });

    function escapeHtml(s) {
      if (!s) return "";
      return s.replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'})[c]);
    }
  })();
});
