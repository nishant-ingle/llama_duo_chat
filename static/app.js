// Llama Duo Arena - WebSocket Frontend Logic

let ws = null;
let currentActiveCard = null;
let currentStreamingAgent = null;
let conversationHistory = []; // { turn, agent, text }

// DOM Elements
const connectionStatus = document.getElementById('connectionStatus');
const turnCounter = document.getElementById('turnCounter');
const activeState = document.getElementById('activeState');
const flowIndicator = document.getElementById('flowIndicator');

const topicInput = document.getElementById('topicInput');
const presetSelect = document.getElementById('presetSelect');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stepBtn = document.getElementById('stepBtn');
const resetBtn = document.getElementById('resetBtn');

const delaySlider = document.getElementById('delaySlider');
const delayVal = document.getElementById('delayVal');
const maxTurnsSlider = document.getElementById('maxTurnsSlider');
const maxTurnsVal = document.getElementById('maxTurnsVal');

const columnA = document.getElementById('columnA');
const columnB = document.getElementById('columnB');
const feedA = document.getElementById('feedA');
const feedB = document.getElementById('feedB');
const statusA = document.getElementById('statusA');
const statusB = document.getElementById('statusB');

const dispNameA = document.getElementById('dispNameA');
const dispModelA = document.getElementById('dispModelA');
const dispNameB = document.getElementById('dispNameB');
const dispModelB = document.getElementById('dispModelB');

const injectInput = document.getElementById('injectInput');
const injectBtn = document.getElementById('injectBtn');
const exportBtn = document.getElementById('exportBtn');

// Modal Elements
const settingsModal = document.getElementById('settingsModal');
const toggleSettingsBtn = document.getElementById('toggleSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const refreshModelsBtn = document.getElementById('refreshModelsBtn');
const ollamaUrl = document.getElementById('ollamaUrl');

const cfgNameA = document.getElementById('cfgNameA');
const cfgModelA = document.getElementById('cfgModelA');
const cfgTempA = document.getElementById('cfgTempA');
const tempValA = document.getElementById('tempValA');
const cfgSystemA = document.getElementById('cfgSystemA');

const cfgNameB = document.getElementById('cfgNameB');
const cfgModelB = document.getElementById('cfgModelB');
const cfgTempB = document.getElementById('cfgTempB');
const tempValB = document.getElementById('tempValB');
const cfgSystemB = document.getElementById('cfgSystemB');

// Initialize WebSocket
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("WebSocket connected to Llama Duo Server");
    updateConnectionBadge(true, false);
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (e) {
      console.error("Error parsing WS message:", e, event.data);
    }
  };

  ws.onclose = () => {
    console.warn("WebSocket disconnected. Reconnecting in 2s...");
    updateConnectionBadge(false, false);
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
  };
}

function updateConnectionBadge(connected, ollamaOnline) {
  if (!connected) {
    connectionStatus.className = 'badge badge-warning';
    connectionStatus.innerHTML = '<span class="dot"></span> Disconnected';
  } else if (ollamaOnline) {
    connectionStatus.className = 'badge badge-success';
    connectionStatus.innerHTML = '<span class="dot"></span> Ollama Live';
  } else {
    connectionStatus.className = 'badge badge-warning';
    connectionStatus.innerHTML = '<span class="dot"></span> Sim Mode (Ollama Offline)';
  }
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'init':
      handleInit(msg);
      break;

    case 'status':
      updateStatus(msg);
      break;

    case 'turn_start':
      handleTurnStart(msg);
      break;

    case 'token':
      handleToken(msg);
      break;

    case 'turn_end':
      handleTurnEnd(msg);
      break;

    case 'paused_step':
      pauseBtn.textContent = '▶ Resume';
      pauseBtn.classList.replace('btn-secondary', 'btn-primary');
      activeState.textContent = 'Paused (Step)';
      activeState.className = 'badge badge-neutral';
      break;

    case 'injected':
      handleInjected(msg);
      break;

    case 'completed':
      handleCompleted(msg);
      break;

    case 'models_update':
      if (msg.available_models && msg.available_models.length > 0) {
        alert(`Found ${msg.available_models.length} model(s) on Ollama:\n${msg.available_models.join(', ')}`);
      } else {
        alert(msg.ollama_online ? "Ollama is online but has no downloaded models yet." : "Could not connect to Ollama server.");
      }
      updateConnectionBadge(true, msg.ollama_online);
      break;

    case 'error':
      alert(`Server error: ${msg.message}`);
      break;
  }
}

