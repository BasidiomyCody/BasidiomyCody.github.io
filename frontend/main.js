import { METRICS } from './metrics.js';

/* ------------------------ CONSTANTS -------------------------------- */
// ------------------------ API
const API = "/api/current";
const MAPTILER_KEY = "IhXFbEsJkTsqUepcwuNn";

// ------------------------ MAP
const DEFAULT_LAT = 42.6791;
const DEFAULT_LON = -70.8417;
const DEFAULT_ZOOM = 12;

// ------------------------ CHARTS
const TODAY = new Date();
const CURRENT_YEAR   = TODAY.getFullYear();
const MAX_YEAR_BACK = 1979;
const DAYS_BACK = 20;         // 20 days of history
const DAYS_FWD  = 10;         // 10 days of forecast
const YEARS_AVAILABLE = CURRENT_YEAR - MAX_YEAR_BACK; 

let YEARS_BACK = 5;

// ------------------------ SHADERS
const MARKER_RADIUS = 10;       // in miles

// ------------------------ AIR QUALITY
const AQ_VAR = "us_aqi";


/* ------------------------  UTILITY  -------------------------------- */
// ------------------------ NETWORK
const $ = (sel) => document.querySelector(sel);   // makes $() work

function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ------------------------ DATA CONVERSION
// --TEMP
function cToF(c) { return (c * 9/5 + 32).toFixed(1); }

// --CHARTS
const q = (lat,lon)=> `latitude=${lat}&longitude=${lon}`;
const roundKey  = (lat,lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`;       //  ~10 km grid

function key(metric,lat,lon){ return `${metric}_${roundKey(lat,lon)}` }

// --------------------------- SHADERS
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

/* ---------------------------- LEFT CARD ------------------------------ */
// ------------------------ HELPERS
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

/* ------------------------ BOTTOM CARD ---------------------------- */
// ------------------------ HELPERS
export async function fetchWindow(metric, lat, lon, past = DAYS_BACK, fut = DAYS_FWD){
  const m = METRICS[metric];
  const url = `https://api.open-meteo.com/v1/forecast?${q(lat,lon)}`
            + `&past_days=${past}&forecast_days=${fut}`
            + `&daily=${m.dailyVars}&timezone=auto`;
  const { daily } = await (await fetch(url)).json();
  const data  = daily.time.map((_,i)=> m.toMean(daily,i));
  return { dates: daily.time, data };
}

export async function fetchArchive(metric, lat, lon, year){
    const m  = METRICS[metric];
    const d0 = new Date(year, TODAY.getMonth(), TODAY.getDate() - DAYS_BACK);
    const d1 = new Date(year, TODAY.getMonth(), TODAY.getDate() + DAYS_FWD);
  
    const [start, end] = d0 < d1 ? [d0, d1] : [d1, d0];
  
    const url = `https://archive-api.open-meteo.com/v1/archive?${q(lat,lon)}` +
                `&start_date=${iso(start)}&end_date=${iso(end)}` +
                `&daily=${m.archiveVars}&timezone=auto`;

    const daily = (await (await fetch(url)).json()).daily;
    return daily.time.map((_,i)=> m.toMeanArc(daily,i));
}

// ------------------------ LEFT CHART
let lastLat, lastLon, lastTempC;

const seriesCache = new Map();       // key = `${metric}_${loc}`
const iso = d => d.toISOString().slice(0,10);

let leftChart, chartDates=[];      // reuse old canvas id

let currentMetric = 'temp';
$('#metric-select').addEventListener('change', e=>{
   currentMetric = e.target.value;
   if(lastLat) drawChart(currentMetric,lastLat,lastLon,YEARS_BACK,lastTempC);
});

$('#years-slider').addEventListener("change", slider=>{
    YEARS_BACK = +(YEARS_AVAILABLE - slider.target.value);
    //console.log(YEARS_BACK);
    if (lastLat) {
        drawChart(currentMetric, lastLat, lastLon, YEARS_BACK, lastTempC);
    }
});

async function ensureCache(metric, lat, lon, yearsBack){
    const k = key(metric,lat,lon);
    let store = seriesCache.get(k);

    // first visit to this metric + location
    if (!store) {
        store = new Map();
        const { dates, data } = await fetchWindow(metric, lat, lon);
        store.set(CURRENT_YEAR, data);
        if (!chartDates.length) chartDates = dates;
        seriesCache.set(k, store);
    }

    //  ensure we have ALL years the slider now asks for
    const haveYears = store.size - 1;      // minus current year
    if (yearsBack > haveYears) {
        const missing = Array.from(
        { length: yearsBack - haveYears },
        (_, i) => CURRENT_YEAR - 1 - haveYears - i
        );

        await Promise.all(
        missing.map(y =>
            fetchArchive(metric, lat, lon, y)
            .then(arr => store.set(y, arr))
            .catch(console.warn)
        )
        );
    }
    return store;
}

