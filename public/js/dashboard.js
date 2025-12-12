/**
 * Dashboard JavaScript - Data visualization and interactions
 */

requireAuth();

let heartRateChart = null;
let bloodOxygenChart = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadUserProfile();
  await loadWeeklySummary();

  document.querySelectorAll('.view-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      const isWeekly = button.dataset.view === 'weekly';
      document.getElementById('weekly-view').style.display = isWeekly ? 'block' : 'none';
      document.getElementById('daily-view').style.display = isWeekly ? 'none' : 'block';
      
      if (!isWeekly) {
        document.getElementById('selected-date').value = new Date().toISOString().split('T')[0];
      }
    });
  });

  document.getElementById('load-daily-btn').addEventListener('click', async () => {
    const date = document.getElementById('selected-date').value;
    if (date) await loadDailyData(date);
  });

  document.getElementById('preferences-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await updatePreferences();
  });

  await loadUserPreferences();
});

async function loadUserProfile() {
  try {
    const data = await apiRequest('/users/me');
    document.getElementById('user-name').textContent = data.user.fullName;
  } catch (error) {
    console.error('Error loading profile:', error);
  }
}

async function loadWeeklySummary() {
  try {
    const data = await apiRequest('/measurements/summary/weekly');
    const s = data.summary;

    document.getElementById('avg-heart-rate').textContent = s.avgHeartRate || '--';
    document.getElementById('max-heart-rate').textContent = s.maxHeartRate || '--';
    document.getElementById('min-heart-rate').textContent = s.minHeartRate || '--';
    document.getElementById('avg-blood-oxygen').textContent = s.avgBloodOxygen || '--';
    document.getElementById('measurement-count').textContent = s.measurementCount || 0;
    
    if (s.startDate && s.endDate) {
      document.getElementById('date-range').textContent = `${formatDate(s.startDate)} - ${formatDate(s.endDate)}`;
    }

    if (s.dailyBreakdown?.length > 0) await loadWeeklyChart();
  } catch (error) {
    console.error('Error loading weekly summary:', error);
  }
}

async function loadWeeklyChart() {
  try {
    const data = await apiRequest('/measurements/chart/weekly');
    const c = data.chartData;

    if (c?.dates?.length > 0) {
      const labels = c.dates.map(d => { const dt = new Date(d); return `${dt.getMonth()+1}/${dt.getDate()}`; });
      createWeeklyHeartRateChart(labels, c.heartRate);
      createWeeklyBloodOxygenChart(labels, c.bloodOxygen);
    }
  } catch (error) {
    console.error('Error loading weekly chart:', error);
  }
}

async function loadDailyData(date) {
  try {
    const data = await apiRequest(`/measurements/daily/${date}`);
    const m = data.measurements;

    if (m.length === 0) {
      document.getElementById('no-data-message').style.display = 'block';
      document.querySelectorAll('.chart-wrapper').forEach(el => el.style.display = 'none');
      return;
    }

    document.getElementById('no-data-message').style.display = 'none';
    document.querySelectorAll('.chart-wrapper').forEach(el => el.style.display = 'block');

    const times = m.map(x => formatTime(x.timestamp));
    const hr = m.map(x => x.heartRate);
    const o2 = m.map(x => x.bloodOxygen);

    const hrMin = Math.min(...hr), hrMax = Math.max(...hr), hrAvg = Math.round(hr.reduce((a,b) => a+b, 0) / hr.length);
    const o2Min = Math.min(...o2), o2Max = Math.max(...o2), o2Avg = Math.round(o2.reduce((a,b) => a+b, 0) / o2.length);

    document.getElementById('daily-hr-min').textContent = hrMin;
    document.getElementById('daily-hr-max').textContent = hrMax;
    document.getElementById('daily-hr-avg').textContent = hrAvg;
    document.getElementById('daily-o2-min').textContent = o2Min;
    document.getElementById('daily-o2-max').textContent = o2Max;
    document.getElementById('daily-o2-avg').textContent = o2Avg;

    createHeartRateChart(times, hr, hrMin, hrMax);
    createBloodOxygenChart(times, o2, o2Min, o2Max);
  } catch (error) {
    console.error('Error loading daily data:', error);
  }
}

