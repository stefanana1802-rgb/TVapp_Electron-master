/**
 * Open-Meteo weather API – no API key, CORS allowed.
 * Location: Aumovio Strada Salzburg, Sibiu (coordinates for Sibiu).
 */

const SIBIU_LAT = 45.7983;
const SIBIU_LON = 24.1256;
const WEATHER_URL = `https://api.open-meteo.com/v1/forecast?latitude=${SIBIU_LAT}&longitude=${SIBIU_LON}&current=temperature_2m,relative_humidity_2m,weather_code,apparent_temperature,wind_speed_10m,uv_index&hourly=temperature_2m,weather_code&timezone=Europe/Bucharest&forecast_days=2`;

const WMO_CODES = {
  0: { text: 'Clear', icon: '☀' },
  1: { text: 'Mainly clear', icon: '☀' },
  2: { text: 'Partly cloudy', icon: '⛅' },
  3: { text: 'Overcast', icon: '☁' },
  45: { text: 'Foggy', icon: '🌫' },
  48: { text: 'Fog', icon: '🌫' },
  51: { text: 'Light drizzle', icon: '🌧' },
  53: { text: 'Drizzle', icon: '🌧' },
  55: { text: 'Dense drizzle', icon: '🌧' },
  61: { text: 'Light rain', icon: '🌧' },
  63: { text: 'Rain', icon: '🌧' },
  65: { text: 'Heavy rain', icon: '🌧' },
  71: { text: 'Light snow', icon: '❄' },
  73: { text: 'Snow', icon: '❄' },
  75: { text: 'Heavy snow', icon: '❄' },
  77: { text: 'Snow grains', icon: '❄' },
  80: { text: 'Light showers', icon: '🌦' },
  81: { text: 'Showers', icon: '🌦' },
  82: { text: 'Heavy showers', icon: '🌦' },
  85: { text: 'Snow showers', icon: '🌨' },
  86: { text: 'Heavy snow showers', icon: '🌨' },
  95: { text: 'Thunderstorm', icon: '⛈' },
  96: { text: 'Thunderstorm with hail', icon: '⛈' }
};

function getWeatherInfo(code) {
  return WMO_CODES[code] || WMO_CODES[Math.floor(code / 10) * 10] || { text: 'Unknown', icon: '☁' };
}

function uvLabel(index) {
  if (index == null) return '—';
  if (index <= 2) return 'Low';
  if (index <= 5) return 'Moderate';
  if (index <= 7) return 'High';
  if (index <= 10) return 'Very high';
  return 'Extreme';
}

export async function fetchWeather() {
  const res = await fetch(WEATHER_URL);
  if (!res.ok) throw new Error(`Weather API ${res.status}`);
  const data = await res.json();
  const cur = data.current;
  const hourly = data.hourly;
  const now = new Date();
  const currentHour = now.getHours();

  const currentInfo = getWeatherInfo(cur.weather_code);
  const temp = cur.temperature_2m;
  const feelsLike = cur.apparent_temperature;
  const humidity = cur.relative_humidity_2m;
  const wind = cur.wind_speed_10m;
  const uv = cur.uv_index;

  const next4Hours = [];
  for (let i = 1; i <= 4; i++) {
    const idx = currentHour + i; // 0–23 today, 24–47 tomorrow (forecast_days=2)
    const isoTime = hourly.time?.[idx]; // e.g. "2025-02-09T14:00"
    const timeLabel = isoTime
      ? new Date(isoTime).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', hour12: false })
      : `+${i}h`;
    const t = hourly.temperature_2m?.[idx];
    const code = hourly.weather_code?.[idx];
    const info = code != null ? getWeatherInfo(code) : { text: '—', icon: '☁' };
    next4Hours.push({
      time: timeLabel,
      temp: t != null ? `${Math.round(t)}°` : '—',
      icon: info.icon,
      cond: info.text
    });
  }

  return {
    location: 'Aumovio Sibiu - Strada Salzburg',
    temperature: temp != null ? `${Math.round(temp)}°` : '—',
    condition: currentInfo.text,
    icon: currentInfo.icon,
    feelsLike: feelsLike != null ? `Feels like ${Math.round(feelsLike)}°` : '',
    humidity: humidity != null ? `${humidity}%` : '—',
    wind: wind != null ? `${Math.round(wind)} km/h` : '—',
    uvIndex: uv != null ? uvLabel(uv) : '—',
    uvValue: uv,
    next4Hours
  };
}