async function drawChart(metric, lat, lon, yearsBack, currentTempC){
  const store = await ensureCache(metric,lat,lon,YEARS_BACK);
  const meta  = METRICS[metric];

  // build ordered year list
  const years = [CURRENT_YEAR,...Array.from({length:yearsBack},(_,i)=>CURRENT_YEAR-1-i)]
                  .filter(y=>store.has(y)).sort((a,b)=>b-a);

  const datasets = years.map((y,i)=>({
      label : y,
      data  : store.get(y),
      borderColor : i ? `hsla(210,70%,${85-60*i/years.length}%,.6)`
                      : meta.color,
      borderWidth : i ? 1 : 2,
      pointRadius : 0, tension:.25
  }));

  // TODAY line
  const todayISO = iso(TODAY);
  const annotation = {
    annotations:{
      TODAY:{ type:'line', xMin:todayISO, xMax:todayISO,
              borderColor:'red', borderWidth:1, borderDash:[6,4],
              label: {
                content : "Today",
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

  leftChart?.destroy();
  leftChart = new Chart(
      document.getElementById('leftChart'),
      { type:'line',
        data:{ labels:chartDates, datasets },
        options:{
          layout:{ padding:{ bottom: 50 } },
          scales:{ x:{type:'time',time:{unit:'day'},ticks:{ maxRotation:0 }}, y:{title:{text:meta.units,display:true}} },
          plugins:{ legend:{display:false}, annotation }
        }
      });
}

/* ------------------------ MAP --------------------------------- */
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
  

  // -------------------- MARKER INIT
  const marker = new maplibregl.Marker({ draggable: true })
    .setLngLat([lon, lat])
    .addTo(map);
  handlePosition(lat, lon);


  // --------------------- GLSL SHADERS
  // -- CIRCLE AROUND MARKER
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

  // --------------------- MAP EVENTS
  map.on("click", e => {
    marker.setLngLat(e.lngLat);
    const z = map.getZoom();   
    map.flyTo({ center: e.lngLat, zoom: z, essential: true, duration: 800 });
    handlePosition(e.lngLat.lat, e.lngLat.lng);
  });

  //map.on("load", buildCircleLayer);      // first paint
  //map.on("moveend", buildCircleLayer);   // repaint when user pans / zooms

  // --------------------- MARKER EVENTS
  marker.on("dragend", () => {
    const pos = marker.getLngLat();
    handlePosition(pos.lat, pos.lng);
  });
}

/* ------------------------ UPDATE DATA ---------------------------- */
// ------------------------- HELPERS
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

// ------------------------- MAIN HANDLERS
// -- MAP + LEFT CARD
async function handlePosition(lat, lon) {
  const coordBox = document.getElementById("coordinates");

  coordBox.style.display = "block";
  coordBox.innerHTML =
    `Longitude: ${lon.toFixed(5)}<br>Latitude: ${lat.toFixed(5)}`;

  const weather = await refreshWeather(lat, lon);   // grab the data
  if (weather){
        lastLat   = lat;
        lastLon   = lon;
        lastTempC = weather.temperature_c;
    
        /* Immediately draw with 1-year data so the UI feels snappy … */
        drawChart(currentMetric, lat, lon, YEARS_BACK, lastTempC);
    
      }

  document.getElementById("elev").textContent = "Elevation — m";
  document.getElementById("aqi").textContent  = "PM₂․₅ — µg/m³";

  Promise.allSettled([
    fetchElevation(lat, lon),
    fetchAirQuality(lat, lon),
    fetchRainHistory(lat, lon)
  ]).then(([elevRes, aqiRes, rainRes]) => {
    if (elevRes.status === "fulfilled" && !isNaN(elevRes.value)) {
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

/* ----------------------- EVENTS ------------------------ */

document.addEventListener("DOMContentLoaded", () => {
  const luxonAdapter  = window['chartjs-adapter-luxon'];

  if (window.ChartAnnotation) Chart.register(window.ChartAnnotation); 
  if (luxonAdapter) Chart.register(luxonAdapter);

  // ------------------------ LEFT CARD
  // --Top-right panel toggle
  const card   = document.getElementById("card");
  const toggle = document.getElementById("card-toggle");

  toggle.addEventListener("click", () => {
    const collapsed = card.classList.toggle("collapsed");
    toggle.classList.toggle("rotated", collapsed);
    toggle.setAttribute("aria-expanded", !collapsed);
    toggle.title = collapsed ? "Show details" : "Hide details";
  });

  // ---------------------- MAP INIT
  /* now it’s safe to build charts */
  initMap(DEFAULT_LAT, DEFAULT_LON);

  // ---------------------- BOTTOM CARD
  // --Bottom sheet toggle
  const sheet      = document.getElementById("bottom-card");
  const sheetBtn   = document.getElementById("bottom-toggle");

  sheetBtn.addEventListener("click", () => {
    const open = sheet.classList.toggle("open");
    sheetBtn.classList.toggle("open", open);
    sheetBtn.setAttribute("aria-expanded", open);
    sheetBtn.title = open ? "Hide panel" : "Show more";
  });

  // --Yearly temp history
  const slider   = document.getElementById("years-slider");
  const outYears = document.getElementById("years-output");

  slider.max = YEARS_AVAILABLE;

  /* live feedback while dragging */
  slider.addEventListener("input", () => {
    YEARS_BACK = +(YEARS_AVAILABLE - slider.value);            // 0 ⇒ “This year”
    const firstYear = CURRENT_YEAR - YEARS_BACK;
    outYears.textContent = YEARS_BACK === 0 ? "uh just 2025" : `${firstYear} to 2025`;
  });

});