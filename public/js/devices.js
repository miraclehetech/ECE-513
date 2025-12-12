/**
 * Devices JavaScript - Device management
 */

requireAuth();

document.addEventListener('DOMContentLoaded', async () => {
  await loadDevices();

  document.getElementById('add-device-btn').addEventListener('click', () => openModal('add-device-modal'));
  document.getElementById('cancel-add-btn').addEventListener('click', () => closeModal('add-device-modal'));
  document.getElementById('cancel-edit-btn').addEventListener('click', () => closeModal('edit-device-modal'));
  document.getElementById('add-device-form').addEventListener('submit', async (e) => { e.preventDefault(); await registerDevice(); });
  document.getElementById('edit-device-form').addEventListener('submit', async (e) => { e.preventDefault(); await updateDevice(); });
});

async function loadDevices() {
  try {
    const data = await apiRequest('/devices');
    const devices = data.devices;
    const devicesList = document.getElementById('devices-list');
    const noDevices = document.getElementById('no-devices');

    if (devices.length === 0) {
      devicesList.innerHTML = '';
      noDevices.style.display = 'block';
      return;
    }

    noDevices.style.display = 'none';
    devicesList.innerHTML = devices.map(d => createDeviceCard(d)).join('');

    document.querySelectorAll('.view-device-btn').forEach(btn => {
      btn.addEventListener('click', () => viewDeviceDetails(btn.dataset.deviceId));
    });
    document.querySelectorAll('.edit-device-btn').forEach(btn => {
      btn.addEventListener('click', () => editDevice(btn.dataset.deviceId));
    });
    document.querySelectorAll('.delete-device-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Are you sure you want to remove this device?')) await deleteDevice(btn.dataset.deviceId);
      });
    });
  } catch (error) {
    console.error('Error loading devices:', error);
    showMessage('device-message', 'Error loading devices', 'error');
  }
}

function createDeviceCard(device) {
  const statusClass = device.isActive ? 'active' : 'inactive';
  const statusText = device.isActive ? 'Active' : 'Inactive';
  const lastConnected = device.lastConnected ? `Last connected: ${formatDateTime(device.lastConnected)}` : 'Never connected';

  return `
    <div class="device-card">
      <div class="device-header">
        <h3>${device.deviceName}</h3>
        <span class="device-status ${statusClass}">${statusText}</span>
      </div>
      <p><strong>Device ID:</strong> ${device.deviceId}</p>
      <p><strong>Firmware:</strong> ${device.firmwareVersion || '1.0.0'}</p>
      <p><small>${lastConnected}</small></p>
      <div class="device-actions">
        <button class="btn btn-secondary view-device-btn" data-device-id="${device._id}">View Details</button>
        <button class="btn btn-primary edit-device-btn" data-device-id="${device._id}">Edit</button>
        <button class="btn btn-danger delete-device-btn" data-device-id="${device._id}">Remove</button>
      </div>
    </div>
  `;
}

async function registerDevice() {
  try {
    const deviceData = {
      deviceId: document.getElementById('device-id').value.trim(),
      deviceName: document.getElementById('device-name').value.trim(),
      firmwareVersion: document.getElementById('firmware-version').value.trim() || '1.0.0',
      isActive: document.getElementById('is-active').checked
    };

    const data = await apiRequest('/devices/register', { method: 'POST', body: JSON.stringify(deviceData) });

    showMessage('device-message', 'Device registered successfully!', 'success');
    closeModal('add-device-modal');
    document.getElementById('add-device-form').reset();
    document.getElementById('firmware-version').value = '1.0.0';
    document.getElementById('is-active').checked = true;
    await loadDevices();

    alert(`Device registered!\n\nAPI Key: ${data.device.apiKey}\n\nSave this key for your IoT device.`);
  } catch (error) {
    console.error('Error registering device:', error);
    showMessage('device-message', error.message, 'error');
  }
}

async function viewDeviceDetails(deviceId) {
  try {
    const data = await apiRequest(`/devices/${deviceId}`);
    const device = data.device;

    document.getElementById('device-details-content').innerHTML = `
      <div style="padding: 1.5rem;">
        <h3>${device.deviceName}</h3>
        <div style="margin-top: 1rem;">
          <p><strong>Device ID:</strong> ${device.deviceId}</p>
          <p><strong>API Key:</strong> <code style="background: #f0f0f0; padding: 0.25rem 0.5rem; border-radius: 4px; word-break: break-all;">${device.apiKey}</code></p>
          <p><strong>Status:</strong> <span style="color: ${device.isActive ? '#28a745' : '#dc3545'};">${device.isActive ? 'Active' : 'Inactive'}</span></p>
          <p><strong>Firmware:</strong> ${device.firmwareVersion || '1.0.0'}</p>
          <p><strong>Last Connected:</strong> ${device.lastConnected ? formatDateTime(device.lastConnected) : 'Never'}</p>
          <p><strong>Created:</strong> ${formatDate(device.createdAt)}</p>
        </div>
        <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #ddd;">
          <button class="btn btn-primary edit-from-details-btn" data-device-id="${device._id}">Edit Device</button>
        </div>
      </div>
    `;
    
    document.querySelector('.edit-from-details-btn')?.addEventListener('click', async function() {
      closeModal('device-details-modal');
      await editDevice(this.dataset.deviceId);
    });
    
    openModal('device-details-modal');
  } catch (error) {
    console.error('Error loading device details:', error);
    showMessage('device-message', 'Error loading device details', 'error');
  }
}

async function editDevice(deviceId) {
  try {
    const data = await apiRequest(`/devices/${deviceId}`);
    const device = data.device;

    document.getElementById('edit-device-id').value = device._id;
    document.getElementById('edit-device-name').value = device.deviceName;
    document.getElementById('edit-firmware-version').value = device.firmwareVersion || '1.0.0';
    document.getElementById('edit-is-active').checked = device.isActive;

    closeModal('device-details-modal');
    openModal('edit-device-modal');
  } catch (error) {
    console.error('Error loading device for edit:', error);
    showMessage('device-message', 'Error loading device details', 'error');
  }
}

async function updateDevice() {
  try {
    const deviceId = document.getElementById('edit-device-id').value;
    await apiRequest(`/devices/${deviceId}`, {
      method: 'PUT',
      body: JSON.stringify({
        deviceName: document.getElementById('edit-device-name').value.trim(),
        firmwareVersion: document.getElementById('edit-firmware-version').value.trim() || '1.0.0',
        isActive: document.getElementById('edit-is-active').checked
      })
    });

    showMessage('device-message', 'Device updated successfully!', 'success');
    closeModal('edit-device-modal');
    await loadDevices();
  } catch (error) {
    console.error('Error updating device:', error);
    showMessage('device-message', error.message || 'Error updating device', 'error');
  }
}

async function deleteDevice(deviceId) {
  try {
    await apiRequest(`/devices/${deviceId}`, { method: 'DELETE' });
    showMessage('device-message', 'Device removed successfully', 'success');
    await loadDevices();
  } catch (error) {
    console.error('Error deleting device:', error);
    showMessage('device-message', 'Error removing device', 'error');
  }
}
