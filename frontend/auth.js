import { $, api, loadCsrf } from './api.js';
import { populateLocationFields } from './location.js';

let csrfReady = false;

function showAuthMessage(message) {
  const status = $('#auth-message');
  if (status) status.textContent = message;
}

function setAuthNavigation(user) {
  const loginLink = $('#login-link');
  const signupLink = $('#signup-link');
  const accountLink = $('#nav-account-link');
  const signoutButton = $('#signout-button');

  if (!loginLink || !signupLink || !signoutButton) return;

  loginLink.hidden = Boolean(user);
  signupLink.hidden = Boolean(user);
  if (accountLink) accountLink.hidden = !user;
  signoutButton.hidden = !user;
  signoutButton.disabled = Boolean(user) && !csrfReady;
}

function validatePasswordConfirmation(password, confirmation) {
  confirmation.setCustomValidity(
    confirmation.value === password.value ? '' : 'Passwords do not match.'
  );
}

function enableSubmitWhenReady(form, ready) {
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = !ready;
  return submitButton;
}

async function submitCredentials(form) {
  const submitButton = enableSubmitWhenReady(form, false);
  const mode = form.dataset.authMode;
  const password = $('#password');
  if (mode === 'signup') {
    populateLocationFields($('#country'), $('#timezone'));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const body = {
      email: $('#email').value.trim(),
      password: password.value
    };

    if (mode === 'signup') {
      const firstName = $('#first-name');
      const lastName = $('#last-name');
      const confirmation = $('#confirm-password');
      validatePasswordConfirmation(password, confirmation);

      if (!form.reportValidity()) return;

      body.firstName = firstName.value.trim();
      body.lastName = lastName.value.trim();
      body.country = $('#country').value;
      body.region = $('#region').value.trim();
      body.timezone = $('#timezone').value;
    } else if (!form.reportValidity()) {
      return;
    }

    submitButton.disabled = true;
    showAuthMessage(mode === 'signup' ? 'Creating your account…' : 'Signing you in…');

    try {
      await api(`/api/auth/${mode === 'signup' ? 'register' : 'login'}`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      window.location.href = './index.html';
    } catch (error) {
      showAuthMessage(error.message);
      submitButton.disabled = false;
    }
  });

  $('#confirm-password')?.addEventListener('input', () => {
    $('#confirm-password').setCustomValidity('');
  });

  return submitButton;
}

async function submitForgotPassword(form) {
  const submitButton = enableSubmitWhenReady(form, false);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    submitButton.disabled = true;
    showAuthMessage('Sending reset link…');

    try {
      const result = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: $('#email').value.trim() })
      });
      form.hidden = true;
      showAuthMessage(result.message);
      $('#resend-hint').hidden = false;
    } catch (error) {
      showAuthMessage(error.message);
      submitButton.disabled = false;
    }
  });

  return submitButton;
}

async function submitPasswordReset(form) {
  const submitButton = enableSubmitWhenReady(form, false);
  const token = new URLSearchParams(window.location.search).get('token') || '';

  if (token) {
    // Keep the one-time token out of the address bar and browser history.
    window.history.replaceState(null, '', window.location.pathname);
  } else {
    form.hidden = true;
    showAuthMessage('This reset link is invalid or has expired. Request a new one.');
    $('#reset-link').hidden = false;
    return submitButton;
  }

  const password = $('#password');
  const confirmation = $('#confirm-password');

  confirmation.addEventListener('input', () => {
    confirmation.setCustomValidity('');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    validatePasswordConfirmation(password, confirmation);
    if (!form.reportValidity()) return;

    submitButton.disabled = true;
    showAuthMessage('Updating your password…');

    try {
      const result = await api('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password: password.value })
      });
      form.hidden = true;
      showAuthMessage(result.message);
      $('#login-link-after-reset').hidden = false;
    } catch (error) {
      showAuthMessage(error.message);
      submitButton.disabled = false;
    }
  });

  return submitButton;
}

async function initializeAuthPage() {
  const form = $('#login-form')
    || $('#signup-form')
    || $('#forgot-password-form')
    || $('#reset-password-form');
  let submitButton;

  if (form?.id === 'login-form' || form?.id === 'signup-form') {
    submitButton = await submitCredentials(form);
  } else if (form?.id === 'forgot-password-form') {
    submitButton = await submitForgotPassword(form);
  } else if (form?.id === 'reset-password-form') {
    submitButton = await submitPasswordReset(form);
  }

  try {
    await loadCsrf();
    csrfReady = true;
    if (submitButton && !submitButton.closest('form').hidden) {
      submitButton.disabled = false;
    }
  } catch (error) {
    showAuthMessage(error.message);
  }

  try {
    const data = await api('/api/auth/me');
    setAuthNavigation(data.user);
  } catch (error) {
    showAuthMessage(error.message);
  }

  const signoutButton = $('#signout-button');
  signoutButton?.addEventListener('click', async () => {
    signoutButton.disabled = true;

    try {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.href = './login.html';
    } catch (error) {
      showAuthMessage(error.message);
      signoutButton.disabled = false;
    }
  });
}

initializeAuthPage();
