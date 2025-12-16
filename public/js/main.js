// URL dinâmica para Produção e Localhost
const API_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:3333' 
    : 'https://codemais.com';

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
let monitorInterval; // Variável para controlar o polling do monitoramento

function navigate(view) {
    // 1. Atualiza Menu
    document.querySelectorAll('.nav-item').forEach(e => e.classList.remove('active'));
    const navItem = document.getElementById(`nav-${view}`);
    if(navItem) navItem.classList.add('active');

    // 2. Troca Tela
    document.querySelectorAll('.view-section').forEach(e => e.classList.add('hidden'));
    const viewEl = document.getElementById(`view-${view}`);
    if(viewEl) viewEl.classList.remove('hidden');
    
    // 3. Atualiza Título
    const titles = { 
        'dashboard': 'Visão Geral', 'services': 'Catálogo de Serviços',
        'agents': 'Meus Agentes', 'chat': 'Laboratório de IA', 'calendar': 'Agenda',
        'monitor': 'Monitoramento em Tempo Real'
    };
    document.getElementById('page-title').innerText = titles[view] || 'CodeIA';

    // 4. Limpeza de Intervalos (Para não ficar rodando em background)
    if (monitorInterval) clearInterval(monitorInterval);

    // 5. Carrega Dados Específicos
    if(view==='services') loadServices();
    if(view==='agents') loadAgents();
    if(view==='calendar') loadAppointments();
    if(view==='chat') loadAgentsForChat();
    if(view==='dashboard') loadDashboardStats();
    
    // 6. Lógica do Monitoramento
    if(view === 'monitor') {
        loadConversations();
        // Atualiza a cada 5 segundos
        monitorInterval = setInterval(() => {
            loadConversations(false); // false = sem loading na tela
            if (activeCustomerId) loadChatHistory(activeCustomerId);
        }, 5000);
    }
}

function showAppLayout() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-layout').classList.remove('hidden');
    const user = JSON.parse(localStorage.getItem('user'));
    if(user) document.getElementById('sidebar-user-name').innerText = user.name.split(' ')[0];
    
    // Inicia no Dashboard
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
        showToast(isActive ? 'Agente ativado' : 'Agente pausado');
        setTimeout(() => loadAgents(), 300); 
    } catch(e) { 
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
        
        const data = await res.json().catch(() => ({ message: 'Erro interno no servidor' }));
        
        if (res.ok) {
            localStorage.setItem('token', data.token); 
            localStorage.setItem('user', JSON.stringify(data.user));
            showToast('Login realizado! Entrando...', 'success'); 
            
            setTimeout(() => { 
                showAppLayout(); 
                btn.classList.remove('btn-loading'); 
                btn.disabled = false; 
            }, 800);
        } else {
            throw new Error(data.message || 'Erro desconhecido');
        }
    } catch (err) {
        console.error(err); 
        showToast(err.message, 'error'); 
        passInput.classList.add('input-error'); 
        passInput.focus();
        btn.classList.remove('btn-loading'); 
        btn.disabled = false;
    }
});

function logout() { localStorage.removeItem('token'); window.location.reload(); }

// --- AGENDA ---
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

// --- CHAT SIMULADOR ---
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

// --- DASHBOARD ---
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

// --- STATUS WHATSAPP ---
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

// --- MÓDULO DE MONITORAMENTO (CRM) ---
let activeCustomerId = null;

async function loadConversations(showLoading = true) {
    const token = localStorage.getItem('token');
    const list = document.getElementById('monitor-list');
    
    if (showLoading) list.innerHTML = '<p style="padding:1rem; text-align:center; color:var(--text-muted)">Carregando...</p>';

    try {
        const res = await fetch(`${API_URL}/crm/conversations`, { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        const convs = await res.json();

        if (showLoading) list.innerHTML = '';
        
        if (convs.length === 0 && showLoading) {
            list.innerHTML = '<p style="padding:1rem; text-align:center; color:var(--text-muted)">Nenhuma conversa iniciada.</p>';
            return;
        }

        const currentHTML = list.innerHTML;
        let newHTML = '';

        convs.forEach(c => {
            const activeClass = (c.id === activeCustomerId) ? 'background:var(--glass-highlight); border-color:var(--primary);' : '';
            const date = new Date(c.updatedAt).toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'});
            
            newHTML += `
                <div onclick="selectConversation('${c.id}', '${c.name}', '${c.phone}')" 
                     style="padding: 1rem; border: 1px solid var(--glass-border); border-radius: 12px; cursor: pointer; transition: 0.2s; ${activeClass}"
                     onmouseover="this.style.background='var(--glass-highlight)'" 
                     onmouseout="this.style.background='${c.id === activeCustomerId ? 'var(--glass-highlight)' : 'transparent'}'">
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                        <span style="font-weight:600; color:var(--text-main);">${c.name}</span>
                        <small style="font-size:0.7rem; color:var(--text-muted);">${date}</small>
                    </div>
                    <div style="font-size:0.85rem; color:var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${c.lastMessage}
                    </div>
                </div>
            `;
        });

        if (list.innerHTML !== newHTML && !showLoading) {
             list.innerHTML = newHTML;
        } else if (showLoading) {
             list.innerHTML = newHTML;
        }

    } catch (e) {
        console.error(e);
    }
}

window.selectConversation = function(id, name, phone) {
    activeCustomerId = id;
    document.getElementById('monitor-header').style.display = 'block';
    document.getElementById('monitor-client-name').innerText = name;
    document.getElementById('monitor-client-phone').innerText = `+${phone}`;
    
    loadConversations(false);
    loadChatHistory(id);
}

async function loadChatHistory(customerId) {
    const token = localStorage.getItem('token');
    const area = document.getElementById('monitor-messages');
    
    try {
        const res = await fetch(`${API_URL}/crm/conversations/${customerId}/messages`, { 
            headers: { 'Authorization': `Bearer ${token}` } 
        });
        const msgs = await res.json();

        area.innerHTML = ''; 

        msgs.forEach(m => {
            const div = document.createElement('div');
            const isModel = m.role === 'model';
            div.className = `msg ${isModel ? 'user' : 'ai'}`; 
            
            if (isModel) {
                div.style.alignSelf = 'flex-end';
                div.style.background = 'linear-gradient(135deg, var(--secondary), #6366f1)';
                div.style.color = 'white';
                div.innerHTML = `<strong>🤖 IA:</strong><br>${m.content}`;
            } else {
                div.style.alignSelf = 'flex-start';
                div.style.background = 'var(--glass-surface)';
                div.style.color = 'var(--text-main)';
                div.innerHTML = `<strong>👤 Cliente:</strong><br>${m.content}`;
            }
            
            area.appendChild(div);
        });

        area.scrollTop = area.scrollHeight;

    } catch (e) {
        console.error(e);
    }
}