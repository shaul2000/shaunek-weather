import { $, api, escapeHtml, loadCsrf } from './api.js';
import { getPreferences } from './preferences.js';

let currentUser = null;
let authStateReady = false;
let locationClockInterval = null;
let weatherRequestId = 0;
let nextFeaturedOffset = null;
let useFeaturedSearchFallback = false;
let featuredLocationsExhausted = false;
const FEATURED_PAGE_SIZE = 8;
const FEATURED_EXTRA_CITIES = [
  'Paris',
  'Toronto',
  'Mumbai',
  'Seoul',
  'Cairo',
  'Rio de Janeiro',
  'Nairobi',
  'Auckland',
  'Madrid',
  'Berlin',
  'Rome',
  'Amsterdam',
  'Istanbul',
  'Bangkok',
  'Jakarta',
  'Manila',
  'Beijing',
  'Shanghai',
  'Hong Kong',
  'Taipei',
  'Kuala Lumpur',
  'Hanoi',
  'Dhaka',
  'Karachi',
  'Johannesburg',
  'Accra',
  'Addis Ababa',
  'Casablanca',
  'Cape Town',
  'Tunis',
  'Dar es Salaam',
  'Kampala',
  'Mexico City',
  'Los Angeles',
  'Chicago',
  'San Francisco',
  'Vancouver',
  'Montreal',
  'Buenos Aires',
  'Santiago',
  'Lima',
  'Bogota',
  'Sao Paulo',
  'Stockholm',
  'Oslo',
  'Copenhagen',
  'Warsaw'
];

const temperature = (value, unit) => Math.round(
  unit === 'F' ? (value * 9) / 5 + 32 : value
);

function locationLabel(place) {
  return [place.name, place.admin1, place.country].filter(Boolean).join(', ');
}

