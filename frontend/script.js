const API = "/api/current";
const MAPTILER_KEY = "IhXFbEsJkTsqUepcwuNn";
const DEFAULT_LAT = 42.6791;
const DEFAULT_LON = -70.8417;
const DEFAULT_ZOOM = 10;

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

/* helper: update weather + coordinate read‑out */
function handlePosition(lat, lon) {
  const coordBox = document.getElementById("coordinates");
  coordBox.style.display = "block";
  coordBox.innerHTML =
    `Longitude: ${lon.toFixed(5)}<br>Latitude: ${lat.toFixed(5)}`;

  refreshWeather(lat, lon);           // ALWAYS pass coords
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