/**
 * Physician Dashboard JavaScript - Physician portal (ECE 513)
 */

let patientsData = [];
let patientChart = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (!isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }
  await loadPhysicianProfile();
  await loadPatients();
  setupEventListeners();
});

async function loadPhysicianProfile() {
  try {
    const data = await apiRequest('/users/physician/me');
    if (data.success) {
      document.getElementById('physician-name').textContent = data.physician.fullName.replace('Dr. ', '');
      if (data.physician.specialty) {
        document.getElementById('physician-specialty').textContent = data.physician.specialty;
      }
      document.getElementById('total-patients').textContent = data.patientCount || 0;
    }
  } catch (error) {
    console.error('Error loading physician profile:', error);
    if (error.message.includes('Physician account required') || error.message.includes('Access denied')) {
      alert('This page is only accessible to physicians.');
      removeAuthToken();
      window.location.href = '/login.html';
    }
  }
}

async function loadPatients() {
  try {
    const data = await apiRequest('/users/physician/patients');
    if (data.success) {
      patientsData = data.patients;
      await renderPatients(patientsData);
      updateStatistics();
    }
  } catch (error) {
    console.error('Error loading patients:', error);
    document.getElementById('patients-tbody').innerHTML = `<tr><td colspan="6" style="text-align: center; color: red;">Error: ${error.message}</td></tr>`;
  }
}

async function renderPatients(patients) {
  const tbody = document.getElementById('patients-tbody');
  const noPatients = document.getElementById('no-patients');
  const table = document.getElementById('patients-table');

  if (patients.length === 0) {
    table.style.display = 'none';
    noPatients.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  noPatients.style.display = 'none';

  const patientsWithStatus = await Promise.all(patients.map(async (p) => {
    try {
      const summary = await apiRequest(`/measurements/patient/${p._id}/summary`);
      return { ...p, summary: summary.summary };
    } catch { return { ...p, summary: null }; }
  }));

  tbody.innerHTML = patientsWithStatus.map(p => {
    const status = getPatientStatus(p.summary);
    const lastReading = p.summary?.measurementCount > 0 ? `${p.summary.avgHeartRate} bpm avg` : 'No data';
    return `
      <tr>
        <td><strong>${p.fullName || 'Unknown'}</strong></td>
        <td>${p.email}</td>
        <td>${p.phone || '--'}</td>
        <td><span class="status ${status.class}">${status.text}</span></td>
        <td>${lastReading}</td>
        <td><button class="btn-view" onclick="viewPatientDetails('${p._id}')">View Details</button></td>
      </tr>
    `;
  }).join('');

  patientsData = patientsWithStatus;
  updateStatistics();
}

function getPatientStatus(summary) {
  if (!summary || summary.measurementCount === 0) return { text: 'No Data', class: 'no-data' };
  const { avgHeartRate: avg, maxHeartRate: max, minHeartRate: min } = summary;
  if (avg > 120 || avg < 50 || max > 180 || min < 40) return { text: 'Critical', class: 'critical' };
  if (avg > 100 || avg < 55 || max > 150) return { text: 'Warning', class: 'warning' };
  return { text: 'Normal', class: 'normal' };
}

function updateStatistics() {
  let normal = 0, warning = 0, critical = 0;
  patientsData.forEach(p => {
    const s = getPatientStatus(p.summary);
    if (s.class === 'normal') normal++;
    else if (s.class === 'warning') warning++;
    else if (s.class === 'critical') critical++;
  });
  document.getElementById('total-patients').textContent = patientsData.length;
  document.getElementById('normal-patients').textContent = normal;
  document.getElementById('warning-patients').textContent = warning;
  document.getElementById('critical-patients').textContent = critical;
}

async function viewPatientDetails(patientId) {
  const patient = patientsData.find(p => p._id === patientId);
  if (!patient) { alert('Patient not found'); return; }

  document.getElementById('modal-patient-name').textContent = patient.fullName || 'Unknown';
  document.getElementById('modal-email').textContent = patient.email;
  document.getElementById('modal-phone').textContent = patient.phone || 'Not provided';
  document.getElementById('modal-dob').textContent = patient.dateOfBirth ? formatDate(patient.dateOfBirth) : 'Not provided';
  document.getElementById('modal-joined').textContent = formatDate(patient.createdAt);

  if (patient.summary?.measurementCount > 0) {
    document.getElementById('modal-avg-hr').textContent = patient.summary.avgHeartRate;
    document.getElementById('modal-min-hr').textContent = patient.summary.minHeartRate;
    document.getElementById('modal-max-hr').textContent = patient.summary.maxHeartRate;
    document.getElementById('modal-readings').textContent = patient.summary.measurementCount;
  } else {
    ['modal-avg-hr', 'modal-min-hr', 'modal-max-hr'].forEach(id => document.getElementById(id).textContent = '--');
    document.getElementById('modal-readings').textContent = '0';
  }

  await loadPatientChart(patientId);
  document.getElementById('patient-modal').classList.add('show');
}

async function loadPatientChart(patientId) {
  try {
    const data = await apiRequest(`/measurements/patient/${patientId}/summary`);
    const ctx = document.getElementById('patient-chart').getContext('2d');
    if (patientChart) patientChart.destroy();

    if (!data.success || !data.summary?.measurementCount) {
      patientChart = new Chart(ctx, {
        type: 'line',
        data: { labels: ['No Data'], datasets: [{ label: 'Heart Rate', data: [0], borderColor: '#e74c3c' }] },
        options: { responsive: true, plugins: { legend: { display: false } } }
      });
      return;
    }

    const s = data.summary;
    patientChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Min', 'Average', 'Max'],
        datasets: [{
          label: 'Heart Rate (bpm)',
          data: [s.minHeartRate, s.avgHeartRate, s.maxHeartRate],
          backgroundColor: ['rgba(52, 152, 219, 0.8)', 'rgba(46, 204, 113, 0.8)', 'rgba(231, 76, 60, 0.8)'],
          borderColor: ['#3498db', '#2ecc71', '#e74c3c'],
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        scales: { y: { beginAtZero: false, min: Math.max(0, s.minHeartRate - 20), max: s.maxHeartRate + 20 } },
        plugins: { legend: { display: false }, title: { display: true, text: 'Weekly Heart Rate Summary' } }
      }
    });
  } catch (error) {
    console.error('Error loading patient chart:', error);
  }
}

