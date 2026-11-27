// The skies Reverie's windows can be asked to show (daylight.js), with no engine in here, so the server's tool list
// (server/persona.js) can read them too. Each time is the sun's height in degrees and whether it is morning.
export const TIMES = { dawn: [-2, true], sunrise: [2, true], morning: [18, true], noon: [45, true], afternoon: [24, false], 'golden hour': [7, false], sunset: [1, false], dusk: [-3, false], evening: [-7, false], night: [-20, false], midnight: [-30, false] };
export const TIME_NAMES = ['live', ...Object.keys(TIMES)];
export const WEATHER_NAMES = ['live', 'clear', 'cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'storm', 'snow'];
