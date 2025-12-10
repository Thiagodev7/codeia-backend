const API_URL = 'http://localhost:3333';

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    const token = localStorage.getItem('token');
    if (token) showAppLayout();
});

// --- NAV ---
function navigate(view) {
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    document.getElementById(`nav-${view}`).classList.add('active');
    document.querySelectorAll('.view-section').forEach(e => e.classList.add('hidden'));
    document.getElementById(`view-${view}`).classList.remove('hidden');
    
    const titles = { 'dashboard': 'Visão Geral', 'agents': 'Meus Agentes', 'chat': 'Laboratório', 'calendar': 'Agenda' };
    document.getElementById('page-title').innerText = titles[view];

    if (view === 'agents') loadAgents();
    if (view === 'calendar') loadAppointments();
    if (view === 'chat') loadAgentsForChat();
    if (view === 'dashboard') loadDashboardStats();
}

function showAppLayout() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-layout').classList.remove('hidden');
    const user = JSON.parse(localStorage.getItem('user'));
    if(user) {
        document.getElementById('sidebar-user-name').innerText = user.name.split(' ')[0];
    }
    navigate('dashboard');
    startStatusPolling();
}

// --- AGENTES (CRUD COMPLETO) ---
async function loadAgents() {
    const token = localStorage.getItem('token');
    const list = document.getElementById('agents-list');
    list.innerHTML = '<p>Carregando...</p>';
    
    try {
        const res = await fetch(`${API_URL}/agents`, { headers: { 'Authorization': `Bearer ${token}` } });
        const agents = await res.json();
        
        list.innerHTML = '';
        if(agents.length === 0) { list.innerHTML = '<p>Nenhum agente.</p>'; return; }

        agents.forEach(agent => {
            const isActive = agent.isActive ? 'checked' : '';
            const statusLabel = agent.isActive ? 'Ativo' : 'Pausado';
            const statusColor = agent.isActive ? 'text-green' : 'text-red';

            const card = document.createElement('div');
            card.className = 'card agent-card';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                        <h4>${agent.name}</h4>
                        <small class="code-font text-muted">${agent.slug}</small>
                    </div>
                    <div class="toggle-switch">
                        <label class="switch">
                            <input type="checkbox" ${isActive} onchange="toggleAgentStatus('${agent.id}', this.checked)">
                            <span class="slider round"></span>
                        </label>
                    </div>
                </div>
                <p style="font-size:0.85rem; color:#666; margin:10px 0; height:40px; overflow:hidden;">
                    ${agent.instructions.substring(0, 60)}...
                </p>
                <div style="display:flex; gap:10px; margin-top:10px; border-top:1px solid #eee; padding-top:10px;">
                    <button class="btn-icon-small" onclick='openAgentModal(${JSON.stringify(agent)})' title="Editar"><i data-lucide="pencil"></i></button>
                    <button class="btn-icon-small text-red" onclick="deleteAgent('${agent.id}')" title="Excluir"><i data-lucide="trash-2"></i></button>
                </div>
            `;
            list.appendChild(card);
        });
        lucide.createIcons();
    } catch(err) { list.innerHTML = 'Erro ao carregar.'; }
}

// Abrir Modal (Criação ou Edição)
window.openAgentModal = function(agent = null) {
    const modal = document.getElementById('modal-agent');
    const title = document.getElementById('modal-title');
    const form = document.getElementById('agent-form');
    
    // Limpa ou Preenche
    if (agent) {
        title.innerText = "Editar Agente";
        document.getElementById('agent-id').value = agent.id;
        document.getElementById('agent-name').value = agent.name;
        document.getElementById('agent-slug').value = agent.slug;
        document.getElementById('agent-instructions').value = agent.instructions;
    } else {
        title.innerText = "Novo Agente";
        form.reset();
        document.getElementById('agent-id').value = "";
    }
    
    modal.classList.remove('hidden');
}

// Salvar (POST ou PUT)
document.getElementById('agent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const id = document.getElementById('agent-id').value;
    
    const payload = {
        name: document.getElementById('agent-name').value,
        slug: document.getElementById('agent-slug').value,
        instructions: document.getElementById('agent-instructions').value
    };

    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_URL}/agents/${id}` : `${API_URL}/agents`;

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });

        if(res.ok) {
            showToast('Agente salvo com sucesso!');
            closeModal('modal-agent');
            loadAgents();
        } else {
            const err = await res.json();
            showToast(err.message || 'Erro ao salvar', 'error');
        }
    } catch(err) { showToast('Erro de conexão', 'error'); }
});

// Deletar
window.deleteAgent = async function(id) {
    if(!confirm("Tem certeza que deseja excluir este agente?")) return;
    const token = localStorage.getItem('token');
    
    try {
        const res = await fetch(`${API_URL}/agents/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if(res.ok) {
            showToast('Agente excluído.');
            loadAgents();
        }
    } catch(e) { showToast('Erro ao excluir', 'error'); }
}

// Toggle Ativo/Pausa
window.toggleAgentStatus = async function(id, isActive) {
    const token = localStorage.getItem('token');
    try {
        await fetch(`${API_URL}/agents/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ isActive })
        });
        showToast(isActive ? 'Agente ativado' : 'Agente pausado');
    } catch(e) { showToast('Erro ao atualizar status', 'error'); loadAgents(); } // Reverte se der erro
}

