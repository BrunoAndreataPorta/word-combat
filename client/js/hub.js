// hub.js — lista salas ativas, cria salas (modal) e mostra detalhes antes de entrar
document.addEventListener("DOMContentLoaded", () => {
  // busca /api/me para obter informação do usuário atual
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
      // se não autenticado, redireciona para a tela de auth
      window.location.href = "/auth.html";
      return;
    }

    // atualiza o nome do usuário no topo
    const meNameEl = document.getElementById("me-name");
    if (meNameEl) meNameEl.textContent = me.name || "—";

    // logout — proteção caso o botão seja removido do HTML
    const btnLogout = document.getElementById("btn-logout");
    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        try { await fetch("/api/logout", { method: "POST" }); } catch (e) {}
        window.location.href = "/auth.html";
      });
    }

    // perfil — usa profileUI se disponível, senão fallback para alert
    const btnProfile = document.getElementById("btn-profile");
    if (btnProfile) {
      btnProfile.addEventListener("click", () => {
        if (window.profileUI && typeof window.profileUI.open === "function") {
          window.profileUI.open();
        } else {
          alert(`Nome: ${me.name}\nEmail: ${me.email}`);
        }
      });
    }

    // refs para elementos do hub
    const roomNameInput = document.getElementById("room-name");
    const createBtn = document.getElementById("create-room");
    const refreshBtn = document.getElementById("refresh-rooms");
    const roomsList = document.getElementById("rooms-list");

    // inicializa socket.io
    const socket = io();
    socket.on("connect", () => {
      // solicita lista de salas ao conectar
      socket.emit("requestRoomList");
    });

    // recebe payload com a lista de salas e renderiza
    socket.on("roomList", (list) => {
      if (!roomsList) return;
      roomsList.innerHTML = "";
      const keys = Object.keys(list || {});
      if (!keys.length) {
        roomsList.innerHTML = `<div class="empty">Nenhuma sala criada ainda.</div>`;
        return;
      }

      keys.forEach(id => {
        const r = list[id] || {};
        const playersCount = Object.keys(r.players || {}).length;

        // extrai tema e flag de IA de forma segura
        const ai = r.aiOptions || null;
        const theme = ai && ai.theme ? ai.theme : null;
        const useGenLabel = ai && ai.useGen ? " (IA)" : "";

        // monta o bloco da sala — mostra ID, nome, número de jogadores e opcionalmente tema
        const el = document.createElement("div");
        el.className = "room";
        el.innerHTML = `
          <div class="meta">
            <strong>${escapeHtml(id)}</strong>
            ${r.name ? "- " + escapeHtml(r.name) : ""}
            <span class="small">(${playersCount} jogador${playersCount===1? "":"es"})</span>
          </div>
          ${theme ? `<div class="meta-theme small" style="color:var(--muted); margin-top:6px;">Tema${useGenLabel}: ${escapeHtml(theme)}</div>` : ""}
          <div class="actions">
            <button class="btn join" data-id="${escapeHtml(id)}">Entrar</button>
          </div>
        `;
        roomsList.appendChild(el);
      });

      // para evitar handlers duplicados: substitui os botões por clones antes de adicionar listeners
      roomsList.querySelectorAll("button.join").forEach(b => {
        b.replaceWith(b.cloneNode(true));
      });

      // adiciona listener para abrir modal de detalhes ao clicar em "Entrar"
      roomsList.querySelectorAll("button.join").forEach(b => {
        b.addEventListener("click", (ev) => {
          const rid = b.dataset.id;
          // pede lista atualizada ao servidor para garantir dados corretos antes de mostrar modal
          socket.emit("requestRoomList");
          // listener único: ao receber a próxima roomList, abre modal com os dados da sala
          const onceHandler = (freshList) => {
            const room = (freshList && freshList[rid]) ? freshList[rid] : null;
            showRoomDetailsModal(rid, room);
            // remove esse listener único
            socket.off("roomList", onceHandler);
          };
          socket.on("roomList", onceHandler);
        });
      });
    });

    // Exibe modal com detalhes da sala e botão para confirmar entrada
    function showRoomDetailsModal(roomId, roomData) {
      // remove modal anterior se existir
      const existing = document.getElementById("room-details-modal");
      if (existing) existing.remove();

      const playersCount = roomData ? Object.keys(roomData.players || {}).length : 0;
      const roomName = roomData && roomData.name ? roomData.name : null;
      const hostName = roomData && roomData.hostName ? roomData.hostName : null;
      const ai = roomData && roomData.aiOptions ? roomData.aiOptions : null;
      const theme = ai && ai.theme ? ai.theme : null;
      const useGen = ai && !!ai.useGen;

      const modal = document.createElement("div");
      modal.id = "room-details-modal";
      modal.style.position = "fixed";
      modal.style.inset = "0";
      modal.style.background = "rgba(0,0,0,0.45)";
      modal.style.display = "flex";
      modal.style.alignItems = "center";
      modal.style.justifyContent = "center";
      modal.style.zIndex = "3000";

      modal.innerHTML = `
        <div style="background:#fff; padding:18px; border-radius:8px; width:420px; max-width:96%; box-shadow:0 8px 24px rgba(0,0,0,0.2);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <h3 style="margin:0; font-size:18px">Entrar na Sala</h3>
            <button id="room-details-close" class="btn secondary" style="font-size:13px;">Fechar</button>
          </div>

          <div style="margin-bottom:10px;">
            <div style="margin-bottom:6px;"><strong>ID:</strong> <span>${escapeHtml(roomId)}</span></div>
            ${roomName ? `<div style="margin-bottom:6px;"><strong>Nome:</strong> <span>${escapeHtml(roomName)}</span></div>` : ""}
            ${hostName ? `<div style="margin-bottom:6px;"><strong>Host:</strong> <span>${escapeHtml(hostName)}</span></div>` : ""}
            <div style="margin-bottom:6px;"><strong>Jogadores:</strong> <span>${playersCount}</span></div>
            ${theme ? `<div style="margin-bottom:6px;"><strong>Tema:</strong> <span>${escapeHtml(theme)}${useGen ? " (IA)" : ""}</span></div>` : ""}
          </div>

          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
            <button id="room-details-cancel" class="btn secondary">Cancelar</button>
            <button id="room-details-join" class="btn">Entrar</button>
          </div>
        </div>
      `;

      document.body.appendChild(modal);

      // fechar modal pelos controles
      modal.querySelector("#room-details-close").addEventListener("click", () => modal.remove());
      modal.querySelector("#room-details-cancel").addEventListener("click", () => modal.remove());

      // confirmar entrada: emite joinRoom com ack e redireciona ao lobby em caso de sucesso
      const joinBtn = modal.querySelector("#room-details-join");
      joinBtn.addEventListener("click", () => {
        joinBtn.disabled = true; // evita múltiplos cliques
        socket.emit("joinRoom", { roomId }, (res) => {
          joinBtn.disabled = false;
          if (res && res.ok && res.roomId) {
            window.location.href = `/lobby.html?room=${encodeURIComponent(res.roomId)}`;
          } else {
            alert("Erro ao entrar na sala: " + (res && res.message ? res.message : "Desconhecido"));
          }
          // remove modal após tentativa (sucesso ou falha)
          const m = document.getElementById("room-details-modal");
          if (m) m.remove();
        });
      });
    }

    // modal de criação de sala (IA + tema)
    if (createBtn) {
      createBtn.addEventListener("click", () => {
        showCreateModal();
      });
    }

    // cria o modal de criação — sem alterar a lógica original
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

      // ativa/desativa o campo de tema quando IA estiver marcada
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

    // atualização manual da lista
    if (refreshBtn) refreshBtn.addEventListener("click", () => socket.emit("requestRoomList"));

    // tratamento de erro de conexão
    socket.on("connect_error", (err) => {
      console.error("Erro de conexão socket:", err);
      if (roomsList) roomsList.innerHTML = `<div class="empty">Erro de conexão com o servidor.</div>`;
    });

    // utilitário para evitar XSS ao inserir dados vindos do servidor
    function escapeHtml(s) {
      if (!s) return "";
      return s.replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'})[c]);
    }
  })();
});