function handleInit(data) {
  updateConnectionBadge(true, data.ollama_online);
  
  dispNameA.textContent = data.agent_a.name;
  dispModelA.textContent = data.agent_a.model;
  cfgNameA.value = data.agent_a.name;
  cfgModelA.value = data.agent_a.model;
  cfgTempA.value = data.agent_a.temperature;
  tempValA.textContent = data.agent_a.temperature;
  cfgSystemA.value = data.agent_a.system;

  dispNameB.textContent = data.agent_b.name;
  dispModelB.textContent = data.agent_b.model;
  cfgNameB.value = data.agent_b.name;
  cfgModelB.value = data.agent_b.model;
  cfgTempB.value = data.agent_b.temperature;
  tempValB.textContent = data.agent_b.temperature;
  cfgSystemB.value = data.agent_b.system;

  topicInput.value = data.topic;
  maxTurnsSlider.value = data.max_turns;
  maxTurnsVal.textContent = data.max_turns;
  delaySlider.value = data.turn_delay;
  delayVal.textContent = data.turn_delay + 's';

  turnCounter.textContent = `Turn: ${data.current_turn} / ${data.max_turns}`;
  
  if (data.running) {
    setRunningState(true, data.paused);
  }
}

function updateStatus(msg) {
  if (msg.ollama_online !== undefined) {
    updateConnectionBadge(true, msg.ollama_online);
  }
  setRunningState(msg.running, msg.paused);
}

function setRunningState(running, paused) {
  if (running) {
    startBtn.disabled = true;
    pauseBtn.disabled = false;
    if (paused) {
      pauseBtn.textContent = '▶ Resume';
      pauseBtn.className = 'btn btn-primary';
      activeState.textContent = 'Paused';
      activeState.className = 'badge badge-warning';
    } else {
      pauseBtn.textContent = '⏸ Pause';
      pauseBtn.className = 'btn btn-secondary';
      activeState.textContent = 'Live Dialogue';
      activeState.className = 'badge badge-speaking';
    }
  } else {
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    pauseBtn.textContent = '⏸ Pause';
    activeState.textContent = 'Idle';
    activeState.className = 'badge badge-idle';
    columnA.classList.remove('active-speaking-a');
    columnB.classList.remove('active-speaking-b');
    statusA.textContent = 'Ready';
    statusB.textContent = 'Ready';
    statusA.className = 'status-indicator';
    statusB.className = 'status-indicator';
    flowIndicator.className = 'flow-indicator';
  }
}

function handleTurnStart(msg) {
  const isAgentA = msg.agent === 'agent_a';
  currentStreamingAgent = msg.agent;

  turnCounter.textContent = `Turn: ${msg.turn} / ${msg.max_turns}`;

  // Clear placeholders if turn 1
  if (msg.turn === 1) {
    const pA = feedA.querySelector('.feed-placeholder');
    if (pA) pA.remove();
    const pB = feedB.querySelector('.feed-placeholder');
    if (pB) pB.remove();
  }

  // Update visual cues
  if (isAgentA) {
    columnA.classList.add('active-speaking-a');
    columnB.classList.remove('active-speaking-b');
    statusA.textContent = 'Thinking & Speaking...';
    statusA.className = 'status-indicator status-speaking';
    statusB.textContent = 'Listening...';
    statusB.className = 'status-indicator';
    flowIndicator.className = 'flow-indicator flow-right';
  } else {
    columnB.classList.add('active-speaking-b');
    columnA.classList.remove('active-speaking-a');
    statusB.textContent = 'Thinking & Speaking...';
    statusB.className = 'status-indicator status-speaking-b';
    statusA.textContent = 'Listening...';
    statusA.className = 'status-indicator';
    flowIndicator.className = 'flow-indicator flow-left';
  }

  // Create new speech card in target feed
  const feed = isAgentA ? feedA : feedB;
  const card = document.createElement('div');
  card.className = `turn-card ${isAgentA ? 'turn-card-alpha' : 'turn-card-beta'}`;
  card.id = `turn-${msg.turn}`;

  card.innerHTML = `
    <div class="turn-card-header">
      <span class="turn-badge ${isAgentA ? 'turn-badge-alpha' : 'turn-badge-beta'}">
        ${isAgentA ? '● Alpha' : '● Beta'} — Turn #${msg.turn}
      </span>
      <span class="timestamp">${new Date().toLocaleTimeString()}</span>
    </div>
    <div class="turn-body"><span class="text-content"></span><span class="typing-cursor"></span></div>
  `;

  feed.appendChild(card);
  feed.scrollTop = feed.scrollHeight;
  currentActiveCard = card;
}

function handleToken(msg) {
  if (!currentActiveCard) return;
  const textSpan = currentActiveCard.querySelector('.text-content');
  if (textSpan) {
    textSpan.textContent += msg.token;
    const feed = msg.agent === 'agent_a' ? feedA : feedB;
    feed.scrollTop = feed.scrollHeight;
  }
}

function handleTurnEnd(msg) {
  if (currentActiveCard) {
    const cursor = currentActiveCard.querySelector('.typing-cursor');
    if (cursor) cursor.remove();
    
    // Save to conversation history
    const isAgentA = msg.agent === 'agent_a';
    conversationHistory.push({
      turn: msg.turn,
      agent: isAgentA ? cfgNameA.value : cfgNameB.value,
      role: isAgentA ? 'Agent Alpha' : 'Agent Beta',
      model: isAgentA ? cfgModelA.value : cfgModelB.value,
      text: msg.full_text
    });
  }
  currentActiveCard = null;
}

