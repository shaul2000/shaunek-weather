const $ = (selector) => document.querySelector(selector);
const API_BASE = (window.SHAUNEK_API_BASE_URL || '').replace(/\/$/, '');

let csrfToken = null;
let currentUser = null;
let authMode = 'login';

async function api(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };

  if (options.method && options.method !== 'GET' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

async function loadCsrf() {
  const data = await api('/api/csrf');
  csrfToken = data.csrfToken;
}

const weatherText = (code) => {
  if (code === 0) return 'Clear sky';
  if ([1, 2, 3].includes(code)) return 'Partly cloudy';
  if ([45, 48].includes(code)) return 'Fog';
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm';
  return 'Weather conditions';
};

async function loadWeather(city) {
  $('#weather-panel').innerHTML = '<p class="loading">Loading forecast…</p>';
  $('#message').textContent = '';

  try {
    const data = await api(`/api/weather?city=${encodeURIComponent(city)}`);
    const c = data.current;
    const d = data.daily;
    const place = data.place;
    const location = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
    const metrics = [
      ['Feels like', `${Math.round(c.apparent_temperature)}°C`],
      ['Humidity', `${c.relative_humidity_2m}%`],
      ['Wind', `${Math.round(c.wind_speed_10m)} km/h`],
      ['Precipitation', `${c.precipitation} mm`]
    ];

    $('#weather-panel').innerHTML = `
      <div class="weather-head">
        <div>
          <div class="place">${escapeHtml(location)}</div>
          <p class="muted">${weatherText(c.weather_code)} · Updated ${escapeHtml(c.time.replace('T', ' '))}</p>
        </div>
        <div class="temperature">${Math.round(c.temperature_2m)}°C</div>
      </div>
      <div class="metrics">
        ${metrics
          .map(
            ([label, value]) => `
              <div class="metric">
                <span class="muted">${label}</span>
                <strong>${value}</strong>
              </div>
            `
          )
          .join('')}
      </div>
      <h2>7-day forecast</h2>
      <div class="forecast">
        ${d.time
          .map(
            (date, i) => `
              <div class="day">
                <span class="muted">${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: 'short'
                })}</span>
                <strong>${weatherText(d.weather_code[i])}</strong>
                <span>${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°</span>
              </div>
            `
          )
          .join('')}
      </div>
      <p class="muted">Sunrise: ${escapeHtml(d.sunrise[0].split('T')[1])} · Sunset: ${escapeHtml(d.sunset[0].split('T')[1])}</p>
      <button id="save-location" type="button">Save this location</button>
    `;

    $('#save-location').addEventListener('click', saveLocation);
  } catch (error) {
    $('#weather-panel').innerHTML = '<p>We could not load this forecast. Check the city name or try again shortly.</p>';
    $('#message').textContent = error.message;
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

async function refreshUser() {
  const data = await api('/api/auth/me');
  currentUser = data.user;
  $('#auth-open').textContent = currentUser ? `Sign out (${currentUser.email})` : 'Sign in';

  if (currentUser) {
    loadLocations();
  } else {
    $('#saved-list').textContent = 'Sign in to manage saved places.';
  }
}

async function saveLocation() {
  const city = $('#city').value.trim();

  try {
    await api('/api/locations', {
      method: 'POST',
      body: JSON.stringify({ city })
    });
    $('#message').textContent = 'Location saved.';
    await loadLocations();
  } catch (error) {
    $('#message').textContent = error.message;
  }
}

async function loadLocations() {
  try {
    const { locations } = await api('/api/locations');
    $('#saved-list').innerHTML = locations.length
      ? locations
          .map(
            (item) => `
              <div class="saved-item">
                <button class="quiet" data-city="${escapeHtml(item.city)}" type="button">${escapeHtml(item.city)}</button>
                <button class="remove" data-id="${item.id}" aria-label="Remove ${escapeHtml(item.city)}" type="button">×</button>
              </div>
            `
          )
          .join('')
      : '<p>No saved places yet.</p>';

    $('#saved-list').querySelectorAll('[data-city]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('#city').value = btn.dataset.city;
        loadWeather(btn.dataset.city);
      });
    });

    $('#saved-list').querySelectorAll('.remove').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/locations/${btn.dataset.id}`, { method: 'DELETE' });
          loadLocations();
        } catch (error) {
          $('#message').textContent = error.message;
        }
      });
    });
  } catch (error) {
    $('#saved-list').textContent = error.message;
  }
}

$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  loadWeather($('#city').value.trim());
});

$('#auth-open').addEventListener('click', async () => {
  if (currentUser) {
    try {
      await api('/api/auth/logout', { method: 'POST' });
      csrfToken = null;
      await loadCsrf();
      await refreshUser();
    } catch (error) {
      $('#message').textContent = error.message;
    }
    return;
  }

  authMode = 'login';
  updateAuthDialog();
  $('#auth-dialog').showModal();
});

function updateAuthDialog() {
  $('#auth-title').textContent = authMode === 'login' ? 'Sign in' : 'Create your account';
  $('#auth-submit').textContent = authMode === 'login' ? 'Sign in' : 'Register';
  $('#auth-toggle').textContent = authMode === 'login' ? 'Create an account instead' : 'I already have an account';
  $('#password').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
}

$('#auth-toggle').addEventListener('click', () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  updateAuthDialog();
});

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const data = await api(`/api/auth/${authMode}`, {
      method: 'POST',
      body: JSON.stringify({
        email: $('#email').value,
        password: $('#password').value
      })
    });

    csrfToken = data.csrfToken;
    $('#auth-dialog').close();
    $('#auth-form').reset();
    await refreshUser();
  } catch (error) {
    $('#auth-message').textContent = error.message;
  }
});

(async () => {
  try {
    await loadCsrf();
    await refreshUser();
    await loadWeather($('#city').value);
  } catch (error) {
    $('#message').textContent = 'Could not connect to the application API.';
  }
})();
