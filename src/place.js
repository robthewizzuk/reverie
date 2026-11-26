// Where and when you are, and the weather there. All from the browser: the device's location (it asks first), a
// place name for it, and the forecast from Open-Meteo (free, no key). Nothing here goes through Reverie's backend:
// Claude only hears the town and the local time, in a line at the top of what you say.

const TIMEOUT = 8000;
let here = null;          // { lat, lon, name, country, countryCode } once known
let asked = null;

const fetchJson = async (url, ms = TIMEOUT) => {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(`${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
};

/** Asks for the device's location (the browser's prompt) and finds the town's name. Resolves to the place or null. */
export function askPlace() {
  if (asked) return asked;
  asked = (async () => {
    if (!navigator.geolocation) return null;
    const pos = await new Promise(res => navigator.geolocation.getCurrentPosition(res, () => res(null), { timeout: 15000, maximumAge: 30 * 60e3, enableHighAccuracy: false }));
    if (!pos) return null;
    const lat = +pos.coords.latitude.toFixed(3), lon = +pos.coords.longitude.toFixed(3);   // (about 100 m: plenty for a town and its weather)
    here = { lat, lon, name: null, country: null, countryCode: null };
    try {
      const g = await fetchJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
      here.name = g.city || g.locality || g.principalSubdivision || null;
      here.region = g.principalSubdivision || null; here.country = g.countryName || null; here.countryCode = g.countryCode || null;
    } catch { /* no name: the weather still works from the numbers */ }
    return here;
  })();
  return asked;
}

/** The line Claude reads at the top of each thing you say: where you are (if known) and your local date and time. */
export function contextLine(now = new Date()) {
  const when = now.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const where = here?.name ? `they are in ${[here.name, here.region !== here.name ? here.region : null, here.country].filter(Boolean).join(', ')}` : here ? 'they shared their location, but the town is unknown' : 'they have not shared their location';
  return `[From the device, not said aloud: ${where}; it is ${when} where they are.]`;
}

// WMO weather codes (Open-Meteo) in plain words
const SKY = { 0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'freezing drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'light showers', 81: 'showers', 82: 'heavy showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail' };
const sky = c => SKY[c] ?? 'mixed weather';

/** The weather now and for the next few days, as sentences for Claude. place: a town's name, or empty for here. */
export async function weather(place) {
  let at = null;
  place = String(place || '').trim().slice(0, 80);
  if (place) {
    const g = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`).catch(() => null);
    const r = g?.results?.[0];
    if (!r) return `Could not find a place called "${place}".`;
    at = { lat: r.latitude, lon: r.longitude, name: [r.name, r.admin1, r.country].filter(Boolean).join(', '), countryCode: r.country_code };
  } else {
    const h = here || await askPlace();
    if (!h) return 'Their location is not shared, so ask which town they mean (they can also allow location in the browser).';
    at = { lat: h.lat, lon: h.lon, name: h.name ? [h.name, h.country].filter(Boolean).join(', ') : 'where they are', countryCode: h.countryCode };
  }
  const f = at.countryCode === 'US' ? { t: 'fahrenheit', w: 'mph', tu: '°F', wu: 'mph' } : { t: 'celsius', w: 'kmh', tu: '°C', wu: 'km/h' };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${at.lat}&longitude=${at.lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day`
    + `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=4&temperature_unit=${f.t}&wind_speed_unit=${f.w}`;
  const w = await fetchJson(url).catch(e => ({ error: e?.message || 'failed' }));
  if (w.error || !w.current || !w.daily) return `The weather service did not answer (${w.error || 'no data'}).`;
  const c = w.current, d = w.daily, r = x => Math.round(x);
  const days = d.time.map((day, i) => {
    const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(day + 'T12:00').toLocaleDateString('en-GB', { weekday: 'long' });
    return `${name}: ${sky(d.weather_code[i])}, ${r(d.temperature_2m_min[i])} to ${r(d.temperature_2m_max[i])}${f.tu}, ${d.precipitation_probability_max[i] ?? 0}% chance of rain.`;
  });
  const time = s => s?.slice(11, 16);
  return `Weather in ${at.name}. Now: ${r(c.temperature_2m)}${f.tu} (feels like ${r(c.apparent_temperature)}${f.tu}), ${sky(c.weather_code)}, wind ${r(c.wind_speed_10m)} ${f.wu}${c.is_day ? '' : ', dark out'}. `
    + days.join(' ') + ` Sunrise ${time(d.sunrise[0])}, sunset ${time(d.sunset[0])}.`;
}
