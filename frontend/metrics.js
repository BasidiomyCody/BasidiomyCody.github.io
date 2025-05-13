export const METRICS = {
    temp : {
      id          : 'temp',                 // used in cache keys & <select>
      label       : 'Mean Temperature (°C)',
      units       : '°C',
      dailyVars   : 'temperature_2m_max,temperature_2m_min',
      toMean      : (d,i)=> (d.temperature_2m_max[i]+d.temperature_2m_min[i])/2,
      archiveVars : 'temperature_2m_max,temperature_2m_min',
      toMeanArc   : (d,i)=>(d.temperature_2m_max[i] + d.temperature_2m_min[i]) / 2,
      color       : '#007bff'
    },
    rh : {
      id          : 'rh',
      label       : 'Rel. Humidity (%)',
      units       : '%',
      dailyVars   : 'relative_humidity_2m_mean',
      toMean      : (d,i)=> d.relative_humidity_2m_mean[i],
      archiveVars : 'relative_humidity_2m_mean',
      toMeanArc   : (d,i)=> d.relative_humidity_2m_mean[i],
      color       : '#00b894'
    }
  };