function updateLocationClock(timezone, localtime, clockStartedAt) {
  const time = $('#location-local-time');
  const date = $('#location-local-date');
  if (!time || !date) return;

  let now = new Date();
  let clockTimezone = timezone;
  if (typeof clockTimezone !== 'string' || !clockTimezone) {
    const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(localtime || '');
    if (!match) {
      time.textContent = 'Local time unavailable';
      date.textContent = '';
      return false;
    }

    const [year, month, day, hour, minute] = match.slice(1).map(Number);
    const start = new Date(clockStartedAt);
    now = new Date(Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      start.getUTCSeconds()
    ) + Date.now() - clockStartedAt);
    clockTimezone = 'UTC';
  }

  time.textContent = new Intl.DateTimeFormat(undefined, {
    timeZone: clockTimezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).format(now);
  date.textContent = new Intl.DateTimeFormat(undefined, {
    timeZone: clockTimezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(now);
  return true;
}

function renderFeaturedWeather(locations, append = false) {
  const preferences = getPreferences();
  const cards = locations
    .map(({ place, current, stale }) => {
      if (!current) {
        return `
          <article class="featured-card featured-unavailable" data-featured-city="${escapeHtml(place.name)}">
            <span class="featured-city">${escapeHtml(place.name)}</span>
            <span class="featured-condition">Weather temporarily unavailable</span>
          </article>
        `;
      }

      const location = locationLabel(place);
      return `
        <button class="featured-card" data-city="${escapeHtml(place.name)}" data-featured-city="${escapeHtml(place.name)}" type="button">
          <span class="featured-card-heading">
            <span class="featured-city">${escapeHtml(location)}</span>
            <span class="featured-temperature">
              ${temperature(current.temperature_2m, preferences.temperature)}°
            </span>
          </span>
          <span class="featured-condition">${escapeHtml(current.condition_text)}</span>
          <span class="featured-feels">
            Feels like ${temperature(current.apparent_temperature, preferences.temperature)}°
            · Updated ${escapeHtml(current.time || place.localtime || 'recently')}
            ${stale ? ' · Cached reading' : ''}
          </span>
        </button>
      `;
    })
    .join('');

  if (append) {
    $('#featured-grid').insertAdjacentHTML('beforeend', cards);
  } else {
    $('#featured-grid').innerHTML = cards;
  }
}

async function loadAdditionalFeaturedBySearch(offset) {
  const existingCities = new Set(
    [...$('#featured-grid').querySelectorAll('[data-featured-city]')]
      .map((card) => card.dataset.featuredCity.trim().toLocaleLowerCase())
  );
  const start = offset - FEATURED_PAGE_SIZE;
  const cities = FEATURED_EXTRA_CITIES
    .slice(start, start + FEATURED_PAGE_SIZE)
    .filter((city) => !existingCities.has(city.toLocaleLowerCase()));
  const results = await Promise.all(
    cities.map(async (city) => {
      try {
        const forecast = await api(`/api/weather?city=${encodeURIComponent(city)}`);
        return { place: forecast.place, current: forecast.current, stale: false };
      } catch (error) {
        return {
          place: { name: city },
          current: null,
          stale: false,
          error
        };
      }
    })
  );

  renderFeaturedWeather(results, true);
  nextFeaturedOffset = offset + FEATURED_PAGE_SIZE;
  featuredLocationsExhausted = start + FEATURED_PAGE_SIZE >= FEATURED_EXTRA_CITIES.length;
  if (featuredLocationsExhausted) {
    nextFeaturedOffset = null;
    $('#featured-more').textContent = 'Search another city';
  }
  const unavailable = results.filter((item) => !item.current).length;
  $('#featured-status').textContent = unavailable
    ? `More locations loaded; ${unavailable} could not be updated.${featuredLocationsExhausted ? ' Search above for other cities.' : ''}`
    : featuredLocationsExhausted
      ? 'All featured locations are shown. Search above for any other city.'
      : 'More locations loaded.';
}

async function loadFeaturedWeather(offset = 0, append = false) {
  const status = $('#featured-status');
  const moreButton = $('#featured-more');
  if (!append) status.textContent = 'Loading current conditions…';

  try {
    const page = await api(
      `/api/weather/featured?offset=${offset}&limit=${FEATURED_PAGE_SIZE}`
    );
    renderFeaturedWeather(page.locations, append);
    useFeaturedSearchFallback = !Object.hasOwn(page, 'has_more');
    featuredLocationsExhausted = !useFeaturedSearchFallback && !page.has_more;
    nextFeaturedOffset = Number.isInteger(page.next_offset)
      ? page.next_offset
      : useFeaturedSearchFallback && page.locations.length > 0
        ? FEATURED_PAGE_SIZE
        : null;
    moreButton.hidden = false;
    moreButton.textContent = featuredLocationsExhausted
      ? 'Search another city'
      : 'View more locations';
    const unavailable = page.locations.filter((item) => !item.current).length;
    const stale = page.locations.some((item) => item.stale);
    status.textContent = unavailable
      ? `${unavailable} location${unavailable === 1 ? '' : 's'} could not be updated.`
      : stale
        ? 'Showing the most recently available conditions for some cities.'
        : 'Current conditions from around the world.';
    return true;
  } catch (error) {
    if (!append) {
      $('#featured-grid').innerHTML = `
        <p class="weather-error">Global weather is temporarily unavailable. Try again shortly.</p>
      `;
      moreButton.hidden = true;
    }
    status.textContent = error.message;
    return false;
  }
}

async function loadWeather(city) {
  const requestId = ++weatherRequestId;
  if (locationClockInterval) {
    clearInterval(locationClockInterval);
    locationClockInterval = null;
  }
  const panel = $('#weather-panel');
  panel.hidden = false;
  panel.innerHTML = '<p class="loading">Loading forecast…</p>';
  $('#message').textContent = '';

  try {
    const data = await api(`/api/weather?city=${encodeURIComponent(city)}`);
    if (requestId !== weatherRequestId) return;
    const clockStartedAt = Date.now();
    const { current, daily, hourly, place } = data;
    const preferences = getPreferences();
    const windSpeed = preferences.wind === 'mph'
      ? Math.round(current.wind_speed_10m * 0.621371)
      : Math.round(current.wind_speed_10m);
    const location = locationLabel(place);
    const metrics = [
      ['Feels like', temperature(current.apparent_temperature, preferences.temperature), `°${preferences.temperature}`],
      ['Humidity', current.relative_humidity_2m, '%'],
      ['Wind', windSpeed, preferences.wind],
      ['Precipitation', current.precipitation, 'mm']
    ];
    const upcomingHours = hourly.time_epoch
      .map((epoch, index) => ({ epoch, index }))
      .filter(({ epoch }) => epoch >= Math.floor(Date.now() / 1000))
      .slice(0, 8);

    panel.innerHTML = `
      <div class="weather-overview">
        <div class="location-details">
          <p class="section-label">CURRENT CONDITIONS</p>
          <h2 class="place">${escapeHtml(location)}</h2>
          <div class="location-clock" aria-label="Current local time">
            <time id="location-local-time"></time>
            <span id="location-local-date"></span>
            <small>${escapeHtml(place.timezone || 'Location time from forecast')}</small>
          </div>
          <p class="condition">${escapeHtml(current.condition_text)}</p>
          <p class="updated">Updated ${escapeHtml(current.time || place.localtime || '')}</p>
        </div>
        <div class="temperature-reading">
          <span class="temperature">${temperature(current.temperature_2m, preferences.temperature)}°</span>
          <span class="temperature-unit">${preferences.temperature}</span>
        </div>
      </div>
      <div class="metrics">
        ${metrics
          .map(
            ([label, value, unit]) => `
              <div class="metric">
                <span class="metric-label">${label}</span>
                <strong>${escapeHtml(value)}<span>${escapeHtml(unit)}</span></strong>
              </div>
            `
          )
          .join('')}
      </div>
      <div class="forecast-heading">
        <div>
          <p class="section-label">COMING UP</p>
          <h2>Hourly forecast</h2>
        </div>
        <p>Next several hours</p>
      </div>
      <div class="hourly-forecast" aria-label="Hourly forecast">
        ${upcomingHours.length
          ? upcomingHours
              .map(({ index }) => `
                <div class="hour">
                  <span>${escapeHtml(hourly.time[index].slice(-5))}</span>
                  <strong>${temperature(hourly.temperature_2m[index], preferences.temperature)}°</strong>
                  <span>${escapeHtml(hourly.condition_text[index])}</span>
                  <small>${hourly.precipitation_probability[index]}% rain</small>
                </div>
              `)
              .join('')
          : '<p>Hourly details are not available right now.</p>'}
      </div>
      <div class="forecast-heading">
        <div>
          <p class="section-label">NEXT 3 DAYS</p>
          <h2>3-day forecast</h2>
        </div>
        <p>Highs and lows</p>
      </div>
      <div class="forecast">
        ${daily.time.slice(0, 3)
          .map(
            (date, index) => `
              <div class="day">
                <span class="day-name">${new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                  weekday: 'short'
                })}</span>
                <span class="day-condition">${escapeHtml(daily.condition_text[index])}</span>
                <span class="day-temperatures">
                  <strong>${temperature(daily.temperature_2m_max[index], preferences.temperature)}°</strong>
                  <span>${temperature(daily.temperature_2m_min[index], preferences.temperature)}°</span>
                </span>
                <small class="rain-chance">${daily.precipitation_probability[index]}% rain</small>
              </div>
            `
          )
          .join('')}
      </div>
      <div class="sun-times">
        <span>Sunrise <strong>${escapeHtml(daily.sunrise[0])}</strong></span>
        <span>Sunset <strong>${escapeHtml(daily.sunset[0])}</strong></span>
        <button id="save-location" type="button" ${authStateReady ? '' : 'disabled'}>
          ${currentUser ? 'Save this location' : 'Log in to save this location'}
        </button>
      </div>
      <p class="weather-attribution">
        Weather data by
        <a href="https://www.weatherapi.com/" target="_blank" rel="noopener noreferrer">WeatherAPI.com</a>
      </p>
    `;

    $('#save-location').addEventListener('click', saveLocation);
    if (updateLocationClock(place.timezone, place.localtime, clockStartedAt)) {
      locationClockInterval = setInterval(
        () => updateLocationClock(place.timezone, place.localtime, clockStartedAt),
        1000
      );
    }
  } catch (error) {
    if (requestId !== weatherRequestId) return;
    panel.innerHTML = '<p>We could not load this forecast. Check the city name or try again shortly.</p>';
    $('#message').textContent = error.message;
  }
}

