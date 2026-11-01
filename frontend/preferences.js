const STORAGE_KEY = 'shaunek-weather-preferences';
const defaults = { theme: 'dark', temperature: 'C', wind: 'km/h' };

export function getPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      theme: saved.theme === 'light' ? 'light' : defaults.theme,
      temperature: saved.temperature === 'F' ? 'F' : defaults.temperature,
      wind: saved.wind === 'mph' ? 'mph' : defaults.wind
    };
  } catch {
    return { ...defaults };
  }
}

export function savePreferences(updates) {
  const preferences = { ...getPreferences(), ...updates };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  document.documentElement.dataset.theme = preferences.theme;
  return preferences;
}

export function applySavedTheme() {
  document.documentElement.dataset.theme = getPreferences().theme;
}