function createHeartRateChart(labels, data, minVal, maxVal) {
  const ctx = document.getElementById('heart-rate-chart');
  if (heartRateChart) heartRateChart.destroy();

  heartRateChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Heart Rate (bpm)',
        data,
        borderColor: '#e74c3c',
        backgroundColor: 'rgba(231, 76, 60, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, position: 'top' } },
      scales: {
        y: { beginAtZero: false, title: { display: true, text: 'Heart Rate (bpm)' } },
        x: { title: { display: true, text: 'Time of Day' } }
      }
    }
  });
}

function createBloodOxygenChart(labels, data, minVal, maxVal) {
  const ctx = document.getElementById('blood-oxygen-chart');
  if (bloodOxygenChart) bloodOxygenChart.destroy();

  bloodOxygenChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Blood Oxygen (%)',
        data,
        borderColor: '#3498db',
        backgroundColor: 'rgba(52, 152, 219, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: true, position: 'top' } },
      scales: {
        y: { beginAtZero: false, min: 85, max: 100, title: { display: true, text: 'Blood Oxygen (%)' } },
        x: { title: { display: true, text: 'Time of Day' } }
      }
    }
  });
}

function createWeeklyHeartRateChart(labels, data) {
  let container = document.getElementById('weekly-heart-rate-chart-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'chart-wrapper';
    container.id = 'weekly-heart-rate-chart-container';
    container.innerHTML = '<h3>Average Heart Rate (Last 7 Days)</h3><canvas id="weekly-heart-rate-chart"></canvas>';
    document.getElementById('weekly-view').appendChild(container);
  }

  const ctx = document.getElementById('weekly-heart-rate-chart');
  if (!ctx) return;
  if (window.weeklyHeartRateChart) window.weeklyHeartRateChart.destroy();

  window.weeklyHeartRateChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Avg Heart Rate (bpm)', data, backgroundColor: 'rgba(231, 76, 60, 0.6)', borderColor: '#e74c3c', borderWidth: 2 }] },
    options: { responsive: true, scales: { y: { beginAtZero: false, title: { display: true, text: 'Heart Rate (bpm)' } } } }
  });
}

function createWeeklyBloodOxygenChart(labels, data) {
  let container = document.getElementById('weekly-blood-oxygen-chart-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'chart-wrapper';
    container.id = 'weekly-blood-oxygen-chart-container';
    container.innerHTML = '<h3>Average Blood Oxygen (Last 7 Days)</h3><canvas id="weekly-blood-oxygen-chart"></canvas>';
    document.getElementById('weekly-view').appendChild(container);
  }

  const ctx = document.getElementById('weekly-blood-oxygen-chart');
  if (!ctx) return;
  if (window.weeklyBloodOxygenChart) window.weeklyBloodOxygenChart.destroy();

  window.weeklyBloodOxygenChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Avg Blood Oxygen (%)', data, backgroundColor: 'rgba(52, 152, 219, 0.6)', borderColor: '#3498db', borderWidth: 2 }] },
    options: { responsive: true, scales: { y: { beginAtZero: false, min: 85, max: 100, title: { display: true, text: 'Blood Oxygen (%)' } } } }
  });
}

async function loadUserPreferences() {
  try {
    const data = await apiRequest('/users/me');
    const prefs = data.user.measurementPreferences;
    document.getElementById('start-time').value = prefs.startTime;
    document.getElementById('end-time').value = prefs.endTime;
    document.getElementById('frequency').value = prefs.frequency;
  } catch (error) {
    console.error('Error loading preferences:', error);
  }
}

async function updatePreferences() {
  try {
    await apiRequest('/users/me/preferences', {
      method: 'PUT',
      body: JSON.stringify({
        startTime: document.getElementById('start-time').value,
        endTime: document.getElementById('end-time').value,
        frequency: parseInt(document.getElementById('frequency').value)
      })
    });
    alert('Preferences updated! Your devices will sync the new settings.');
  } catch (error) {
    console.error('Error updating preferences:', error);
    alert('Error updating preferences. Please try again.');
  }
}
