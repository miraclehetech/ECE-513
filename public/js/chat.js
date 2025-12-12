/**
 * Chat JavaScript - LLM health assistant
 */

requireAuth();

let isWaiting = false;

document.addEventListener('DOMContentLoaded', async () => {
  await loadContextSummary();
  setupChatListeners();
  document.getElementById('chat-input').focus();
});

async function loadContextSummary() {
  try {
    const data = await apiRequest('/chat/context');
    if (data.success) {
      document.getElementById('ctx-measurements').textContent = data.summary.totalMeasurements;
      document.getElementById('ctx-heart-rate').textContent = data.summary.avgHeartRate || '--';
      document.getElementById('ctx-spo2').textContent = data.summary.avgBloodOxygen || '--';
      document.getElementById('ctx-period').textContent = data.summary.dateRange;
    }
  } catch (error) {
    console.error('Error loading context:', error);
  }
}

function setupChatListeners() {
  document.getElementById('chat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await sendMessage();
  });

  document.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.getElementById('chat-input').value = btn.dataset.message;
      await sendMessage();
    });
  });

  document.getElementById('chat-input').addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await sendMessage();
    }
  });
}

async function sendMessage() {
  if (isWaiting) return;

  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  document.querySelector('.welcome-message')?.remove();
  addMessage(message, 'user');
  showTypingIndicator();
  setInputState(false);
  isWaiting = true;

  try {
    const data = await apiRequest('/chat', { method: 'POST', body: JSON.stringify({ message }) });
    hideTypingIndicator();
    addMessage(data.success ? data.response : 'Sorry, I encountered an error. Please try again.', 'assistant');
    if (!data.success) showError(data.message);
  } catch (error) {
    console.error('Chat error:', error);
    hideTypingIndicator();
    if (error.message.includes('not configured')) {
      showError('LLM service is not configured.');
      addMessage('I\'m sorry, but I\'m not available right now. The administrator needs to configure the AI service.', 'assistant');
    } else {
      addMessage('Sorry, I encountered an error. Please try again later.', 'assistant');
    }
  }

  setInputState(true);
  isWaiting = false;
  input.focus();
}

function addMessage(content, type) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.innerHTML = `
    <div class="message-avatar">${type === 'user' ? '👤' : '🤖'}</div>
    <div>
      <div class="message-content">${formatMessage(content)}</div>
      <div class="message-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function formatMessage(content) {
  let f = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paragraphs = f.split(/\n\n+/);
  f = paragraphs.length > 1 
    ? paragraphs.map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('') 
    : `<p>${f.replace(/\n/g, '<br>')}</p>`;
  return f.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function showTypingIndicator() {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = 'typing-indicator';
  div.innerHTML = '<div class="message-avatar">🤖</div><div class="typing-indicator"><span></span><span></span><span></span></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function hideTypingIndicator() {
  document.getElementById('typing-indicator')?.remove();
}

function setInputState(enabled) {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('send-btn');
  input.disabled = !enabled;
  btn.disabled = !enabled;
  input.placeholder = enabled ? 'Ask about your health data...' : 'Waiting for response...';
}

function showError(message) {
  const banner = document.getElementById('error-banner');
  banner.textContent = message;
  banner.style.display = 'block';
  setTimeout(() => { banner.style.display = 'none'; }, 5000);
}
