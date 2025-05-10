/* ------------------------Init --------------------------------------- */

const API = "/api/current";
const MAPTILER_KEY = "IhXFbEsJkTsqUepcwuNn";

const DEFAULT_LAT = 42.6791;
const DEFAULT_LON = -70.8417;
const DEFAULT_ZOOM = 12;

const roundKey   = (lat,lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`;       //  ~10 km grid
const today      = new Date();
const DAYS_BACK  = -20, DAYS_FWD = 10;
const CURRENT_YEAR   = today.getFullYear();
const MAX_YEAR_BACK = 1979;
const YEARS_AVAILABLE = CURRENT_YEAR - MAX_YEAR_BACK; 

const tempCache  = new Map();
let selectedYears = 5;
let activeKey    = null; 

const MARKER_RADIUS = 10;                                                    // in miles

const AQ_VAR = "us_aqi";

/* ------------------------Utility Functions--------------------------- */

function cToF(c) { return (c * 9/5 + 32).toFixed(1); }

function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function cachedElevation(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;                         // round → coarser cache
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
              `&past_days=20&forecast_days=10` +
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

  async function fetchWindowForYear(lat, lon, refDate, daysBack, daysFwd, year){
    const d0 = new Date(refDate);           d0.setDate(d0.getDate()+daysBack);
    const d1 = new Date(refDate);           d1.setDate(d1.getDate()+daysFwd);
  
    d0.setFullYear(year);                   // shift into <year>
    d1.setFullYear(year);
  
    const url = `https://archive-api.open-meteo.com/v1/archive` +
                `?latitude=${lat}&longitude=${lon}` +
                `&start_date=${d0.toISOString().slice(0,10)}` +
                `&end_date=${d1.toISOString().slice(0,10)}` +
                `&daily=temperature_2m_mean` +
                `&timezone=auto`;
  
    const r = await fetch(url);
    if(!r.ok) throw new Error(`archive fetch ${year} failed`);
    return r.json().then(j => j.daily.temperature_2m_mean);
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

async function buildTempCache(lat, lon){
  activeKey = roundKey(lat,lon);
  const store = new Map();

  /* 2 .1  Current year (includes 10-day forecast) */
  const cur = await fetchDailyTemps(lat, lon);
  store.set(CURRENT_YEAR, cur.mean);                                          // keep both arrays

  lastDates = cur.dates;                                                      // remember for redraws

  /* 2 .2  All past years back to 1979  */
  const reqs = [];
  
  for(let y = CURRENT_YEAR-1; y >= MAX_YEAR_BACK; y--){
    reqs.push(
      fetchWindowForYear(lat,lon,today,DAYS_BACK,DAYS_FWD,y)
        .then(arr => store.set(y, arr))                                       // keep the array in the Map 
        .catch(console.warn)                                                  // keep going on failures
    );
  }

  await Promise.all(reqs);                                                    // wait until *all* complete

  /* 2 .3  Commit to the outer cache */
  tempCache.set(activeKey, store);

  /* 2 .4  If the user hasn’t moved meanwhile ⇒ redraw with slider range */
  if (activeKey === roundKey(lastLat,lastLon))
      updateTempChart(lastLat, lastLon, lastTempC, selectedYears, /*useCache*/true);
}

let tempChart, lastDates = [];                                                // <-- keep dates so every dataset aligns
let lastLat, lastLon, lastTempC;

async function updateTempChart(
  lat, lon, currentTempC,
  yearsWindow = 1,                                                            // 0 ⇒ all years
  useCache    = false) {

  const todayISO = today.toISOString().slice(0,10);
  const key = roundKey(lat, lon);
  let   seriesMap = tempCache.get(key);      // Map<year , mean[40]>

  /********************* 1. make sure we HAVE some data ****************/
  if (!useCache || !seriesMap) {
    /* quick 2-year fallback so the UI isn’t empty while cache builds */
    seriesMap = new Map();

    /* current year (fast; includes 10-day forecast) */
    const { dates, mean: curMean } = await fetchDailyTemps(lat, lon);
    seriesMap.set(CURRENT_YEAR, curMean);
    if (!dates.includes(todayISO)) {
      dates.push(todayISO);           // append the missing day
      mean .push(null);               // keep datasets aligned
    }
    lastDates = dates;

    /* last year only */
    const prevMean = await fetchWindowForYear(
      lat, lon, today, DAYS_BACK, DAYS_FWD, CURRENT_YEAR - 1);
    seriesMap.set(CURRENT_YEAR - 1, prevMean);
  }

  /* if we came from the real cache but have no dates yet → grab them once */
  if (!lastDates.length) {
    lastDates = (await fetchDailyTemps(lat, lon)).dates;
  }

  /********************* 2. decide which years to plot *****************/
  let years = [CURRENT_YEAR];                   // always show the blue line
  for (let i = 0; i < yearsWindow; i++) {
    const y = CURRENT_YEAR - 1 - i;
    if (seriesMap.has(y)) years.push(y);
  }
  years.sort((a, b) => a - b);                  // oldest → newest

  /********************* 3. build Chart.js datasets ********************/
  const ds = years.map((y, idx) => {
    const bold = (y === CURRENT_YEAR);
    return {
      label       : `${y}`,
      data        : seriesMap.get(y),
      borderColor : bold
                  ? "rgb(0, 123, 255)"                       // bright blue
                  : `rgba(0, ${123 + (122 / years.length) * (CURRENT_YEAR - y)}, ${255 - (255 / years.length) * (CURRENT_YEAR - y)}, ${0.8 - (0.8 / years.length) * (CURRENT_YEAR - y)})`,
      borderWidth : bold ? 2 : 1,
      borderDash  : [],
      tension     : .25,
      pointRadius : 0,
      order       : bold ? 1 : 0     // draw current year on top
    };
  });

 /*------------------- 4. Today’s vertical line ----------------------*/

  const annotationCfg = {
    annotations: {
      todayLine: {
        type : 'line',
        xMin : todayISO,
        xMax : todayISO,
        borderColor : 'red',
        borderWidth : 1,
        borderDash  : [6, 4],
        label: {
          content : currentTempC.toFixed(1) + " °C",
          enabled : true,
          position: 'start',
          backgroundColor: 'rgba(0,0,0,.6)',
          color : '#fff',
          yAdjust: -6,
          font : { size: 10, weight: 'bold' }
        }
      }
    }
  };

  /********************* 5. (re)draw the chart ************************/
  if (tempChart) tempChart.destroy();

  const ctx = document.getElementById("tempChart").getContext("2d");
  tempChart = new Chart(ctx, {
    type   : "line",
    data   : { labels: lastDates, datasets: ds },
    options: {
    scales : {
        x: {
          type : 'time',
          time : { unit: 'day', tooltipFormat: 'MMM d' },
          title: { display: true, text: "Date" },
          ticks: { maxRotation: 0, autoSkip: true }
        },
        y: { title: { display: true, text: "°C" } }
      },
      plugins:{
        legend : { position: "top", display: false },
        tooltip: { mode: "nearest", intersect: false },
        annotation: annotationCfg          // <- wrapped correctly now
      }
     }
  });
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
            // ----- Passthrough Shaders -----
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

  //----------Map Events
  map.on("click", e => {
    marker.setLngLat(e.lngLat);
    const z = map.getZoom();   
    map.flyTo({ center: e.lngLat, zoom: z, essential: true, duration: 800 });
    handlePosition(e.lngLat.lat, e.lngLat.lng);
  });

  //map.on("load", buildCircleLayer);      // first paint
  //map.on("moveend", buildCircleLayer);   // repaint when user pans / zooms

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
  if (weather){
        lastLat   = lat;
        lastLon   = lon;
        lastTempC = weather.temperature_c;
    
        /* Immediately draw with 1-year data so the UI feels snappy … */
        updateTempChart(lat, lon, lastTempC, selectedYears, /*useCache*/false);
    
        /* …then (re)build the cache in the background.                */
        buildTempCache(lat, lon);
      }

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
  
  const luxonAdapter  = window['chartjs-adapter-luxon'];           // auto-registers, but keep for safety

  if (window.ChartAnnotation) Chart.register(window.ChartAnnotation); 
  
  /* (the adapter self-registers on load, but won’t hurt if we do this) */
  if (luxonAdapter) Chart.register(luxonAdapter);
  
  /* now it’s safe to build charts */
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

  /* ─── Yearly temp history ─── */
  const slider   = document.getElementById("years-slider");
  const outYears = document.getElementById("years-output");

  slider.max = YEARS_AVAILABLE;

  /* live feedback while dragging */
  slider.addEventListener("input", () => {
    selectedYears = +(YEARS_AVAILABLE - slider.value);                // 0 ⇒ “This year”
    const firstYear = CURRENT_YEAR - selectedYears;
    outYears.textContent = selectedYears === 0 ? "---just 2025" : `${firstYear} to 2025`;
  });

  /* actually refresh the chart when drag finished */
  slider.addEventListener("change", () => {
    if (lastLat !== undefined) {
      updateTempChart(
        lastLat, lastLon, lastTempC,
        selectedYears, /*useCache*/ true
      );
    }
  });
});