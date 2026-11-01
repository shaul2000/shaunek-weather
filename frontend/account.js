import { $, api, loadCsrf } from './api.js';
import { countryName } from './location.js';

function showError(message) {
  $('#account-message').textContent = message;
  $('#account-message').hidden = false;
  $('#account-details').hidden = true;
  $('#account-edit-prompt').hidden = true;
}

function display(value) {
  return value || 'Not provided';
}

async function setupAccountPage() {
  const signout = $('#signout-button');
  try {
    await loadCsrf();
    const { user } = await api('/api/auth/me');
    if (!user) {
      window.location.replace('./login.html');
      return;
    }

    const { account } = await api('/api/account/settings');
    $('#account-name').textContent = [account.first_name, account.last_name]
      .filter(Boolean)
      .join(' ') || 'Not provided';
    $('#account-email').textContent = account.email;
    $('#account-country').textContent = countryName(account.country) || 'Not provided';
    $('#account-region').textContent = display(account.region);
    $('#account-timezone').textContent = display(account.timezone);
    $('#account-created').textContent = account.created_at
      ? new Date(account.created_at).toLocaleDateString()
      : 'Not available';

    if (account.pending_email) {
      $('#account-pending-email').textContent =
        `Waiting for confirmation at ${account.pending_email}`;
      $('#pending-email-row').hidden = false;
    }

    $('#account-message').hidden = true;
    $('#account-details').hidden = false;
    $('#account-edit-prompt').hidden = false;
    signout.disabled = false;
  } catch (error) {
    showError(error.message);
  }

  signout.addEventListener('click', async () => {
    signout.disabled = true;
    try {
      await api('/api/auth/logout', { method: 'POST' });
      window.location.replace('./login.html');
    } catch (error) {
      showError(error.message);
      signout.disabled = false;
    }
  });
}

setupAccountPage();