function handleInjected(msg) {
  // Post injection banner in both feeds
  [feedA, feedB].forEach(feed => {
    const card = document.createElement('div');
    card.className = 'turn-card turn-card-injected';
    card.innerHTML = `
      <div class="turn-card-header">
        <span style="color: var(--accent-amber); font-weight: 600;">🎙️ Audience Intervention</span>
        <span>${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="turn-body" style="font-style: italic; color: #ffd166;">
        "${msg.text}"
      </div>
    `;
    feed.appendChild(card);
    feed.scrollTop = feed.scrollHeight;
  });
}

function handleCompleted(msg) {
  setRunningState(false, false);
  activeState.textContent = 'Completed';
  activeState.className = 'badge badge-success';
}

// User Actions
startBtn.onclick = () => {
  conversationHistory = [];
  feedA.innerHTML = '';
  feedB.innerHTML = '';
  
  const payload = {
    action: 'start',
    topic: topicInput.value.trim(),
    max_turns: parseInt(maxTurnsSlider.value),
    turn_delay: parseFloat(delaySlider.value),
    agent_a: {
      name: cfgNameA.value.trim(),
      model: cfgModelA.value.trim(),
      system: cfgSystemA.value.trim(),
      temperature: parseFloat(cfgTempA.value)
    },
    agent_b: {
      name: cfgNameB.value.trim(),
      model: cfgModelB.value.trim(),
      system: cfgSystemB.value.trim(),
      temperature: parseFloat(cfgTempB.value)
    }
  };

  dispNameA.textContent = cfgNameA.value;
  dispModelA.textContent = cfgModelA.value;
  dispNameB.textContent = cfgNameB.value;
  dispModelB.textContent = cfgModelB.value;

  ws.send(JSON.stringify(payload));
};

pauseBtn.onclick = () => {
  if (pauseBtn.textContent.includes('Pause')) {
    ws.send(JSON.stringify({ action: 'pause' }));
  } else {
    ws.send(JSON.stringify({ action: 'resume' }));
  }
};

stepBtn.onclick = () => {
  ws.send(JSON.stringify({ action: 'step' }));
};

resetBtn.onclick = () => {
  ws.send(JSON.stringify({ action: 'stop' }));
  conversationHistory = [];
  feedA.innerHTML = '<div class="feed-placeholder">Agent Alpha will formulate thoughts and speak here.</div>';
  feedB.innerHTML = '<div class="feed-placeholder">Agent Beta will critique and reply here.</div>';
  turnCounter.textContent = `Turn: 0 / ${maxTurnsSlider.value}`;
  setRunningState(false, false);
};

injectBtn.onclick = sendInjection;
injectInput.onkeydown = (e) => {
  if (e.key === 'Enter') sendInjection();
};

function sendInjection() {
  const text = injectInput.value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ action: 'inject', message: text }));
  injectInput.value = '';
}

// Preset selection
presetSelect.onchange = () => {
  if (presetSelect.value) {
    topicInput.value = presetSelect.value;
  }
};

// Sliders UI feedback
delaySlider.oninput = () => {
  delayVal.textContent = delaySlider.value + 's';
};

maxTurnsSlider.oninput = () => {
  maxTurnsVal.textContent = maxTurnsSlider.value;
  turnCounter.textContent = `Turn: 0 / ${maxTurnsSlider.value}`;
};

cfgTempA.oninput = () => { tempValA.textContent = cfgTempA.value; };
cfgTempB.oninput = () => { tempValB.textContent = cfgTempB.value; };

// Modal handlers
toggleSettingsBtn.onclick = () => settingsModal.classList.add('open');
closeSettingsBtn.onclick = () => settingsModal.classList.remove('open');
saveSettingsBtn.onclick = () => settingsModal.classList.remove('open');

refreshModelsBtn.onclick = () => {
  ws.send(JSON.stringify({
    action: 'check_models',
    url: ollamaUrl.value.trim()
  }));
};

// Export to Markdown
exportBtn.onclick = () => {
  if (conversationHistory.length === 0) {
    alert("No dialogue turns recorded yet!");
    return;
  }

  let md = `# Llama Duo Conversation Log\n\n`;
  md += `**Topic:** ${topicInput.value}\n`;
  md += `**Date:** ${new Date().toLocaleString()}\n`;
  md += `**Agent Alpha:** ${cfgNameA.value} (${cfgModelA.value})\n`;
  md += `**Agent Beta:** ${cfgNameB.value} (${cfgModelB.value})\n\n---\n\n`;

  conversationHistory.forEach(item => {
    md += `### [Turn ${item.turn}] ${item.agent} (${item.role} - \`${item.model}\`)\n\n`;
    md += `${item.text}\n\n---\n\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `llama-duo-dialogue-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(url);
};

// Start WS connection on page load
window.addEventListener('DOMContentLoaded', connectWebSocket);
