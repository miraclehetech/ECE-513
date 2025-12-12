/**
 * Main JavaScript - Common functions and utilities
 */

const API_URL = window.location.origin + '/api';

function getAuthToken() {
  return localStorage.getItem('authToken');
}

function setAuthToken(token) {
  localStorage.setItem('authToken', token);
}

function removeAuthToken() {
  localStorage.removeItem('authToken');
}

function isAuthenticated() {
  return !!getAuthToken();
}

function requireAuth() {
  if (!isAuthenticated()) {
    window.location.href = '/login.html';
  }
}

/** API request helper with auth token */
async function apiRequest(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
    const data = await response.json();

    if (!response.ok) {
      if (response.status === 401) {
        removeAuthToken();
        if (!window.location.pathname.includes('login.html')) {
          window.location.href = '/login.html';
        }
      }
      throw new Error(data.message || 'Request failed');
    }

    return data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

function showMessage(elementId, message, type = 'info') {
  const messageEl = document.getElementById(elementId);
  if (messageEl) {
    messageEl.textContent = message;
    messageEl.className = `message ${type}`;
    messageEl.style.display = 'block';
    setTimeout(() => { messageEl.style.display = 'none'; }, 5000);
  }
}

function formatDate(dateString) {
  return new Date(dateString).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTime(dateString) {
  return new Date(dateString).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(dateString) {
  return `${formatDate(dateString)} ${formatTime(dateString)}`;
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('show');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('show');
}

// Initialize common UI elements
document.addEventListener('DOMContentLoaded', () => {
  const hamburger = document.querySelector('.hamburger');
  const navMenu = document.querySelector('.nav-menu');

  if (hamburger) {
    hamburger.addEventListener('click', () => navMenu.classList.toggle('active'));
  }

  document.addEventListener('click', (e) => {
    if (navMenu?.classList.contains('active') && !e.target.closest('.navbar')) {
      navMenu.classList.remove('active');
    }
  });

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      removeAuthToken();
      window.location.href = '/login.html';
    });
  }

  // Modal close handlers
  document.querySelectorAll('.modal .close').forEach(button => {
    button.addEventListener('click', () => button.closest('.modal').classList.remove('show'));
  });
});

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.remove('show');
  }
});
