const API_URL = 'http://localhost:3333';

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    const token = localStorage.getItem('token');
    if (token) {
        showAppLayout();
    }
});

// --- NAVEGAÇÃO SPA ---
function navigate(viewName) {
    // 1. Atualiza Menu
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.getElementById(`nav-${viewName}`).classList.add('active');

    // 2. Troca View
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.getElementById(`view-${viewName}`).classList.remove('hidden');

    // 3. Título
    const titles = { 'dashboard': 'Visão Geral', 'agents': 'Meus Agentes', 'chat': 'Laboratório de IA', 'calendar': 'Agenda' };
    document.getElementById('page-title').innerText = titles[viewName];

    // 4. Carrega Dados Específicos
    if (viewName === 'agents') loadAgents();
    if (viewName === 'calendar') loadAppointments();
    if (viewName === 'chat') loadAgentsForChat();
}

// --- AUTH ---
function showAppLayout() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-layout').classList.remove('hidden');
    
    const user = JSON.parse(localStorage.getItem('user'));
    if (user) {
        document.getElementById('sidebar-user-name').innerText = user.name.split(' ')[0];
        document.getElementById('sidebar-user-role').innerText = user.role;
    }
    
    navigate('dashboard');
    startStatusPolling();
    loadDashboardStats();
}

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
        } else {
            showToast(data.error || 'Erro ao entrar', 'error');
        }
    } catch(err) { showToast('Erro de conexão', 'error'); }
});

function logout() {
    localStorage.removeItem('token');
    window.location.reload();
}

// --- DASHBOARD ---
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
    } catch(err) {}
}

// --- AGENTES ---
async function loadAgents() {
    const token = localStorage.getItem('token');
    const list = document.getElementById('agents-list');
    list.innerHTML = '<p>Carregando...</p>';
    
    try {
        const res = await fetch(`${API_URL}/agents`, { headers: { 'Authorization': `Bearer ${token}` } });
        const agents = await res.json();
        
        list.innerHTML = '';
        if(agents.length === 0) {
            list.innerHTML = '<p class="text-muted">Nenhum agente criado.</p>';
            return;
        }

        agents.forEach(agent => {
            const card = document.createElement('div');
            card.className = 'card agent-card';
            card.innerHTML = `
                <h4>${agent.name}</h4>
                <small class="code-font text-green">${agent.slug}</small>
                <p style="font-size: 0.85rem; color: #666; margin-top: 10px; line-height: 1.4;">
                    ${agent.instructions.substring(0, 80)}...
                </p>
            `;
            list.appendChild(card);
        });
    } catch(err) { list.innerHTML = 'Erro ao carregar agentes'; }
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
        if(apps.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4">Nenhum agendamento encontrado.</td></tr>';
            return;
        }

        apps.forEach(app => {
            const date = new Date(app.startTime).toLocaleString('pt-BR');
            const row = `
                <tr>
                    <td>${app.customer?.name || 'Cliente'}</td>
                    <td>${app.title}</td>
                    <td>${date}</td>
                    <td><span class="status-badge status-connected">${app.status}</span></td>
                </tr>
            `;
            tbody.innerHTML += row;
        });
    } catch(err) { tbody.innerHTML = '<tr><td colspan="4">Erro ao carregar.</td></tr>'; }
}

// --- CHAT ---
async function loadAgentsForChat() {
    const token = localStorage.getItem('token');
    const select = document.getElementById('chat-agent-select');
    
    const res = await fetch(`${API_URL}/agents`, { headers: { 'Authorization': `Bearer ${token}` } });
    const agents = await res.json();
    
    select.innerHTML = '';
    agents.forEach(agent => {
        const opt = document.createElement('option');
        opt.value = agent.id;
        opt.innerText = agent.name;
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
        appendMessage('ai', data.response);
        
        if(data.action === 'appointment_created') {
            showToast('Novo agendamento criado!');
        }
    } catch(err) { appendMessage('ai', 'Erro ao conectar com o agente.'); }
});

function appendMessage(role, text) {
    const area = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `msg ${role}`;
    div.innerText = text;
    area.appendChild(div);
    area.scrollTop = area.scrollHeight;
}

// --- MODAL & HELPERS ---
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.getElementById('agent-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const payload = {
        name: document.getElementById('agent-name').value,
        slug: document.getElementById('agent-slug').value,
        instructions: document.getElementById('agent-instructions').value
    };
    await fetch(`${API_URL}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
    });
    closeModal('modal-agent');
    showToast('Agente criado!');
    loadAgents();
});

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
            badge.className = 'status-badge status-connected';
            badge.innerText = 'ONLINE';
            text.innerText = `Conectado: +${data.phoneNumber}`;
            qrContainer.classList.add('hidden');
            btnConnect.classList.add('hidden');
            btnDisconnect.classList.remove('hidden');
        } else if(data.status === 'QRCODE') {
            badge.className = 'status-badge';
            badge.innerText = 'ESCANEAR';
            text.innerText = 'Escaneie o QR Code abaixo:';
            qrContainer.classList.remove('hidden');
            if(data.qrCode) document.getElementById('qr-image').src = data.qrCode;
            btnConnect.classList.add('hidden');
            btnDisconnect.classList.add('hidden');
        } else {
            badge.className = 'status-badge status-disconnected';
            badge.innerText = 'OFFLINE';
            text.innerText = 'Desconectado.';
            qrContainer.classList.add('hidden');
            btnConnect.classList.remove('hidden');
            btnDisconnect.classList.add('hidden');
        }
    } catch(err) {}
}

async function connectWhatsApp() {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/whatsapp/connect`, { method: 'POST', headers: {'Authorization': `Bearer ${token}`} });
}
async function disconnectWhatsApp() {
    const token = localStorage.getItem('token');
    await fetch(`${API_URL}/whatsapp/disconnect`, { method: 'POST', headers: {'Authorization': `Bearer ${token}`} });
}

// --- THEME ---
function initTheme() {
    if(localStorage.getItem('theme') === 'dark') document.documentElement.classList.add('dark-mode');
    updateThemeIcons();
}
function toggleTheme() {
    document.documentElement.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.documentElement.classList.contains('dark-mode') ? 'dark' : 'light');
    updateThemeIcons();
}
function updateThemeIcons() {
    const isDark = document.documentElement.classList.contains('dark-mode');
    document.getElementById('icon-sun').classList.toggle('hidden', !isDark);
    document.getElementById('icon-moon').classList.toggle('hidden', isDark);
}
function showToast(msg, type='success') {
    const t = document.createElement('div'); t.className = `toast ${type}`; t.innerText = msg;
    document.getElementById('toast-container').appendChild(t);
    setTimeout(()=>t.remove(), 3000);
}