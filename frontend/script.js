const API = "/api/current";
const MAPTILER_KEY = "IhXFbEsJkTsqUepcwuNn";

const DEFAULT_LAT = 42.6791;
const DEFAULT_LON = -70.8417;
const DEFAULT_ZOOM = 12;

const MARKER_RADIUS = 10;             // in miles
let markerElevation = NaN;

const AQ_VAR = "us_aqi";

const elevationCache = new Map();
window.elevationGrid = { type: "FeatureCollection", features: [] };


/* ------------------------Init --------------------------------------- */



/* ------------------------Utility Functions--------------------------- */

function cToF(c) { return (c * 9/5 + 32).toFixed(1); }

function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function cachedElevation(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;  // round → coarser cache
  if (elevationCache.has(key)) return elevationCache.get(key);
  const a = await fetchElevation(lat, lon);
  elevationCache.set(key, a);
  return a;
}

/* -----------------------Data Helper Functions------------------------ */

async function fetchElevation(lat, lon) {
  // Open‑Meteo Elevation endpoint: one coord → one value
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("elevation fetch failed");
  // returns like { "elevation": [ 33.0 ] }
  const json = await res.json();
  return json.elevation?.[0] ?? NaN;
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

async function fetchRainHistory(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast`
            + `?latitude=${lat}&longitude=${lon}`
            + `&daily=precipitation_sum`
            + `&past_days=30&forecast_days=0`
            + `&timezone=UTC`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("rain history failed");
  const j = await res.json();
  const daily = j.daily?.precipitation_sum ?? [];
  const total = daily.reduce((a, b) => a + b, 0);
  return { daily, total };        // mm for 30 days
}

async function fetchDailyTemps(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast` +
              `?latitude=${lat}&longitude=${lon}` +
              `&past_days=30&forecast_days=10` +
              `&daily=temperature_2m_max,temperature_2m_min` +
              `&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("temp history fetch failed");
  const j = await res.json();
  const { time, temperature_2m_max: tMax, temperature_2m_min: tMin } = j.daily;

  // simple mean ⇒ (max+min)/2
  const mean = tMax.map((v,i) => (v + tMin[i]) / 2);
  return { dates: time, mean };
}

async function fetchLastYearTemps(lat, lon){
    const today      = new Date();
    const startLast  = new Date(today);  startLast.setDate(startLast.getDate()-30);
    const endLast    = new Date(today);  endLast.setDate(endLast.getDate()+10);
    // shift a full year back
    startLast.setFullYear(startLast.getFullYear()-1);
    endLast  .setFullYear(endLast  .getFullYear()-1);
  
    const url = `https://archive-api.open-meteo.com/v1/archive` +
                `?latitude=${lat}&longitude=${lon}` +
                `&start_date=${startLast.toISOString().slice(0,10)}` +
                `&end_date=${endLast.toISOString().slice(0,10)}` +
                `&daily=temperature_2m_mean` +
                `&timezone=auto`;
    const r = await fetch(url);
    if(!r.ok) throw new Error("archive fetch failed");
    const j = await r.json();
    return j.daily.temperature_2m_mean;      // already an array
  }

async function fetchMeanTempsRange(lat, lon, isoStart, isoEnd){
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&start_date=${isoStart}&end_date=${isoEnd}` +
    `&daily=temperature_2m_max,temperature_2m_min` +
    `&timezone=auto`;

  const r = await fetch(url);
  if(!r.ok) throw new Error("history fetch failed");
  const j   = await r.json();
  const { time, temperature_2m_max: hi, temperature_2m_min: lo } = j.daily;
  return {
    dates : time,
    mean  : hi.map((v,i)=> (v+lo[i])/2)
  };
}

function compile(gl, vsSource, fsSource) {
  function sh(type, src) {
    const s = gl.createShader(type); 
    gl.shaderSource(s,src); 
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw gl.getShaderInfoLog(s);
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vsSource));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fsSource));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw gl.getProgramInfoLog(prog);
  return prog;
}

/* ------------------------Chart Functions---------------------------- */

let tempChart;

async function updateTempChart(lat, lon, currentTempC){
  /** current 30 d back + 10 d fwd */
  const nowRange = await fetchDailyTemps(lat, lon);      // unchanged

  /** same window, one year before */
  const today      = new Date();
  const startPast  = new Date(today);
  startPast.setDate( startPast.getDate() - 30 - 365 );
  const endPast    = new Date(today);
  endPast.setDate(  endPast.getDate() + 10 - 365 );

  const pad = d => d.toISOString().slice(0,10);          // → “YYYY-MM-DD”

  /* ---------- build / update the chart ---------- */
  const { dates, mean } = await fetchDailyTemps(lat, lon);
  const lastYear        = await fetchLastYearTemps(lat, lon);

  const todayIdx = dates.findIndex(d =>
        new Date(d).toDateString() === today.toDateString());

  if(!tempChart){
    const ctx = document.getElementById("tempChart").getContext("2d");
    tempChart = new Chart(ctx,{
      type:"line",
      data:{
        labels: dates,
        datasets:[
          {                                           // 2025 window
            label: "2025",
            data:  mean,
            borderWidth:2,
            tension:.25,
            pointRadius:0,
            borderColor:"rgb(0,123,255)"
          },
          {                                           // 2024 window
            label:"2024",
            data: lastYear,
            borderWidth:2,
            tension:.25,
            pointRadius:0,
            borderColor:"rgba(0,123,255,.35)",
            borderDash:[6,4],                         // dashed & lighter
            order: 0                                  // draw underneath
          },
          {                                           // Current temperature
            label:"Current",
            data: Array(mean.length).fill(null)
                    .map((_,i)=> i===todayIdx ? currentTempC : null),
            pointBorderColor:"red",
            pointBackgroundColor:"red",
            borderWidth:0,
            pointRadius:3,
            showLine:false
          }
        ]
      },
      options:{
        scales:{
          x:{ title:{display:true,text:"Date"}, ticks:{maxRotation:0,autoSkip:true}},
          y:{ title:{display:true,text:"°C"} }
        },
        plugins:{
          legend:{ position:"top" },
          tooltip:{ mode:"nearest", intersect:false }
        }
      }
    });
  }else{
    /* just update data */
    tempChart.data.labels            = dates;
    tempChart.data.datasets[0].data  = mean;        // current year line
    tempChart.data.datasets[1].data  = lastYear;    // ← NEW: last-year line
    tempChart.data.datasets[2].data  =              // red “today” dot
      Array(mean.length).fill(null).map((_, i) =>
          i === todayIdx ? currentTempC : null);

    tempChart.update();
  }
}

/* ------------------------Map Functions--------------------------------- */

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
  

  //----------Init Draggable marker
  const marker = new maplibregl.Marker({ draggable: true })
    .setLngLat([lon, lat])
    .addTo(map);

    /* first fill */
  handlePosition(lat, lon);


  //----------GLSL Layer

  const buildCircleLayer = debounce(async () => {

    if (!map.getLayer("mile-circle")) {
      if (!map.getLayer("mile-circle")) {
        map.addLayer({
          id: "mile-circle",
          type: "custom",
          renderingMode: "2d",
        
          onAdd: function (m, gl) {
            this.map = m;
            // ----- tiny passthrough shaders -----
            const vs = `#version 300 es
              layout(location=0) in vec2 a_pos;        // screen-px of marker
              uniform float u_ptSize;                  // diameter in px
              void main(){
                gl_PointSize = u_ptSize;
                gl_Position  = vec4(
                  2.0*a_pos.x/float(${gl.canvas.width}) - 1.0,
                  1.0 - 2.0*a_pos.y/float(${gl.canvas.height}),
                  0.0, 1.0);
              }`;
            const fs = `#version 300 es
              precision mediump float;
              out vec4 fragColor;
              void main(){
                // gl_PointCoord in [0,1]² – make radial alpha
                float d = length(gl_PointCoord - 0.5);
                if (d > 0.5 || d < 0.49) discard;                 
                fragColor = vec4(0.18, 0.6, 0.9, 0.75); // RGBA (25 % opaque)
              }`;
            // compile() is your helper from earlier
            this.prog   = compile(gl, vs, fs);
            this.uSize  = gl.getUniformLocation(this.prog, "u_ptSize");
            this.buf    = gl.createBuffer();
          },
        
          render: function () {
            const gl   = this.map.painter.context.gl;

            // marker’s CSS-px position
            const mPx  = this.map.project(marker.getLngLat());

            const dpr  = gl.canvas.width / gl.canvas.clientWidth; // ≈ window.devicePixelRatio
            const px   = mPx.x * dpr;
            const py   = mPx.y * dpr;
        
            // marker’s LngLat → screen px
            const data = new Float32Array([px, py]);
        
            // ----- compute 1-mile diameter in *pixels* -----
            const metersPerPixel =
              40075016.686 * Math.abs(Math.cos(this.map.getCenter().lat*Math.PI/180)) /
              (Math.pow(2, this.map.getZoom()+8));       // Mercator formula
            const radiusPx = 1609.34 / metersPerPixel;   // 1609 m ≈ 1 mile
            const diameter = MARKER_RADIUS * radiusPx;
        
            // ----- feed GPU & draw -----
            gl.useProgram(this.prog);
            gl.uniform1f(this.uSize, diameter);
        
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
        
            gl.enableVertexAttribArray(0);               // a_pos
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        
            gl.drawBuffers([gl.BACK]);                   // avoid MRT warning
            gl.drawArrays(gl.POINTS, 0, 1);              // a single splat
          }
        });
      }
    }
  }, 1500);
  
  const buildElevationLayer = debounce(async () => {
    const bounds = map.getBounds();
    const rows = 10, cols = 10;     // 100 samples → far fewer calls
    const feats = [];
  
    const dLat = (bounds.getNorth() - bounds.getSouth()) / rows;
    const dLon = (bounds.getEast() - bounds.getWest()) / cols;
  
    for (let r = 0; r < rows; r++) {
      const lat = bounds.getNorth() - (r + 0.5) * dLat;
      for (let c = 0; c < cols; c++) {
        const lon = bounds.getWest() + (c + 0.5) * dLon;
        feats.push(
          cachedElevation(lat, lon).then(elevation => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lon, lat] },
            properties: { elevation }
          }))
        );
      }
    }
  
    const geojson = { type: "FeatureCollection", features: await Promise.all(feats) };

    window.elevationGrid = geojson;    // make grid visible to render()

    if (!map.getLayer("elevation-custom")) {
      if (!map.getLayer("elevation-custom")) {
        map.addLayer({
          id: "elevation-custom",
          type: "custom",
          renderingMode: "2d",
      
          onAdd: function (map, gl) {
            this.map = map;                 // keep reference
            this.gl  = gl;
            this.program = null;
            this.buffer  = gl.createBuffer();
          },
      
          render: function (gl) {
            const vSrc = `#version 300 es
                          layout(location = 0) in vec2  a_pos;          // pixel coords   (x,y)
                          layout(location = 1) in float a_elevation;    // elevation    
                          uniform vec2 u_viewSize;                      // canvas [w,h]    – set from JS
                          out float v_elevation;
                          void main() {
                            v_elevation = 1000.0/a_elevation;
                            gl_PointSize = v_elevation/100.0;                 // splat radius in px
                            gl_Position  = vec4(
                                2.0 * a_pos.x / u_viewSize.x - 1.0,
                                1.0 - 2.0 * a_pos.y / u_viewSize.y,
                                0.0, 1.0);
                          }`;
            const fSrc = `#version 300 es
                          precision mediump float;
                          in  float v_elevation;
                          out vec4  fragColor;
                          void main(){
                            float d = length(gl_PointCoord - 0.5);      // circular fade
                            if (d > 0.5) discard;
                            float w = 1.0 - smoothstep(0.0, 0.5, d);    // soft edge
                            float g = clamp(v_elevation * 0.5, 0.0, 1.0);  // greyscale value
                            fragColor = vec4(g, g, g, w);                  // r,g,b,a    ← 4 comps
                          }`;
            this.program  = compile(gl, vSrc, fSrc);
            this.uSizeLoc = gl.getUniformLocation(this.program,"u_viewSize");
      
            /* --- pack fresh data into buffer --- */
            const pts = window.elevationGrid.features.flatMap(f => {
              const [lng,lat] = f.geometry.coordinates;
              const p = this.map.project([lng,lat]);       // to pixel space
              return [p.x, p.y, f.properties.elevation];
            });
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);
      
            gl.useProgram(this.program);
            gl.uniform2f(this.uSizeLoc, gl.canvas.width, gl.canvas.height);

            gl.enableVertexAttribArray(0);                // a_pos
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);

            gl.enableVertexAttribArray(1);                // a_rel
            gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);

            gl.drawBuffers([gl.BACK]);                    // avoid MRT warning
            gl.drawArrays(gl.POINTS, 0, pts.length / 3);  // 3 floats per vertex
          }
        });
      } else {
        map.triggerRepaint();          // update existing layer
      }
    }
  }, 1500);


  //----------Map Events
  map.on("click", e => {
    marker.setLngLat(e.lngLat);
    const z = map.getZoom();   
    map.flyTo({ center: e.lngLat, zoom: z, essential: true, duration: 800 });
    handlePosition(e.lngLat.lat, e.lngLat.lng);
  });

  //map.on("load", buildElevationLayer);      // first paint
  //map.on("moveend", buildElevationLayer);   // repaint when user pans / zooms

  map.on("load", buildCircleLayer);      // first paint
  map.on("moveend", buildCircleLayer);   // repaint when user pans / zooms

  //-----------Marker Events
  marker.on("dragend", () => {
    const pos = marker.getLngLat();
    handlePosition(pos.lat, pos.lng);
  });


}

/* ------------------------Update Functions---------------------------- */

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
    
    return d;
  } catch (err) {
    console.error("Weather fetch failed:", err);
  }
}

// updates all data in the card
async function handlePosition(lat, lon) {
  const coordBox = document.getElementById("coordinates");

  coordBox.style.display = "block";
  coordBox.innerHTML =
    `Longitude: ${lon.toFixed(5)}<br>Latitude: ${lat.toFixed(5)}`;

  const weather = await refreshWeather(lat, lon);   // 👈 grab the data
  if (weather) updateTempChart(lat, lon, weather.temperature_c);

  document.getElementById("elev").textContent = "Elevation — m";
  document.getElementById("aqi").textContent  = "PM₂․₅ — µg/m³";

  Promise.allSettled([
    fetchElevation(lat, lon),
    fetchAirQuality(lat, lon),
    fetchRainHistory(lat, lon)
  ]).then(([elevRes, aqiRes, rainRes]) => {
    if (elevRes.status === "fulfilled" && !isNaN(elevRes.value)) {
      markerElevation = elevRes.value;
      document.getElementById("elev").textContent =
        `Elevation ${markerElevation.toFixed(0)} m`;
    }
    if (aqiRes.status === "fulfilled" && !isNaN(aqiRes.value)) {
      const aqiVal = aqiRes.value;
      const aqiEl  = document.getElementById("aqi");
      document.getElementById("aqi").textContent =
        `PM₂․₅ ${aqiVal.toFixed(1)} µg/m³`;
      aqiEl.textContent = `U.S. AQI ${aqiVal}`;
      aqiEl.style.color =
        aqiVal <= 50  ? "#2ecc71" :
        aqiVal <=100  ? "#f1c40f" :
        aqiVal <=150  ? "#e67e22" :
                          "#e74c3c";
    }  
    if (rainRes.status === "fulfilled")
      document.getElementById("rain30").textContent =
        `Rain 30 d ${rainRes.value.total.toFixed(0)} mm`;
  });
}

/* -----------------------Event Listeners------------------------ */

document.addEventListener("DOMContentLoaded", () => {
  initMap(DEFAULT_LAT, DEFAULT_LON);

  /* Top-right panel toggle … */
  const card   = document.getElementById("card");
  const toggle = document.getElementById("card-toggle");
  toggle.addEventListener("click", () => {
    const collapsed = card.classList.toggle("collapsed");
    toggle.classList.toggle("rotated", collapsed);
    toggle.setAttribute("aria-expanded", !collapsed);
    toggle.title = collapsed ? "Show details" : "Hide details";
  });

  /* ─── Bottom sheet toggle ─── */
  const sheet      = document.getElementById("bottom-card");
  const sheetBtn   = document.getElementById("bottom-toggle");

  sheetBtn.addEventListener("click", () => {
    const open = sheet.classList.toggle("open");
    sheetBtn.classList.toggle("open", open);
    sheetBtn.setAttribute("aria-expanded", open);
    sheetBtn.title = open ? "Hide panel" : "Show more";
  });
});