function setupEventListeners() {
  document.getElementById('search-input').addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase();
    const filtered = patientsData.filter(p => 
      p.fullName?.toLowerCase().includes(term) || p.email?.toLowerCase().includes(term)
    );
    renderFilteredPatients(filtered);
  });

  document.getElementById('refresh-btn').addEventListener('click', async () => {
    document.getElementById('refresh-btn').textContent = '⏳ Loading...';
    await loadPatients();
    document.getElementById('refresh-btn').textContent = '🔄 Refresh';
  });

  const modal = document.getElementById('patient-modal');
  modal.querySelector('.close').addEventListener('click', () => modal.classList.remove('show'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

  document.getElementById('logout-btn').addEventListener('click', (e) => {
    e.preventDefault();
    removeAuthToken();
    window.location.href = '/login.html';
  });

  document.querySelector('.hamburger')?.addEventListener('click', () => {
    document.querySelector('.nav-menu').classList.toggle('active');
  });
}

function renderFilteredPatients(patients) {
  const tbody = document.getElementById('patients-tbody');
  if (patients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No patients found.</td></tr>';
    return;
  }
  tbody.innerHTML = patients.map(p => {
    const status = getPatientStatus(p.summary);
    const lastReading = p.summary?.measurementCount > 0 ? `${p.summary.avgHeartRate} bpm avg` : 'No data';
    return `
      <tr>
        <td><strong>${p.fullName || 'Unknown'}</strong></td>
        <td>${p.email}</td>
        <td>${p.phone || '--'}</td>
        <td><span class="status ${status.class}">${status.text}</span></td>
        <td>${lastReading}</td>
        <td><button class="btn-view" onclick="viewPatientDetails('${p._id}')">View Details</button></td>
      </tr>
    `;
  }).join('');
}
