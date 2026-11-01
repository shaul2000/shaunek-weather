import { $, api, loadCsrf } from './api.js';

const pageSize = 50;
let offset = 0;
let total = 0;

function showError(message) {
  $('#admin-message').textContent = message;
  $('#admin-message').hidden = false;
  $('#admin-content').hidden = true;
}

function renderUsers(users) {
  const list = $('#user-list');
  list.replaceChildren();

  for (const user of users) {
    const row = document.createElement('tr');
    const name = document.createElement('td');
    const email = document.createElement('td');
    const created = document.createElement('td');
    const status = document.createElement('td');
    const action = document.createElement('td');
    const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
    const isBlocked = Boolean(user.blocked_at);

    name.textContent = user.is_admin
      ? `${fullName || 'Administrator'} (shauAdmin)`
      : fullName || '—';
    email.textContent = user.email;
    created.textContent = new Date(user.created_at).toLocaleString();
    status.textContent = user.is_admin ? 'Administrator' : isBlocked ? 'Blocked' : 'Active';

    if (!user.is_admin) {
      const button = document.createElement('button');
      button.className = 'settings-action admin-user-action';
      button.type = 'button';
      button.textContent = isBlocked ? 'Unblock' : 'Block';
      button.setAttribute(
        'aria-label',
        `${isBlocked ? 'Unblock' : 'Block'} ${fullName || user.email}`
      );
      button.addEventListener('click', () => changeBlockStatus(user.id, isBlocked, button));
      action.append(button);
    }

    row.append(name, email, created, status, action);
    list.append(row);
  }
}

async function changeBlockStatus(userId, isBlocked, button) {
  button.disabled = true;
  try {
    await api(`/api/admin/users/${encodeURIComponent(userId)}/${isBlocked ? 'unblock' : 'block'}`, {
      method: 'POST'
    });
    await loadUsers();
  } catch (error) {
    showError(error.message);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

async function loadUsers() {
  const result = await api(`/api/admin/users?limit=${pageSize}&offset=${offset}`);
  total = result.total;
  renderUsers(result.users);
  $('#user-count').textContent = `${total} registered ${total === 1 ? 'account' : 'accounts'}`;

  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + result.users.length, total);
  $('#page-status').textContent = `${first}–${last} of ${total}`;
  $('#previous-page').disabled = offset === 0;
  $('#next-page').disabled = offset + pageSize >= total;
}

async function setupAdminPage() {
  try {
    await loadCsrf();
    const { user, isAdmin, adminUsername } = await api('/api/auth/me');
    if (!user) {
      window.location.replace('./login.html');
      return;
    }
    if (!isAdmin) {
      showError('Administrator access is required to view this page.');
      return;
    }

    $('#admin-username').textContent = adminUsername;
    $('#admin-message').hidden = true;
    $('#admin-content').hidden = false;
    await loadUsers();
  } catch (error) {
    showError(error.message);
  }
}

$('#previous-page').addEventListener('click', async () => {
  offset = Math.max(0, offset - pageSize);
  try {
    await loadUsers();
  } catch (error) {
    showError(error.message);
  }
});

$('#next-page').addEventListener('click', async () => {
  if (offset + pageSize >= total) return;
  offset += pageSize;
  try {
    await loadUsers();
  } catch (error) {
    showError(error.message);
  }
});

setupAdminPage();
