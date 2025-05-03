const API = "/api/current";
const MAPTILER_KEY = "IhXFbEsJkTsqUepcwuNn";

const DEFAULT_LAT = 42.6791;
const DEFAULT_LON = -70.8417;
const DEFAULT_ZOOM = 10;

const AQ_VAR = "pm2_5";

// Map Open-Meteo weather_code → Phosphor icon classes
const iconMap = {
  0: "pi-sun",
  1: "pi-cloud-sun",
  2: "pi-cloud",
  3: "pi-cloud",
  45: "pi-cloud-fog",
  48: "pi-cloud-fog",
  51: "pi-cloud-rain",
  61: "pi-cloud-rain",
  71: "pi-cloud-snow",
  95: "pi-cloud-lightning",
  // fallback
  default: "pi-question"
};

function cToF(c) { return (c * 9/5 + 32).toFixed(1); }

async function renderCard() {
  const iconEl = document.getElementById("icon");
  const tempEl = document.getElementById("temp");
  const windEl = document.getElementById("wind");
  const timeEl = document.getElementById("timestamp");

  try {
    const res = await fetch(`${API}?lat=${lat}&lon=${lon}`);
    if (!res.ok) throw new Error(res.statusText);
    const d = await res.json();

    tempEl.textContent =
      `${d.temperature_c.toFixed(1)} °C / ${cToF(d.temperature_c)} °F`;
    windEl.textContent = `Wind ${d.wind_speed_kmh.toFixed(1)} km/h`;
    timeEl.textContent = new Date(d.time).toLocaleString(undefined, {
      hour: "2-digit", minute: "2-digit", weekday: "short"
    });

    iconEl.className = `pi ${iconMap[d.weather_code] ?? iconMap.default} text-6xl`;
  } catch (err) {
    console.error(err);
    tempEl.textContent = "—";
    windEl.textContent = "Unable to load data.";
  }
}

async function fetchElevation(lat, lon) {
  // Open‑Meteo Elevation endpoint: one coord → one value
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("elevation fetch failed");
  // returns like { "elevation": [ 33.0 ] }
  const json = await res.json();
  return json.elevation?.[0] ?? NaN;
}


async function refreshWeather(lat, lon) {
  // guard clause: if lat or lon are undefined, bail early
  if (lat === undefined || lon === undefined) {
    console.warn("refreshWeather called without coordinates");
    return;
  }
  try {
    const res = await fetch(`${API}?lat=${lat}&lon=${lon}`);
    if (!res.ok) throw new Error(res.statusText);
    const d = await res.json();

    document.getElementById("temp").textContent =
      `${d.temperature_c.toFixed(1)} °C`;
    document.getElementById("wind").textContent =
      `Wind ${d.wind_speed_kmh.toFixed(1)} km/h`;
    document.getElementById("timestamp").textContent =
      new Date(d.time).toLocaleTimeString();
  } catch (err) {
    console.error("Weather fetch failed:", err);
  }
}

async function fetchAirQuality(lat, lon) {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality` +
              `?latitude=${lat}&longitude=${lon}` +
              `&hourly=${AQ_VAR}` +
              `&timezone=UTC&forecast_hours=1&past_hours=1`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("air‑quality fetch failed");
  const j = await res.json();
  // The API returns an array for each hour; pick the last item (current hour)
  const values = j.hourly?.[AQ_VAR];
  return values ? values.at(-1) : NaN;
}

// updates all data in the card
async function handlePosition(lat, lon) {
  const coordBox = document.getElementById("coordinates");

  coordBox.style.display = "block";
  coordBox.innerHTML =
    `Longitude: ${lon.toFixed(5)}<br>Latitude: ${lat.toFixed(5)}`;

  refreshWeather(lat, lon);           // ALWAYS pass coords

  document.getElementById("elev").textContent = "Elevation — m";
  document.getElementById("aqi").textContent  = "PM₂․₅ — µg/m³";

  Promise.allSettled([
    fetchElevation(lat, lon),          // returns Number or NaN
    fetchAirQuality(lat, lon)          // returns Number or NaN
  ]).then(([elevRes, airRes]) => {
    if (elevRes.status === "fulfilled" && !isNaN(elevRes.value))
      document.getElementById("elev").textContent =
        `Elevation ${elevRes.value.toFixed(0)} m`;

    if (airRes.status === "fulfilled" && !isNaN(airRes.value))
      document.getElementById("aqi").textContent =
        `PM₂․₅ ${airRes.value.toFixed(1)} µg/m³`;
  });
}

async function initMap(lat, lon) {
  // Wait till MapLibre + MapTiler scripts are loaded
  await new Promise((r) => window.addEventListener("load", r));


  /* MapLibre instance */
  const map = new maplibregl.Map({
    container: "map",
    style: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`,
    center: [lon, lat],   // [lng, lat]
    zoom: DEFAULT_ZOOM,
  });

  // Disable rotation w/ RMB to keep UX simple
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();
  

  /* Draggable marker */
  const marker = new maplibregl.Marker({ draggable: true })
    .setLngLat([lon, lat])
    .addTo(map);

    /* first fill */
  handlePosition(lat, lon);

  /* click moves pin */
  map.on("click", e => {
    marker.setLngLat(e.lngLat);
    const z = map.getZoom();   
    map.flyTo({ center: e.lngLat, zoom: z, essential: true, duration: 800 });
    handlePosition(e.lngLat.lat, e.lngLat.lng);
  });

  /* drag‑end */
  marker.on("dragend", () => {
    const pos = marker.getLngLat();
    handlePosition(pos.lat, pos.lng);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initMap(DEFAULT_LAT, DEFAULT_LON);
});