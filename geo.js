const courtTimeZone = 'America/Los_Angeles';
const solarClock = new Intl.DateTimeFormat('en-GB', {
  timeZone:courtTimeZone, hour:'2-digit', minute:'2-digit', hourCycle:'h23'
});
const radians = degrees => degrees * Math.PI / 180;

function distanceKm([lat1, lon1], [lat2, lon2]) {
  const a = Math.sin(radians(lat2 - lat1) / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(a, 1)));
}

// Estimate apparent sunrise and sunset at central San Francisco using the NOAA solar equations.
// The 90.833° zenith includes refraction and the Sun's apparent radius.
function solarEventMinute(date, morning) {
  const latitude = radians(37.7749);
  const longitude = -122.4194;
  let utcMinutes = morning ? 840 : 60;
  for (let i = 0; i < 3; i++) {
    const julian = (date.valueOf() + utcMinutes * 60000) / 86400000 + 2440587.5;
    const century = (julian - 2451545) / 36525;
    const meanLongitude = radians((280.46646 + century * (36000.76983 + century * .0003032)) % 360);
    const anomaly = radians(357.52911 + century * (35999.05029 - .0001537 * century));
    const eccentricity = .016708634 - century * (.000042037 + .0000001267 * century);
    const correction = (1.914602 - century * (.004817 + .000014 * century)) * Math.sin(anomaly) +
      (.019993 - .000101 * century) * Math.sin(2 * anomaly) + .000289 * Math.sin(3 * anomaly);
    const omega = radians(125.04 - 1934.136 * century);
    const apparentLongitude = meanLongitude + radians(correction - .00569 - .00478 * Math.sin(omega));
    const obliquity = radians(23 + 26 / 60 + (21.448 - century * (46.815 + century * (.00059 - .001813 * century))) / 3600 +
      .00256 * Math.cos(omega));
    const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude));
    const y = Math.tan(obliquity / 2) ** 2;
    const equation = y * Math.sin(2 * meanLongitude) - 2 * eccentricity * Math.sin(anomaly) +
      4 * eccentricity * y * Math.sin(anomaly) * Math.cos(2 * meanLongitude) -
      .5 * y * y * Math.sin(4 * meanLongitude) - 1.25 * eccentricity ** 2 * Math.sin(2 * anomaly);
    const hourAngle = Math.acos(Math.cos(radians(90.833)) / (Math.cos(latitude) * Math.cos(declination)) -
      Math.tan(latitude) * Math.tan(declination));
    utcMinutes = 720 + 4 * ((morning ? -hourAngle : hourAngle) / radians(1) - longitude) - 4 * equation / radians(1);
  }
  const event = new Date(+date + Math.round(utcMinutes) * 60000);
  const [hour, minute] = solarClock.format(event).split(':').map(Number);
  return hour * 60 + minute;
}

const sunriseStart = date => solarEventMinute(date, true) - 60;
const sunsetCutoff = date => solarEventMinute(date, false) + 60;

if (typeof module !== 'undefined') module.exports = {distanceKm, sunriseStart, sunsetCutoff};
