const API_URL = 'http://localhost:3333';

document.addEventListener('DOMContentLoaded', () => {
    initTheme(); // Carrega tema salvo
    const token = localStorage.getItem('token');
    if (token) showAppLayout();
});

// --- TEMA (DARK/LIGHT) ---
function initTheme() {
    const saved = localStorage.getItem('theme');
    if (saved === 'light') {
        document.documentElement.classList.add('light-mode');
    }
    updateThemeIcons();
}

function toggleTheme() {
    document.documentElement.classList.toggle('light-mode');
    const isLight = document.documentElement.classList.contains('light-mode');
    localStorage.setItem('theme', isLight ? 'light' : 'dark');
    updateThemeIcons();
}

function updateThemeIcons() {
    const isLight = document.documentElement.classList.contains('light-mode');
    const sun = document.getElementById('icon-sun');
    const moon = document.getElementById('icon-moon');
    
    if(isLight) {
        sun.classList.add('hidden');
        moon.classList.remove('hidden');
    } else {
        sun.classList.remove('hidden');
        moon.classList.add('hidden');
    }
}

// --- NAVEGAÇÃO SPA ---
function navigate(view) {
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    const navItem = document.getElementById(`nav-${view}`);
    if(navItem) navItem.classList.add('active');

    document.querySelectorAll('.view-section').forEach(e => e.classList.add('hidden'));
    document.getElementById(`view-${view}`).classList.remove('hidden');
    
    const titles = { 
        'dashboard': 'Visão Geral', 'services': 'Catálogo de Serviços',
        'agents': 'Meus Agentes', 'chat': 'Laboratório de IA', 'calendar': 'Agenda' 
    };
    document.getElementById('page-title').innerText = titles[view] || 'CodeIA';

    if(view==='services') loadServices();
    if(view==='agents') loadAgents();
    if(view==='calendar') loadAppointments();
    if(view==='chat') loadAgentsForChat();
    if(view==='dashboard') loadDashboardStats();
}

function showAppLayout() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-layout').classList.remove('hidden');
    const user = JSON.parse(localStorage.getItem('user'));
    if(user) document.getElementById('sidebar-user-name').innerText = user.name.split(' ')[0];
    navigate('dashboard');
    startStatusPolling();
}

// --- MÓDULO DE SERVIÇOS ---
async function loadServices() {
    const token = localStorage.getItem('token');
    const tbody = document.getElementById('services-list');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:2rem;">Carregando...</td></tr>';
    
    try {
        const res = await fetch(`${API_URL}/services`, { headers: { 'Authorization': `Bearer ${token}` } });
        const services = await res.json();
        
        tbody.innerHTML = '';
        if(services.length === 0) { 
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:2rem;">Nenhum serviço cadastrado.</td></tr>'; 
            return; 
        }

        services.forEach(s => {
            const price = new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(s.price);
            // Escapa aspas simples para não quebrar o JSON no onclick
            const safeService = JSON.stringify(s).replace(/'/g, "&#39;");
            
            tbody.innerHTML += `
                <tr>
                    <td style="font-weight:500;">${s.name}</td>
                    <td><span style="background:rgba(255,255,255,0.05); padding:2px 8px; border-radius:4px; font-size:0.85rem;">${s.duration} min</span></td>
                    <td style="color:var(--success); font-weight:600;">${price}</td>
                    <td style="text-align:right;">
                        <button class="btn-icon-small" onclick='openServiceModal(${safeService})' title="Editar"><i data-lucide="pencil"></i></button> 
                        <button class="btn-icon-small text-red" onclick="deleteService('${s.id}')" title="Excluir"><i data-lucide="trash-2"></i></button>
                    </td>
                </tr>`;
        });
        lucide.createIcons();
    } catch(e) { tbody.innerHTML='<tr><td colspan="4" style="text-align:center; color:var(--danger)">Erro ao carregar serviços.</td></tr>'; }
}

window.openServiceModal = function(service=null) {
    const modal = document.getElementById('modal-service');
    const title = document.getElementById('modal-service-title');
    const form = document.getElementById('service-form');
    
    if(service) {
        title.innerText="Editar Serviço";
        document.getElementById('serv-id').value = service.id;
        document.getElementById('serv-name').value = service.name;
        document.getElementById('serv-duration').value = service.duration;
        document.getElementById('serv-price').value = service.price;
        document.getElementById('serv-desc').value = service.description||'';
    } else {
        title.innerText="Novo Serviço"; form.reset(); document.getElementById('serv-id').value="";
    }
    modal.classList.remove('hidden');
}

document.getElementById('service-form').addEventListener('submit', async(e)=>{
    e.preventDefault();
    const token = localStorage.getItem('token');
    const id = document.getElementById('serv-id').value;
    
    const payload = {
        name: document.getElementById('serv-name').value,
        duration: parseInt(document.getElementById('serv-duration').value),
        price: parseFloat(document.getElementById('serv-price').value),
        description: document.getElementById('serv-desc').value
    };
    
    const method = id ? 'PUT':'POST';
    const url = id ? `${API_URL}/services/${id}` : `${API_URL}/services`;
    
    try {
        const res = await fetch(url, { 
            method, 
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}, 
            body: JSON.stringify(payload)
        });
        
        if(res.ok) { 
            showToast(id?'Serviço atualizado!':'Serviço criado!'); 
            closeModal('modal-service'); 
            loadServices(); 
        } else {
            showToast('Erro ao salvar','error');
        }
    } catch(err) { showToast('Erro de conexão','error'); }
});

