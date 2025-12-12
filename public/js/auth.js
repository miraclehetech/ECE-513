/**
 * Auth JavaScript - Login and registration
 */

document.addEventListener('DOMContentLoaded', () => {
  if (isAuthenticated()) {
    window.location.href = '/dashboard.html';
  }

  // Login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const userTypeInput = document.getElementById('user-type');

    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        tabButtons.forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        userTypeInput.value = button.dataset.tab;
        
        const physicianLink = document.querySelector('.physician-link');
        if (physicianLink) {
          physicianLink.style.display = button.dataset.tab === 'physician' ? 'block' : 'none';
        }
      });
    });

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('login-btn');
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      const userType = document.getElementById('user-type').value;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      try {
        const data = await apiRequest('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password, userType })
        });

        setAuthToken(data.token);
        showMessage('login-message', 'Login successful! Redirecting...', 'success');

        setTimeout(() => {
          window.location.href = userType === 'physician' ? '/physician-dashboard.html' : '/dashboard.html';
        }, 1000);
      } catch (error) {
        showMessage('login-message', error.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In';
      }
    });
  }

  // Register form
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const strengthMeter = document.getElementById('strength-meter');
    const strengthText = document.getElementById('strength-text');

    if (passwordInput) {
      passwordInput.addEventListener('input', () => {
        const strength = checkPasswordStrength(passwordInput.value);
        strengthMeter.style.width = `${strength.percentage}%`;
        strengthMeter.style.backgroundColor = strength.color;
        strengthText.textContent = strength.text;
        strengthText.style.color = strength.color;
      });
    }

    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('register-btn');
      const password = passwordInput.value;
      const confirmPassword = confirmPasswordInput.value;

      if (password !== confirmPassword) {
        showMessage('register-message', 'Passwords do not match', 'error');
        return;
      }

      const strength = checkPasswordStrength(password);
      if (strength.score < 4) {
        showMessage('register-message', 'Please use a stronger password', 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating account...';

      try {
        const formData = {
          email: document.getElementById('email').value,
          password: password,
          fullName: document.getElementById('fullName').value,
          phone: document.getElementById('phone').value || undefined,
          dateOfBirth: document.getElementById('dateOfBirth').value || undefined
        };

        const data = await apiRequest('/auth/register', {
          method: 'POST',
          body: JSON.stringify(formData)
        });

        setAuthToken(data.token);
        showMessage('register-message', 'Account created successfully! Redirecting...', 'success');
        setTimeout(() => { window.location.href = '/dashboard.html'; }, 1000);
      } catch (error) {
        showMessage('register-message', error.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';
      }
    });
  }
});

/** Check password strength */
function checkPasswordStrength(password) {
  let score = 0;
  if (!password) return { score, text: 'Very Weak', color: '#e74c3c', percentage: 0 };

  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  const levels = [
    { text: 'Very Weak', color: '#e74c3c', percentage: 20 },
    { text: 'Very Weak', color: '#e74c3c', percentage: 20 },
    { text: 'Weak', color: '#e67e22', percentage: 40 },
    { text: 'Weak', color: '#e67e22', percentage: 40 },
    { text: 'Fair', color: '#f39c12', percentage: 60 },
    { text: 'Good', color: '#3498db', percentage: 80 },
    { text: 'Strong', color: '#27ae60', percentage: 100 }
  ];

  return { score, ...levels[score] };
}
