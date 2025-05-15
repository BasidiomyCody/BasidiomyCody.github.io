from flask import Flask, jsonify, request
import openmeteo_requests
import requests_cache
from retry_requests import retry

DEFAULT_LAT = 42.68405
DEFAULT_LNG = -70.89926

LAT = DEFAULT_LAT
LNG = DEFAULT_LNG

# ---------- timezone for Open-Meteo API ----------

TIMEZONE = "America/New_York"

# ---------- open-meteo client with cache ----------
cache_session = requests_cache.CachedSession(
    ".cache", expire_after=3600  # local SQLite cache directory  # seconds (1 h)
)
retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
openmeteo = openmeteo_requests.Client(session=retry_session)

app = Flask(__name__, static_folder="../frontend", static_url_path="")


def fetch_current_weather(lat: float, lng: float) -> dict:
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lng,
        "current": "temperature_2m,wind_speed_10m,weather_code",
        "timezone": "auto",
        "forecast_days": 1,
    }
    resp = openmeteo.weather_api(url, params=params)[0]
    cur = resp.Current()
    return {
        "time": cur.Time(),
        "temperature_c": cur.Variables(0).Value(),
        "wind_speed_kmh": cur.Variables(1).Value(),
        "weather_code": cur.Variables(2).Value(),
    }


def parse_coord(value: str | None, minimum: float, maximum: float) -> float:
    if value is None:
        raise ValueError("missing")
    try:
        coord = float(value)
    except ValueError as err:
        # Preserve original context
        raise ValueError("not a number") from err
    if not minimum <= coord <= maximum:
        raise ValueError("out of range")
    return coord


# ---------- Flask route ----------
@app.route("/")
def index():
    return app.send_static_file("index.html")

@app.route("/map")
def mycomap():
    return app.send_static_file("map.html")


@app.route("/map/api")
def current_weather():
    # 1) extract params if present
    lat_q = request.args.get("lat")
    lng_q = request.args.get("lng")

    # 2) try to parse, else fallback to default
    try:
        lat = parse_coord(lat_q, -90.0, 90.0) if lat_q else DEFAULT_LAT
        lng = parse_coord(lng_q, -180.0, 180.0) if lng_q else DEFAULT_LNG
    except ValueError as err:
        # bad request → 400 JSON
        return jsonify({"error": f"Invalid coordinate: {err}"}), 400

    # 3) fetch from Open-Meteo
    try:
        data = fetch_current_weather(lat, lng)
        return jsonify(data)
    except Exception as exc:
        # upstream error → 502 Bad Gateway
        return jsonify({"error": str(exc)}), 502


if __name__ == "__main__":
    app.run(debug=True, port=5000)
