/**
 * Profile JavaScript - User profile management
 */

requireAuth();

let physicians = [];

document.addEventListener('DOMContentLoaded', async () => {
  await loadProfile();
  await loadPhysicians();

  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await updateProfile();
  });

  document.getElementById('select-physician-btn').addEventListener('click', () => {
    openModal('physician-modal');
    displayPhysiciansList();
  });

  document.getElementById('cancel-physician-btn').addEventListener('click', () => {
    closeModal('physician-modal');
  });
});

async function loadProfile() {
  try {
    const data = await apiRequest('/users/me');
    const user = data.user;

    document.getElementById('full-name').value = user.fullName || '';
    document.getElementById('email').value = user.email || '';
    document.getElementById('phone').value = user.phone || '';
    
    if (user.dateOfBirth) {
      document.getElementById('date-of-birth').value = new Date(user.dateOfBirth).toISOString().split('T')[0];
    }

    document.getElementById('account-created').textContent = formatDate(user.createdAt);
    document.getElementById('account-updated').textContent = formatDate(user.updatedAt);
    document.getElementById('device-count').textContent = user.devices ? user.devices.length : 0;

    if (user.physician) {
      document.getElementById('current-physician').innerHTML = `
        <p><strong>Name:</strong> ${user.physician.fullName}</p>
        <p><strong>Email:</strong> ${user.physician.email}</p>
        ${user.physician.specialty ? `<p><strong>Specialty:</strong> ${user.physician.specialty}</p>` : ''}
      `;
    } else {
      document.getElementById('current-physician').innerHTML = '<p>No physician assigned</p>';
    }
  } catch (error) {
    console.error('Error loading profile:', error);
    showMessage('profile-message', 'Error loading profile', 'error');
  }
}

async function updateProfile() {
  try {
    await apiRequest('/users/me', {
      method: 'PUT',
      body: JSON.stringify({
        fullName: document.getElementById('full-name').value,
        phone: document.getElementById('phone').value,
        dateOfBirth: document.getElementById('date-of-birth').value || null
      })
    });
    showMessage('profile-message', 'Profile updated successfully!', 'success');
  } catch (error) {
    console.error('Error updating profile:', error);
    showMessage('profile-message', error.message, 'error');
  }
}

async function loadPhysicians() {
  try {
    const data = await apiRequest('/users/physicians');
    physicians = data.physicians;
  } catch (error) {
    console.error('Error loading physicians:', error);
  }
}

function displayPhysiciansList() {
  const list = document.getElementById('physicians-list');
  
  if (physicians.length === 0) {
    list.innerHTML = '<p style="text-align: center; color: #666;">No physicians available</p>';
    return;
  }

  list.innerHTML = physicians.map(p => `
    <div class="physician-item" data-physician-id="${p._id}">
      <h4>${p.fullName}</h4>
      <p><strong>Email:</strong> ${p.email}</p>
      ${p.specialty ? `<p><strong>Specialty:</strong> ${p.specialty}</p>` : ''}
      ${p.licenseNumber ? `<p><strong>License:</strong> ${p.licenseNumber}</p>` : ''}
    </div>
  `).join('');

  document.querySelectorAll('.physician-item').forEach(item => {
    item.addEventListener('click', () => selectPhysician(item.dataset.physicianId));
  });
}

async function selectPhysician(physicianId) {
  try {
    await apiRequest('/users/me/physician', {
      method: 'PUT',
      body: JSON.stringify({ physicianId })
    });
    showMessage('profile-message', 'Physician assigned successfully!', 'success');
    closeModal('physician-modal');
    await loadProfile();
  } catch (error) {
    console.error('Error selecting physician:', error);
    showMessage('profile-message', error.message, 'error');
  }
}
