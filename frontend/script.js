const API = "/api/current";
const MAPTILER_KEY = "IhXFbEsJkTsqUepcwuNn";
const startLonLat = [-70.8417, 42.6791];

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

async function renderCard() {
  const iconEl = document.getElementById("icon");
  const tempEl = document.getElementById("temp");
  const windEl = document.getElementById("wind");
  const timeEl = document.getElementById("timestamp");

  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(res.statusText);
    const d = await res.json();

    // °C → °F helper
    const cToF = c => (c * 9/5 + 32).toFixed(1);

    tempEl.textContent = `${d.temperature_c.toFixed(1)} °C / ${cToF(d.temperature_c)} °F`;
    windEl.textContent = `Wind ${d.wind_speed_kmh.toFixed(1)} km/h`;
    timeEl.textContent = new Date(d.time).toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short"
    });

    const iconCode = iconMap[d.weather_code] || iconMap.default;
    iconEl.className = `pi ${iconCode} text-6xl`;
  } catch (err) {
    console.error(err);
    tempEl.textContent = "—";
    windEl.textContent = "Unable to load data.";
  }
}

async function initMap(lat, lon) {
  // Wait till MapLibre + MapTiler scripts are loaded
  await new Promise((r) => window.addEventListener("load", r));

  // ---- MapTiler style helper (topo) ----
  const map = new maplibregl.Map({
    container: "map",
    style: `https://api.maptiler.com/maps/topo-v2/style.json?key=${MAPTILER_KEY}`,
    center: [lon, lat],          // [lon, lat]
    zoom: 9,
  });

  // Disable rotation w/ RMB to keep UX simple
  map.dragRotate.disable();
  map.touchZoomRotate.disableRotation();

  // ---- Draggable marker ----
  const marker = new maplibregl.Marker({ draggable: true })
    .setLonLat(startingLonLat)
    .addTo(map);

  // Helper to load weather
  async function refreshWeather(lat, lon) {
    const res = await fetch(`${API}?lat=${lat}&lon=${lon}`)
    .then(r => r.json());
    const d = await res.json();
    document.getElementById("temp").textContent =
      `${d.temperature_c.toFixed(1)} °C`;
    // …update wind etc…

  }

  // Map click
  map.on("click", (e) => {
    marker.setLonLat(e.lonLat);
    refreshWeather(e.lonLat.lat, e.lonLat.lon);
  });

  // Marker drag-end
  marker.on("dragend", () => {
    const { lat, lon } = marker.getLonLat();
    refreshWeather(lat, lon);         // your function that re-fetches /api/current
    map.flyTo({ center: [lon, lat], essential: true });
  });

  // Smooth “fly” when user selects a new point elsewhere
  map.on("click", (e) => {
    marker.seLonLat(e.lonLat);
    refreshWeather(e.lonLat.lat, e.lonLat.lon);
  });
}


renderCard().then(() => initMap(42.6791, -70.8417));

window.addEventListener("DOMContentLoaded", renderCard);