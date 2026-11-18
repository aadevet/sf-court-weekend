const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const web = __dirname;
const parks = require(path.join(web, 'courts.js'));
const rec = 'https://www.rec.us';
const api = 'https://api.rec.us/v1/locations';
const localClock = new Intl.DateTimeFormat('sv-SE', {
  timeZone:'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit',
  hour:'2-digit', minute:'2-digit', hourCycle:'h23'
});
const parkList = parks.filter(park => park.slug && park.slug !== 'goldman');
const dayMs = 86400000;
const iso = date => date.toISOString().slice(0,10);
const atMidnight = date => new Date(date + 'T00:00:00Z');
const assets = new Map([
  ['/', ['index.html','text/html']], ['/index.html',['index.html','text/html']],
  ['/style.css',['style.css','text/css']], ['/app.js',['app.js','text/javascript']],
  ['/courts.js',['courts.js','text/javascript']]
]);
const locationIds = new Map();
const weekendCache = new Map();
const enabled = process.env.REC_LIVE === '1';

function minuteOfDay(time) {
  const match = /^(\d{2}):(\d{2})(?::00)?$/.exec(time);
  if (!match) return NaN;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return minute < 60 && (hour < 24 || (hour === 24 && minute === 0)) ? hour * 60 + minute : NaN;
}

function dateForRequest(saturday, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saturday ?? '')) return null;
  const date = atMidnight(saturday);
  if (!Number.isFinite(+date) || iso(date) !== saturday || date.getUTCDay() !== 6) return null;
  const today = atMidnight(localClock.format(now).slice(0,10));
  const ahead = (date - today) / dayMs;
  return ahead >= -1 && ahead <= 13 ? date : null;
}

function cellsFor(schedule, date, courtMeta, now) {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) return Array(48).fill('unknown');
  const stamp = localClock.format(now);
  const [today, time] = stamp.split(' ');
  const window = courtMeta?.defaultReservationWindowDays;
  const release = minuteOfDay(courtMeta?.reservationReleaseTimeLocal);
  const releaseDate = Number.isInteger(window) && window >= 0 ? iso(new Date(+atMidnight(date) - window * dayMs)) : null;
  const released = releaseDate && (today > releaseDate ||
    (today === releaseDate && Number.isFinite(release) && minuteOfDay(time) >= release));
  const intervals = Object.entries(schedule).map(([range, info]) => {
    const [start,end] = range.split(',').map(value => minuteOfDay(value.trim()));
    return { start, end, type:info?.referenceType };
  }).filter(({start,end}) => Number.isFinite(start) && end > start);
  return Array.from({length:48}, (_, slot) => {
    const start = slot * 30;
    const end = start + 30;
    if (date < today || (date === today && start <= minuteOfDay(time))) return 'closed';
    if (intervals.some(block => block.type === 'RESERVATION' && block.start < end && block.end > start)) return 'closed';
    if (intervals.some(block => block.type === 'RESERVABLE' && block.start <= start && block.end >= end)) {
      return releaseDate ? (released ? 'free' : 'closed') : 'unknown';
    }
    return intervals.length ? 'closed' : 'unknown';
  });
}

async function read(url, json = true) {
  const response = await fetch(url, {signal:AbortSignal.timeout(9000), headers:{Accept:json ? 'application/json' : 'text/html'}});
  if (!response.ok) throw new Error('Rec.us returned ' + response.status);
  return json ? response.json() : response.text();
}

async function resolveLocation(slug) {
  if (locationIds.has(slug)) return locationIds.get(slug);
  const html = await read(rec + '/' + slug, false);
  const normalized = html.replaceAll(String.fromCharCode(92) + '"', '"');
  const uuid = normalized.match(/rec\.us\/locations\/([a-f0-9-]{36})/i)?.[1] ??
    normalized.match(/"locationId"\s*:\s*"([a-f0-9-]{36})"/i)?.[1];
  if (!uuid) throw new Error('Location ID unavailable');
  locationIds.set(slug,uuid);
  return uuid;
}

async function readLocation(park, dates, now) {
  const uuid = await resolveLocation(park.slug);
  const url = api + '/' + uuid;
  const [details, ...daily] = await Promise.all([
    read(url + '?publishedSites=true'),
    ...dates.map(date => read(url + '/schedule?startDate=' + date))
  ]);
  const meta = new Map((details.location?.courts ?? details.courts ?? []).map(court => [String(court.courtNumber),court]));
  const result = new Map();
  for (const [index, day] of dates.entries()) {
    const courts = daily[index].dates?.[day.replaceAll('-','')];
    if (!Array.isArray(courts)) continue;
    for (const court of courts) {
      const number = String(court.courtNumber ?? '');
      const sports = (court.sports ?? []).map(sport => sport.name?.toLowerCase()).filter(sport => sport === 'tennis' || sport === 'pickleball');
      const config = meta.get(number);
      // Courts without a published reservation window are not identifiable as reservable.
      if (!number || !sports.length || !Number.isInteger(config?.defaultReservationWindowDays)) continue;
      const row = result.get(number) ?? {name:/^court\b/i.test(number) ? number : 'Court ' + number, sports:[], dates:{}};
      row.sports = [...new Set([...row.sports, ...sports])];
      row.dates[day] = cellsFor(court.schedule, day, config, now);
      result.set(number,row);
    }
  }
  if (!result.size) throw new Error('Court schedules unavailable');
  return [...result.values()].sort((a,b) => a.name.localeCompare(b.name,undefined,{numeric:true}));
}

async function fetchWeekend(saturday, now = new Date()) {
  const locations = {};
  const dates = [iso(saturday),iso(new Date(+saturday + dayMs))];
  let failed = 0;
  if (enabled) {
    // Keep simultaneous requests bounded, even for a full city directory.
    for (let index = 0; index < parkList.length; index += 3) {
      await Promise.all(parkList.slice(index,index + 3).map(async park => {
        try { locations[park.slug] = await readLocation(park,dates,now); }
        catch { failed++; }
      }));
    }
  }
  return {enabled, checkedAt:now.toISOString(),loaded:Object.keys(locations).length,failed,locations};
}

function schedule(date) {
  const key = iso(date);
  const now = Date.now();
  for (const [id, entry] of weekendCache) if (entry.expires <= now) weekendCache.delete(id);
  if (!weekendCache.has(key)) weekendCache.set(key, {expires:now + 120000, value:fetchWeekend(date)});
  return weekendCache.get(key).value;
}

async function handle(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const send = (code,type,body) => {
    response.writeHead(code, {'Content-Type':type + '; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    response.end(body);
  };
  if (request.method !== 'GET') return send(405,'text/plain','Method not allowed');
  if (url.pathname === '/api/weekend') {
    const date = dateForRequest(url.searchParams.get('saturday'));
    if (!date) return send(400,'application/json','{"error":"Choose an upcoming Saturday"}');
    return send(200,'application/json',JSON.stringify(await schedule(date)));
  }
  const asset = assets.get(url.pathname);
  if (!asset) return send(404,'text/plain','Not found');
  return send(200,asset[1],await fs.readFile(path.join(web,asset[0])));
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 8787);
  http.createServer((request,response) => {
    handle(request,response).catch(() => {
      if (response.headersSent) return response.destroy();
      response.writeHead(500, {'Content-Type':'text/plain; charset=utf-8'});
      response.end('Dashboard unavailable');
    });
  }).listen(port,'127.0.0.1',() => console.log('SF Court Weekend · http://127.0.0.1:' + port));
}
module.exports = {cellsFor, dateForRequest, fetchWeekend, handle};
