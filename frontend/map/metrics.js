const AQ_VAR = "us_aqi";

export const CHART_METRICS = {
  temp_2m : {
    id          : 'temp_2m',                 // used in cache keys & <select>
    label       : 'Mean Temperature (°C)',
    units       : '°C',
    dailyVars   : 'temperature_2m_max,temperature_2m_min',
    toMean      : (d,i)=> (d.temperature_2m_max[i]+d.temperature_2m_min[i])/2,
    archiveVars : 'temperature_2m_max,temperature_2m_min',
    toMeanArc   : (d,i)=>(d.temperature_2m_max[i] + d.temperature_2m_min[i]) / 2,
    color       : '#007bff'
  },
  relhum_2m : {
    id          : 'relhum_2m',
    label       : 'Rel. Humidity (%)',
    units       : '%',
    dailyVars   : 'relative_humidity_2m_mean',
    toMean      : (d,i)=> d.relative_humidity_2m_mean[i],
    archiveVars : 'relative_humidity_2m_mean',
    toMeanArc   : (d,i)=> d.relative_humidity_2m_mean[i],
    color       : '#00b894'
  },
  soiltemp_0 : {
    id          : 'soiltemp_0',
    label       : 'Soil Temperature (°C)',
    units       : '°C',
    hourlyVars : 'soil_temperature_0cm',
    toMeanHour : (d,i)=> d.soil_temperature_0cm[i],
    color       : '#007bff'
  },
  soilmstr_0_1 : {
    id          : 'soilmstr_0_1',
    label       : 'Soil Moisture (%)',
    units       : '%',
    hourlyVars : 'soil_moisture_0_1cm',
    toMeanHour : (d,i)=> d.soil_moisture_0_1cm[i],
    color       : '#00b894'
  }
};

export const CURRENT_METRICS = {
  elevation : {
    url  : ({lat,lon}) =>
      `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,
    parse: j => j.elevation?.[0] ?? NaN 
  },

  airQuality : {
    url  : ({lat,lon}) =>
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${lat}&longitude=${lon}` +
      `&hourly=${AQ_VAR}&timezone=UTC&forecast_hours=1&past_hours=1`,
    parse: j => {
      const v = j.hourly?.[AQ_VAR];
      return v ? v.at(-1) : NaN; 
    }
  },

  rainLast30 : {   // precipitation last 30 days
    url  : ({lat,lon}) =>
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=precipitation_sum&past_days=30&forecast_days=0&timezone=UTC`,
    parse: j => {
      const daily = j.daily?.precipitation_sum ?? [];
      return {                                   // → { daily:Array, total:Number }
        daily,
        total: daily.reduce((a,b)=>a+b,0)
      };
    }
  }
};