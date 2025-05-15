from flask import Flask, jsonify, request
import openmeteo_requests
import requests_cache
from retry_requests import retry


# ---------- timezone for Open-Meteo API ----------

TIMEZONE = "America/New_York"

# ---------- open-meteo client with cache ----------
cache_session = requests_cache.CachedSession(
    ".cache", expire_after=3600  # local SQLite cache directory  # seconds (1 h)
)
retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
openmeteo = openmeteo_requests.Client(session=retry_session)

app = Flask(__name__, static_folder="../frontend", static_url_path="")


# ---------- Flask route ----------
@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/map")
def mycomap():
    return app.send_static_file("map.html")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
