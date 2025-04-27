const API = "http://127.0.0.1:5000/api/current";

// Map Open-Meteo weather_code → Phosphor icon classes
const iconMap = {
  // see https://open-meteo.com/en/docs
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

    // °C → °F helper (optional)
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

window.addEventListener("DOMContentLoaded", renderCard);