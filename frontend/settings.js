import { $, api, loadCsrf } from './api.js';
import { populateLocationFields } from './location.js';
import { getPreferences, savePreferences } from './preferences.js';

function showMessage(id, message) {
  const element = $(`#${id}`);
  if (element) element.textContent = message;
}

function setBusy(form, busy) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = busy;
  return button;
}

function setPendingEmail(email) {
  const status = $('#pending-email');
  status.hidden = !email;
  status.textContent = email
    ? `Waiting for confirmation at ${email}. A new request will replace this one.`
    : '';
}

function setupProfileForm() {
  const form = $('#profile-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const button = setBusy(form, true);
    showMessage('profile-message', 'Saving your details…');
    try {
      const { account } = await api('/api/account/profile', {
        method: 'POST',
        body: JSON.stringify({
          firstName: $('#first-name').value.trim(),
          lastName: $('#last-name').value.trim(),
          country: $('#country').value,
          region: $('#region').value.trim(),
          timezone: $('#timezone').value
        })
      });
      $('#first-name').value = account.first_name;
      $('#last-name').value = account.last_name;
      $('#region').value = account.region || '';
      populateLocationFields($('#country'), $('#timezone'), account);
      showMessage('profile-message', 'Your profile has been updated.');
    } catch (error) {
      showMessage('profile-message', error.message);
    } finally {
      button.disabled = false;
    }
  });
}

function setupEmailForm() {
  const form = $('#email-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const button = setBusy(form, true);
    showMessage('email-message', 'Sending a verification link…');
    try {
      const result = await api('/api/account/email-change', {
        method: 'POST',
        body: JSON.stringify({
          email: $('#new-email').value.trim(),
          currentPassword: $('#email-current-password').value
        })
      });
      setPendingEmail($('#new-email').value.trim());
      $('#email-current-password').value = '';
      showMessage('email-message', result.message);
    } catch (error) {
      showMessage('email-message', error.message);
    } finally {
      button.disabled = false;
    }
  });
}

function setupPasswordForm() {
  const form = $('#password-form');
  const confirmation = $('#password-confirm');
  confirmation.addEventListener('input', () => confirmation.setCustomValidity(''));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    confirmation.setCustomValidity(
      confirmation.value === $('#password-new').value ? '' : 'Passwords do not match.'
    );
    if (!form.reportValidity()) return;

    const button = setBusy(form, true);
    showMessage('password-message', 'Updating your password…');
    try {
      const result = await api('/api/account/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: $('#password-current').value,
          newPassword: $('#password-new').value
        })
      });
      form.reset();
      showMessage('password-message', result.message);
    } catch (error) {
      showMessage('password-message', error.message);
    } finally {
      button.disabled = false;
    }
  });
}

function setupPreferences() {
  const preferences = getPreferences();
  const theme = $('#theme-setting');
  const temperature = $('#temperature-setting');
  const wind = $('#wind-setting');

  theme.value = preferences.theme;
  temperature.value = preferences.temperature;
  wind.value = preferences.wind;

  for (const [control, key] of [
    [theme, 'theme'],
    [temperature, 'temperature'],
    [wind, 'wind']
  ]) {
    control.addEventListener('change', () => {
      try {
        savePreferences({ [key]: control.value });
        showMessage('preference-message', 'Your preferences are saved in this browser.');
      } catch {
        showMessage('preference-message', 'These preferences could not be saved in this browser.');
      }
    });
  }
}

async function setupSettingsPage() {
  const signout = $('#signout-button');
  signout.disabled = true;

  try {
    await loadCsrf();
    const { user } = await api('/api/auth/me');
    if (!user) {
      window.location.replace('./login.html');
      return;
    }

    const { account } = await api('/api/account/settings');
    $('#first-name').value = account.first_name;
    $('#last-name').value = account.last_name;
    $('#current-email').value = account.email;
    $('#region').value = account.region || '';
    populateLocationFields($('#country'), $('#timezone'), account);
    setPendingEmail(account.pending_email);

    setupProfileForm();
    setupEmailForm();
    setupPasswordForm();
    setupPreferences();
    signout.disabled = false;
  } catch (error) {
    showMessage('profile-message', error.message);
  }

  signout.addEventListener('click', async () => {
    signout.disabled = true;
    try {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.replace('./login.html');
    } catch (error) {
      showMessage('profile-message', error.message);
      signout.disabled = false;
    }
  });
}

async function setupEmailVerification() {
  const form = $('#email-verification-form');
  const button = $('#confirm-email-button');
  const token = new URLSearchParams(window.location.search).get('token') || '';

  if (token) {
    window.history.replaceState(null, '', window.location.pathname);
  } else {
    form.hidden = true;
    showMessage('verification-message', 'This confirmation link is invalid or has expired.');
    return;
  }

  try {
    await loadCsrf();
    button.disabled = false;
  } catch (error) {
    showMessage('verification-message', error.message);
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    showMessage('verification-message', 'Confirming your email address…');
    try {
      const result = await api('/api/account/email-change/confirm', {
        method: 'POST',
        body: JSON.stringify({ token })
      });
      form.hidden = true;
      showMessage('verification-message', result.message);
      $('#verification-return').hidden = false;
    } catch (error) {
      showMessage('verification-message', error.message);
      button.disabled = false;
    }
  });
}

if ($('#profile-form')) {
  setupSettingsPage();
} else if ($('#email-verification-form')) {
  setupEmailVerification();
}