// --- MODAIS ---
window.closeModal = function(id) { document.getElementById(id).classList.add('hidden'); }

// --- LOGIN & AUTH ---
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if(res.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            showAppLayout();
        } else { showToast(data.error, 'error'); }
    } catch(e) { showToast('Erro de conexão', 'error'); }
});

function logout() { localStorage.removeItem('token'); window.location.reload(); }

// --- DASHBOARD & UTILS ---
async function loadDashboardStats() {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/tenant/me`, { headers: { 'Authorization': `Bearer ${token}` } });
        if(res.ok) {
            const data = await res.json();
            document.getElementById('count-users').innerText = data._count.users || 0;
            document.getElementById('count-messages').innerText = data._count.messages || 0;
            document.getElementById('count-appointments').innerText = data._count.appointments || 0;
        }
    } catch(e){}
}

// --- CHAT ---
async function loadAgentsForChat() {
    const token = localStorage.getItem('token');
    const select = document.getElementById('chat-agent-select');
    const res = await fetch(`${API_URL}/agents`, { headers: { 'Authorization': `Bearer ${token}` } });
    const agents = await res.json();
    select.innerHTML = '';
    agents.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.innerText = a.name;
        select.appendChild(opt);
    });
}

document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const msg = input.value;
    const agentId = document.getElementById('chat-agent-select').value;
    const token = localStorage.getItem('token');
    if(!msg || !agentId) return;

    appendMessage('user', msg);
    input.value = '';

    try {
        const res = await fetch(`${API_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ agentId, message: msg })
        });
        const data = await res.json();
        const text = data.response || "(Sem resposta - Agente Pausado)";
        appendMessage('ai', text);
    } catch(e) { appendMessage('ai', 'Erro no chat.'); }
});

function appendMessage(role, text) {
    const area = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.innerText = text;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}

// --- AGENDA ---
async function loadAppointments() {
    const token = localStorage.getItem('token');
    const tbody = document.getElementById('appointments-list');
    tbody.innerHTML = '<tr><td colspan="4">Carregando...</td></tr>';
    try {
        const res = await fetch(`${API_URL}/appointments`, { headers: { 'Authorization': `Bearer ${token}` } });
        const apps = await res.json();
        tbody.innerHTML = '';
        if(apps.length===0) { tbody.innerHTML='<tr><td colspan="4">Vazio.</td></tr>'; return; }
        apps.forEach(app => {
            const date = new Date(app.startTime).toLocaleString('pt-BR');
            tbody.innerHTML += `<tr><td>${app.customer?.name||'Anon'}</td><td>${app.title}</td><td>${date}</td><td>${app.status}</td></tr>`;
        });
    } catch(e) { tbody.innerHTML = '<tr><td colspan="4">Erro.</td></tr>'; }
}

// --- WHATSAPP STATUS ---
let pollInterval;
function startStatusPolling() {
    if(pollInterval) clearInterval(pollInterval);
    checkWA();
    pollInterval = setInterval(checkWA, 3000);
}
async function checkWA() {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/whatsapp/status`, { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await res.json();
        const badge = document.getElementById('whatsapp-badge');
        const text = document.getElementById('whatsapp-text');
        const qrContainer = document.getElementById('qr-container');
        const btnConnect = document.getElementById('btn-connect');
        const btnDisconnect = document.getElementById('btn-disconnect');

        if(data.status === 'CONNECTED') {
            badge.className = 'status-badge status-connected'; badge.innerText = 'ONLINE';
            text.innerText = `Conectado: +${data.phoneNumber}`;
            qrContainer.classList.add('hidden'); btnConnect.classList.add('hidden'); btnDisconnect.classList.remove('hidden');
        } else if(data.status === 'QRCODE') {
            badge.className = 'status-badge'; badge.innerText = 'QR CODE';
            text.innerText = 'Escaneie:';
            qrContainer.classList.remove('hidden');
            if(data.qrCode) document.getElementById('qr-image').src = data.qrCode;
            btnConnect.classList.add('hidden'); btnDisconnect.classList.add('hidden');
        } else {
            badge.className = 'status-badge status-disconnected'; badge.innerText = 'OFFLINE';
            text.innerText = 'Desconectado.';
            qrContainer.classList.add('hidden'); btnConnect.classList.remove('hidden'); btnDisconnect.classList.add('hidden');
        }
    } catch(e){}
}
async function connectWhatsApp() {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/whatsapp/connect`, { method: 'POST', headers: {'Authorization': `Bearer ${token}`} });
}
async function disconnectWhatsApp() {
    if(!confirm('Desconectar?')) return;
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/whatsapp/disconnect`, { method: 'POST', headers: {'Authorization': `Bearer ${token}`} });
}

// --- UTILS ---
function initTheme() { if(localStorage.getItem('theme')==='dark') document.documentElement.classList.add('dark-mode'); }
function toggleTheme() { document.documentElement.classList.toggle('dark-mode'); localStorage.setItem('theme', document.documentElement.classList.contains('dark-mode') ? 'dark':'light'); }
function showToast(msg, type='success') {
    const t = document.createElement('div'); t.className = `toast ${type}`; t.innerText = msg;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(()=>t.remove(), 3000);
}