async function refreshUser() {
  const data = await api('/api/auth/me');
  currentUser = data.user;
  authStateReady = true;

  $('#login-link').hidden = Boolean(currentUser);
  $('#signup-link').hidden = Boolean(currentUser);
  $('#account-link').hidden = !currentUser;
  $('#admin-link').hidden = !data.isAdmin;
  $('#settings-link').hidden = !currentUser;
  $('#signout-button').hidden = !currentUser;
  $('#signout-button').disabled = !currentUser;

  const saveButton = $('#save-location');
  if (saveButton) {
    saveButton.textContent = currentUser ? 'Save this location' : 'Log in to save this location';
    saveButton.disabled = !authStateReady;
  }

  if (currentUser) {
    await loadLocations();
  } else {
    $('#saved-list').textContent = 'Sign in to manage saved places.';
  }
}

async function saveLocation() {
  if (!currentUser) {
    window.location.href = './login.html';
    return;
  }

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
                <button class="saved-city" data-city="${escapeHtml(item.city)}" type="button">${escapeHtml(item.city)}</button>
                <button class="remove" data-id="${item.id}" aria-label="Remove ${escapeHtml(item.city)}" type="button">×</button>
              </div>
            `
          )
          .join('')
      : '<p>No saved places yet.</p>';

    $('#saved-list').querySelectorAll('[data-city]').forEach((button) => {
      button.addEventListener('click', () => {
        $('#city').value = button.dataset.city;
        loadWeather(button.dataset.city);
      });
    });

    $('#saved-list').querySelectorAll('.remove').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await api(`/api/locations/${button.dataset.id}`, { method: 'DELETE' });
          await loadLocations();
        } catch (error) {
          $('#message').textContent = error.message;
        }
      });
    });
  } catch (error) {
    $('#saved-list').textContent = error.message;
  }
}

$('#featured-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-city]');
  if (!button) return;
  $('#city').value = button.dataset.city;
  loadWeather(button.dataset.city);
});

$('#featured-more').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (button.disabled) return;

  if (featuredLocationsExhausted) {
    $('#city').focus();
    return;
  }

  if (nextFeaturedOffset === null) return;

  if (useFeaturedSearchFallback) {
    const offset = nextFeaturedOffset;
    button.disabled = true;
    button.textContent = 'Loading…';
    await loadAdditionalFeaturedBySearch(offset);
    button.disabled = false;
    if (!featuredLocationsExhausted) button.textContent = 'View more locations';
    return;
  }

  const offset = nextFeaturedOffset;
  button.disabled = true;
  button.textContent = 'Loading…';
  await loadFeaturedWeather(offset, true);
  button.disabled = false;
  if (!featuredLocationsExhausted) button.textContent = 'View more locations';
});

$('#search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  loadWeather($('#city').value.trim());
});

$('#signout-button').addEventListener('click', async () => {
  const button = $('#signout-button');
  button.disabled = true;

  try {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = './login.html';
  } catch (error) {
    $('#message').textContent = error.message;
    button.disabled = false;
  }
});

(async () => {
  loadFeaturedWeather();

  try {
    await loadCsrf();
    await refreshUser();
  } catch (error) {
    $('#message').textContent = error.message;
  }
})();