window.deleteService = async function(id) {
    if(!confirm('Excluir este serviço?')) return;
    const token = localStorage.getItem('token');
    try {
        await fetch(`${API_URL}/services/${id}`, { method:'DELETE', headers:{'Authorization':`Bearer ${token}`} });
        loadServices(); 
        showToast('Serviço excluído.');
    } catch(e) { showToast('Erro ao excluir', 'error'); }
}

// --- MÓDULO DE AGENTES ---
async function loadAgents() {
    const token = localStorage.getItem('token');
    const list = document.getElementById('agents-list');
    list.innerHTML = '<p>Carregando...</p>';
    
    try {
        const res = await fetch(`${API_URL}/agents`, { headers: { 'Authorization': `Bearer ${token}` } });
        const agents = await res.json();
        
        list.innerHTML = '';
        if(agents.length===0) { list.innerHTML='<p style="color:var(--text-muted)">Nenhum agente criado.</p>'; return; }

        agents.forEach(agent => {
            const isActive = agent.isActive ? 'checked' : '';
            // Proteção de aspas para o JSON
            const safeAgent = JSON.stringify(agent).replace(/'/g, "&#39;");

            const card = document.createElement('div'); card.className = 'card agent-card';
            card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                        <h4>${agent.name}</h4>
                        <small class="code-font text-muted">${agent.slug}</small>
                    </div>
                    <div class="toggle-switch">
                        <label class="switch">
                            <input type="checkbox" ${isActive} onchange="toggleAgentStatus('${agent.id}', this.checked, this)">
                            <span class="slider round"></span>
                        </label>
                    </div>
                </div>
                <p style="font-size:0.85rem; margin:10px 0; min-height:40px;">${agent.instructions.substring(0,60)}...</p>
                <div style="display:flex; gap:10px; padding-top:10px; border-top:1px solid var(--glass-border);">
                    <button class="btn-icon-small" onclick='openAgentModal(${safeAgent})' title="Editar"><i data-lucide="pencil"></i></button>
                    <button class="btn-icon-small text-red" onclick="deleteAgent('${agent.id}')" title="Excluir"><i data-lucide="trash-2"></i></button>
                </div>
            `;
            list.appendChild(card);
        });
        lucide.createIcons();
    } catch(e) { list.innerHTML='Erro ao carregar agentes.'; }
}

window.openAgentModal = function(agent=null) {
    const modal = document.getElementById('modal-agent');
    const title = document.getElementById('modal-title');
    const form = document.getElementById('agent-form');
    
    if(agent) {
        title.innerText="Editar Agente";
        document.getElementById('agent-id').value=agent.id;
        document.getElementById('agent-name').value=agent.name;
        document.getElementById('agent-slug').value=agent.slug;
        document.getElementById('agent-instructions').value=agent.instructions;
    } else {
        title.innerText="Novo Agente"; form.reset(); document.getElementById('agent-id').value="";
    }
    modal.classList.remove('hidden');
}

document.getElementById('agent-form').addEventListener('submit', async(e)=>{
    e.preventDefault();
    const token = localStorage.getItem('token');
    const id = document.getElementById('agent-id').value;
    
    const payload = { 
        name: document.getElementById('agent-name').value, 
        slug: document.getElementById('agent-slug').value, 
        instructions: document.getElementById('agent-instructions').value 
    };
    
    const method = id ? 'PUT':'POST';
    const url = id ? `${API_URL}/agents/${id}` : `${API_URL}/agents`;
    
    try {
        const res = await fetch(url, { 
            method, 
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}, 
            body: JSON.stringify(payload)
        });
        
        if(res.ok) { 
            showToast('Agente salvo!'); 
            closeModal('modal-agent'); 
            loadAgents(); 
        } else {
            const err = await res.json();
            showToast(err.message || 'Erro ao salvar','error');
        }
    } catch(err) { showToast('Erro de conexão','error'); }
});

window.deleteAgent = async function(id) {
    if(!confirm('Tem certeza que deseja excluir este agente?')) return;
    const token = localStorage.getItem('token');
    try {
        await fetch(`${API_URL}/agents/${id}`, { method:'DELETE', headers:{'Authorization':`Bearer ${token}`} });
        loadAgents();
        showToast('Agente excluído.');
    } catch(e) { showToast('Erro ao excluir', 'error'); }
}

window.toggleAgentStatus = async function(id, isActive, checkboxElement) {
    const token = localStorage.getItem('token');
    
    try {
        const res = await fetch(`${API_URL}/agents/${id}`, { 
            method:'PUT', 
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}, 
            body: JSON.stringify({isActive}) 
        });
        
        if(!res.ok) throw new Error();
        
        showToast(isActive ? 'Agente ativado (outros pausados)' : 'Agente pausado');
        
        // RECARREGA A LISTA PARA ATUALIZAR OS OUTROS BOTÕES
        // Isso faz com que os outros agentes fiquem "cinza" automaticamente
        setTimeout(() => loadAgents(), 300); 

    } catch(e) { 
        // Reverte o visual se der erro
        checkboxElement.checked = !isActive;
        showToast('Erro ao alterar status', 'error'); 
    }
}

// --- UTILS & LOGIN ---
window.closeModal = function(id) { document.getElementById(id).classList.add('hidden'); }

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-login');
    const emailInput = document.getElementById('email');
    const passInput = document.getElementById('password');
    
    // Feedback visual imediato
    btn.disabled = true; 
    btn.classList.add('btn-loading'); 
    emailInput.classList.remove('input-error'); 
    passInput.classList.remove('input-error');
    
    try {
        const res = await fetch(`${API_URL}/login`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ email: emailInput.value, password: passInput.value }) 
        });
        
        const data = await res.json().catch(() => ({ message: 'Erro de comunicação com o servidor' }));
        
        if (res.ok) {
            localStorage.setItem('token', data.token); 
            localStorage.setItem('user', JSON.stringify(data.user));
            showToast('Bem-vindo! Entrando...', 'success'); 
            
            setTimeout(() => { 
                showAppLayout(); 
                btn.classList.remove('btn-loading'); 
                btn.disabled = false; 
            }, 800);
        } else {
            // CORREÇÃO: O Fastify retorna o erro em 'message'
            throw new Error(data.message || data.error || 'Erro desconhecido ao logar');
        }
    } catch (err) {
        console.error('Erro Login:', err); // Log no console do navegador também
        showToast(err.message, 'error'); 
        
        // Destaca os campos para o usuário saber onde errou
        passInput.classList.add('input-error'); 
        passInput.focus();
        
        btn.classList.remove('btn-loading'); 
        btn.disabled = false;
    }
});

function logout() { localStorage.removeItem('token'); window.location.reload(); }

async function loadAppointments() {
    const token = localStorage.getItem('token');
    const tbody = document.getElementById('appointments-list');
    tbody.innerHTML = '<tr><td colspan="4">Carregando...</td></tr>';
    
    try {
        const res = await fetch(`${API_URL}/appointments`, { headers: { 'Authorization': `Bearer ${token}` } });
        const apps = await res.json();
        
        tbody.innerHTML = '';
        if(apps.length===0) { tbody.innerHTML='<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Nenhum agendamento.</td></tr>'; return; }
        
        apps.forEach(app => {
            const date = new Date(app.startTime).toLocaleString('pt-BR');
            tbody.innerHTML += `<tr><td>${app.customer?.name||'Cliente'}</td><td>${app.title}</td><td>${date}</td><td><span class="status-badge status-connected" style="background:var(--success); color:#000;">${app.status}</span></td></tr>`;
        });
    } catch(e) { tbody.innerHTML='<tr><td colspan="4">Erro ao carregar agenda.</td></tr>'; }
}

async function loadAgentsForChat() {
    const token = localStorage.getItem('token');
    const select = document.getElementById('chat-agent-select');
    const res = await fetch(`${API_URL}/agents`, { headers: { 'Authorization': `Bearer ${token}` } });
    const agents = await res.json();
    
    select.innerHTML = '';
    agents.forEach(a => { 
        const opt = document.createElement('option'); 
        opt.value=a.id; opt.innerText=a.name; 
        select.appendChild(opt); 
    });
}

document.getElementById('chat-form').addEventListener('submit', async(e)=>{
    e.preventDefault(); 
    const input = document.getElementById('chat-input');
    const msg = input.value; 
    const agentId = document.getElementById('chat-agent-select').value;
    
    if(!msg||!agentId) return;
    
    appendMessage('user', msg); 
    input.value='';
    
    try {
        const res = await fetch(`${API_URL}/chat`, { 
            method:'POST', 
            headers:{'Content-Type':'application/json','Authorization':`Bearer ${localStorage.getItem('token')}`}, 
            body:JSON.stringify({agentId, message:msg}) 
        });
        const data = await res.json(); 
        appendMessage('ai', data.response);
    } catch(e) { appendMessage('ai', 'Erro de conexão.'); }
});

function appendMessage(role, text) {
    const area = document.getElementById('chat-messages'); 
    const div = document.createElement('div');
    div.className = `msg ${role}`; 
    div.innerText = text; 
    area.appendChild(div); 
    area.scrollTop = area.scrollHeight;
}

async function loadDashboardStats() {
    try { 
        const res = await fetch(`${API_URL}/tenant/me`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } }); 
        if(res.ok) { 
            const data = await res.json(); 
            document.getElementById('count-users').innerText = data._count.users||0; 
            document.getElementById('count-messages').innerText = data._count.messages||0; 
            document.getElementById('count-appointments').innerText = data._count.appointments||0; 
        } 
    } catch(e){}
}

let pollInterval;
function startStatusPolling() { 
    if(pollInterval) clearInterval(pollInterval); 
    checkWA(); 
    pollInterval = setInterval(checkWA, 3000); 
}

async function checkWA() {
    try {
        const res = await fetch(`${API_URL}/whatsapp/status`, { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
        const data = await res.json();
        
        const badge = document.getElementById('whatsapp-badge');
        const qrContainer = document.getElementById('qr-container');
        const btnConnect = document.getElementById('btn-connect');
        const btnDisconnect = document.getElementById('btn-disconnect');
        
        if(data.status === 'CONNECTED') {
            badge.className = 'status-badge status-connected'; 
            badge.innerText = 'ONLINE'; 
            badge.style.background='rgba(16, 185, 129, 0.2)'; 
            badge.style.color='var(--success)';
            document.getElementById('whatsapp-text').innerText = `Conectado: +${data.phoneNumber}`;
            qrContainer.classList.add('hidden'); 
            btnConnect.classList.add('hidden'); 
            btnDisconnect.classList.remove('hidden');
        } else if(data.status === 'QRCODE') {
            badge.innerText = 'QR CODE'; 
            qrContainer.classList.remove('hidden');
            if(data.qrCode) document.getElementById('qr-image').src = data.qrCode;
            btnConnect.classList.add('hidden'); 
            btnDisconnect.classList.add('hidden');
        } else {
            badge.className = 'status-badge status-disconnected'; 
            badge.innerText = 'OFFLINE'; 
            badge.style.background='rgba(239, 68, 68, 0.2)'; 
            badge.style.color='var(--danger)';
            document.getElementById('whatsapp-text').innerText = 'Desconectado.';
            qrContainer.classList.add('hidden'); 
            btnConnect.classList.remove('hidden'); 
            btnDisconnect.classList.add('hidden');
        }
    } catch(e){}
}

async function connectWhatsApp() { 
    await fetch(`${API_URL}/whatsapp/connect`, { method:'POST', headers:{'Authorization':`Bearer ${localStorage.getItem('token')}`} }); 
}

async function disconnectWhatsApp() { 
    if(confirm('Desconectar?')) 
        await fetch(`${API_URL}/whatsapp/disconnect`, { method:'POST', headers:{'Authorization':`Bearer ${localStorage.getItem('token')}`} }); 
}

function showToast(msg, type='success') {
    const t = document.createElement('div'); t.className = `toast ${type}`; t.innerText = msg;
    document.getElementById('toast-container').appendChild(t); 
    setTimeout(()=>t.remove(), 3000);
}