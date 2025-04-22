window.addEventListener("DOMContentLoaded", async () => {
    const box = document.getElementById("weather-box");
    try {
      const res = await fetch("/api/current");
      const data = await res.json();
      box.textContent = `${data.temperature_2m} °C — wind ${data.wind_speed_10m} km/h`;
    } catch (err) {
      box.textContent = "Error fetching weather.";
      console.error(err);
    }
  });
  