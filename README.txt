# Mycolibrium

Tiny proof-of-concept web app that shows **current weather for Ipswich, MA** using the free **Open-Meteo** API.

---

## Stack (as of v0.1.0)

* **Python 3.11** + **Flask 2.3**
* **openmeteo-requests** with requests-cache & retry-requests
* **Vanilla HTML/CSS/JS** (no framework yet)

---

## Quick start (dev)

```bash
git clone https://github.com/BasidiomyCody/Mycolibrium.git
cd Mycolibrium

# Python deps
python -m venv .venv
source .venv/bin/activate          # Windows: .\.venv\Scripts\activate
pip install -r requirements.txt

# run Flask API on :5000
python backend/app.py
In a second terminal:

bash
Copy
Edit
# serve static page (port 5500 with VS Code Live Server, or:)
cd frontend
npx serve .
Open http://localhost:5000/api/current → JSON

Open the static page (served port) → weather replaces “Loading…”

Endpoints

Route	Purpose
GET /api/current	JSON with temperature °C & wind km/h
index.html (static)	Simple UI consuming the endpoint
