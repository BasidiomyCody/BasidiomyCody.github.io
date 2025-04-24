from flask import Flask
from flask import jsonify
import openmeteo_requests
import requests_cache
from retry_requests import retry

LAT, LON = 42.6791, -70.8417
TIMEZONE = "America/New_York"

# ---------- open-meteo client with cache ----------
cache_session = requests_cache.CachedSession(
    ".cache", expire_after=3600  # local SQLite cache directory  # seconds (1 h)
)
retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
openmeteo = openmeteo_requests.Client(session=retry_session)

app = Flask(__name__)


def fetch_current_weather(lat: float, lon: float):
    """Call Open-Meteo and return a dict of current weather values."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,wind_speed_10m",
        "timezone": TIMEZONE,
        "past_days": 0,
        "forecast_days": 1,
    }
    response = openmeteo.weather_api(url, params=params)[0]  # single location
    current = response.Current()

    return {
        "latitude": response.Latitude(),
        "longitude": response.Longitude(),
        "elevation_m": response.Elevation(),
        "time": current.Time(),  # ISO timestamp string
        "temperature_c": current.Variables(0).Value(),
        "wind_speed_kmh": current.Variables(1).Value(),
    }


# ---------- Flask route ----------
@app.route("/api/current")
def current_weather():
    try:
        data = fetch_current_weather(LAT, LON)
        return jsonify(data)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 502


if __name__ == "__main__":
    app.run(debug=True, port=5000)
