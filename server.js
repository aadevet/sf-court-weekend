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
  ['/courts.js',['courts.js','text/javascript']], ['/geo.js',['geo.js','text/javascript']]
]);
const locationIds = new Map();
const weekendCache = new Map();
const enabled = process.env.REC_LIVE !== '0';

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
  const releaseUnknown = !releaseDate || (today === releaseDate && !Number.isFinite(release));
  const released = !releaseUnknown && (today > releaseDate ||
    (today === releaseDate && minuteOfDay(time) >= release));
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
      return releaseUnknown ? 'unknown' : (released ? 'free' : 'closed');
    }
    return intervals.length ? 'closed' : 'unknown';
  });
}

async function read(url, json = true) {
  const response = await fetch(url, {signal:AbortSignal.timeout(9000), headers:{Accept:json ? 'application/json' : 'text/html'}});
  if (!response.ok) {
    const error = new Error('Rec.us returned ' + response.status);
    error.status = response.status;
    throw error;
  }
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
  const [details, daily] = await Promise.all([
    read(url + '?publishedSites=true'),
    Promise.allSettled(dates.map(date => read(url + '/schedule?startDate=' + date)))
  ]);
  const location = details.location ?? details;
  const meta = new Map((location.courts ?? details.courts ?? []).map(court => [String(court.courtNumber),court]));
  const result = new Map();
  for (const [index, day] of dates.entries()) {
    const courts = daily[index].value?.dates?.[day.replaceAll('-','')];
    if (!Array.isArray(courts)) continue;
    for (const court of courts) {
      const number = String(court.courtNumber ?? '');
      const sports = (court.sports ?? []).map(sport => sport.name?.toLowerCase()).filter(sport => sport === 'tennis' || sport === 'pickleball');
      const courtConfig = meta.get(number);
      const window = courtConfig?.defaultReservationWindowDays ?? location.defaultReservationWindow;
      const blockTypes = new Set(Object.values(court.schedule ?? {}).map(block => block?.referenceType));
      const publishable = blockTypes.has('RESERVABLE') ||
        (blockTypes.has('RESERVATION') && !blockTypes.has('OPEN'));
      // A shared park policy alone does not make a walk-up court reservable.
      if (!number || !sports.length || !courtConfig || !Number.isInteger(window)) continue;
      if (courtConfig.defaultReservationWindowDays == null && !publishable) continue;
      const config = {
        defaultReservationWindowDays:window,
        reservationReleaseTimeLocal:courtConfig.reservationReleaseTimeLocal ?? location.reservationReleaseTimeLocal
      };
      const row = result.get(number) ?? {name:/^court\b/i.test(number) ? number : 'Court ' + number, datesBySport:{}};
      const cells = cellsFor(court.schedule, day, config, now);
      for (const sport of sports) {
        row.datesBySport[sport] ??= {};
        row.datesBySport[sport][day] = cells;
      }
      result.set(number,row);
    }
  }
  if (!result.size) {
    const blocked = daily.find(day => day.reason?.status === 403);
    throw blocked?.reason ?? new Error('Court schedules unavailable');
  }
  return [...result.values()].sort((a,b) => a.name.localeCompare(b.name,undefined,{numeric:true}));
}

async function fetchWeekend(saturday, now = new Date(), progress) {
  const locations = {};
  const dates = [iso(saturday),iso(new Date(+saturday + dayMs))];
  let failed = 0;
  let forbidden = 0;
  if (enabled) {
    // Keep simultaneous requests bounded, even for a full city directory.
    for (let index = 0; index < parkList.length; index += 3) {
      await Promise.all(parkList.slice(index,index + 3).map(async park => {
        try { locations[park.slug] = await readLocation(park,dates,now); }
        catch (error) {
          failed++;
          if (error.status === 403) forbidden++;
        } finally {
          if (progress) progress.completed++;
        }
      }));
    }
  }
  return {enabled, checkedAt:now.toISOString(),loaded:Object.keys(locations).length,failed,forbidden,locations};
}

function schedule(date) {
  const key = iso(date);
  const now = Date.now();
  for (const [id, entry] of weekendCache) if (entry.expires <= now) weekendCache.delete(id);
  if (!weekendCache.has(key)) {
    const progress = {completed:0, total:enabled ? parkList.length : 0, startedAt:now};
    const entry = {progress, expires:Infinity};
    entry.value = fetchWeekend(date, new Date(now), progress).finally(() => {
      entry.expires = Date.now() + 120000;
    });
    weekendCache.set(key, entry);
  }
  return weekendCache.get(key).value;
}

async function addressLookup(request, send) {
  const json = (status, data) => send(status,'application/json',JSON.stringify(data));
  if (request.method !== 'POST') return json(405,{error:'Submit an address to look it up.'});
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    return json(415,{error:'The address request must use JSON.'});
  }
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 2048) return json(413,{error:'The address is too long.'});
  }
  let address;
  try { address = JSON.parse(body)?.address?.trim(); } catch {}
  if (!address || address.length > 250) return json(400,{error:'Enter a full U.S. street address.'});

  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
  url.search = new URLSearchParams({address,benchmark:'Public_AR_Current',format:'json'});
  try {
    const result = await read(url);
    const matches = (result?.result?.addressMatches ?? []).filter(({coordinates}) =>
      Number.isFinite(coordinates?.x) && Number.isFinite(coordinates?.y));
    if (!matches.length) return json(404,{error:'Address not found. Include city and state or ZIP code.'});
    const {coordinates,matchedAddress} = matches[0];
    if (matches.some(match => match.coordinates.x !== coordinates.x || match.coordinates.y !== coordinates.y)) {
      return json(409,{error:'More than one address matched. Include city, state and ZIP code.'});
    }
    return json(200,{point:[coordinates.y,coordinates.x],label:matchedAddress});
  } catch {
    return json(502,{error:'The address lookup service is unavailable. Try again shortly.'});
  }
}

async function handle(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const send = (code,type,body) => {
    response.writeHead(code, {'Content-Type':type + '; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    response.end(body);
  };
  if (url.pathname === '/api/address') return addressLookup(request,send);
  if (request.method !== 'GET') return send(405,'text/plain','Method not allowed');
  if (url.pathname === '/api/weekend' || url.pathname === '/api/weekend/progress') {
    const date = dateForRequest(url.searchParams.get('saturday'));
    if (!date) return send(400,'application/json','{"error":"Choose an upcoming Saturday"}');
    if (url.pathname.endsWith('/progress')) {
      const entry = weekendCache.get(iso(date));
      const progress = entry?.expires === Infinity ? entry.progress : null;
      return send(200,'application/json',JSON.stringify(progress));
    }
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
