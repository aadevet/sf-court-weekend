const id = key => document.getElementById(key);
const iso = date => date.toISOString().slice(0, 10);
const sanFrancisco = new Intl.DateTimeFormat('en-CA', {
  timeZone:'America/Los_Angeles', year:'numeric', month:'2-digit', day:'2-digit'
});
const dateLabel = new Intl.DateTimeFormat('en-US', {timeZone:'UTC', month:'short', day:'numeric'});
const clock = new Intl.DateTimeFormat('en-US', {timeZone:'UTC', hour:'numeric', minute:'2-digit'});
const times = Array.from({length:48}, (_, index) => index * 30);
const sports = ['tennis','pickleball'];
const booking = park => park.slug === 'goldman'
  ? 'https://app.courtreserve.com/Online/Portal/Index/12465'
  : 'https://www.rec.us/' + park.slug;
const directories = {
  tennis:'https://recpark.sf.gov/1446/Tennis-Court-Directory',
  pickleball:'https://recpark.sf.gov/1772/Pickleball-Court-Directory'
};
const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);
const time = minute => clock.format(new Date(minute * 60000));

function gridDay(date) {
  const cutoff = sunsetCutoff(date);
  return {date, cutoff, columns:times.filter(minute => minute < cutoff)};
}

let origin;
const distanceFor = park => origin ? distanceKm(origin, park.point) : 0;
function distanceLabel(park) {
  return origin ? '<span class="distance">' + distanceFor(park).toFixed(1) + ' km</span>' : '';
}

let offset = 0;
let lookup = {};
let request = 0;

function weekend() {
  const saturday = new Date(sanFrancisco.format(new Date()) + 'T00:00:00Z');
  const day = saturday.getUTCDay();
  saturday.setUTCDate(saturday.getUTCDate() + (day ? 6 - day : -1) + offset * 7);
  return [saturday, new Date(saturday.valueOf() + 86400000)];
}

function rows() {
  const search = id('search').value.toLowerCase().trim();
  const selectedSports = sports.filter(sport => id(sport).checked);
  const reserve = id('reserve').checked;
  const walk = id('walk').checked;
  const matches = parks.filter(park => park.name.toLowerCase().includes(search));
  if (origin) matches.sort((a,b) => distanceFor(a) - distanceFor(b));
  return matches.flatMap(park =>
    selectedSports.flatMap(sport => {
      const info = park[sport];
      if (!info || (sport === 'pickleball' && id('net').checked && info.nets !== 'provided')) return [];
      const result = [];
      if (reserve && info.reserve) {
        const live = (lookup[park.slug] ?? []).filter(court => court.datesBySport[sport]);
        for (const court of live) result.push({ title:court.name, dates:court.datesBySport[sport], mode:'reserve' });
        for (let n = live.length; n < info.reserve; n++) {
          result.push({ title:'Listed reservable court ' + (n + 1), dates:{}, mode:'reserve' });
        }
      }
      if (walk) {
        for (let n = 1; n <= info.walk; n++) result.push({ title:'Walk-up court ' + n, dates:{}, mode:'walk' });
      }
      return result.map(row => ({...row, park, sport, nets:info.nets}));
    }));
}

function drawHead(days) {
  id('weekend').textContent = dateLabel.formatRange(...days);
  id('previous').disabled = offset === 0;
  id('next').disabled = offset === 1;
  const grid = days.map(gridDay);
  const dates = grid.map(({date,cutoff,columns},index) =>
    '<th scope="colgroup" colspan="' + columns.length + '">' + (index ? 'Sunday' : 'Saturday') +
    ' · ' + dateLabel.format(date) + ' · Through ' + time(cutoff) + '</th>');
  const timesOfDay = grid.flatMap(({columns},index) => columns.map(minute =>
    '<th scope="col"' + (minute === 420 ? ' id="day-' + index + '"' : '') +
    (index && !minute ? ' class="day-start"' : '') + '>' +
    time(minute).replace(':00', '').replace(' ', '') + '</th>'));
  id('head').innerHTML = '<tr><th class="row-name" rowspan="2" scope="col">Park / court</th>' +
    dates.join('') + '</tr><tr>' + timesOfDay.join('') + '</tr>';
}

function drawRows(days) {
  const grid = days.map(gridDay);
  id('body').innerHTML = rows().map(row => {
    const url = row.mode === 'reserve' ? booking(row.park) : directories[row.sport];
    const sport = row.sport === 'tennis' ? 'Tennis' : 'Pickleball';
    const nets = {provided:' · Nets provided',bring:' · Check / bring net',loan:' · Net lending hours'}[row.nets] ?? '';
    return '<tr><th class="row-name" scope="row"><a href="' + url + '" target="_blank" rel="noopener">' +
      escape(row.park.name) + '</a>' + distanceLabel(row.park) + '<small>' + escape(sport + ' · ' + row.title + nets) + '</small></th>' +
      grid.flatMap(({date,cutoff,columns},index) => columns.map((minute,slot) => {
        const span = time(minute) + '–' + time(Math.min(minute + 30,cutoff));
        const state = row.mode === 'walk' ? 'walk' : (row.dates[iso(date)]?.[slot] ?? 'unknown');
        const label = {free:'Available to reserve',closed:'Unavailable',unknown:'Availability unknown',walk:'Walk-up, check hours and occupancy'}[state] ?? 'Availability unknown';
        const detail = iso(date) + ' ' + span + ' · ' + label;
        const link = state === 'free'
          ? '<a href="' + url + '" target="_blank" rel="noopener" aria-label="' +
            escape('Open booking for ' + row.park.name + ', ' + row.title + ', ' + detail) + '">↗</a>'
          : '';
        return '<td class="' + escape(state) + (index && !minute ? ' day-start' : '') + '" title="' +
          escape(detail) + '" aria-label="' + escape(detail) + '">' + link + '</td>';
      })).join('') + '</tr>';
  }).join('') || '<tr><th class="row-name">No matching courts</th></tr>';
}

function jump(day) {
  const scroller = id('scroll');
  scroller.scrollLeft += id('day-' + day).getBoundingClientRect().left - scroller.getBoundingClientRect().left -
    id('head').querySelector('.row-name').offsetWidth;
}

function watchRefresh(current, query, signal) {
  const activity = id('refresh-activity');
  const meter = id('refresh-meter');
  const detail = id('refresh-detail');
  let timer;
  activity.hidden = false;
  meter.removeAttribute('value');
  detail.textContent = 'Starting availability check…';

  async function poll() {
    if (signal.aborted || current !== request) return;
    try {
      const response = await fetch('api/weekend/progress' + query, {signal});
      if (!response.ok) return;
      const progress = await response.json();
      if (signal.aborted || current !== request) return;
      if (progress?.total) {
        const {completed,total,startedAt} = progress;
        meter.max = total;
        meter.value = completed;
        const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
        const remaining = elapsed * (total - completed) / completed;
        const rounded = Math.max(5, Math.ceil(remaining / 5) * 5);
        const estimate = completed === total ? 'Finishing…' : completed < 3
          ? 'Estimating time…'
          : (rounded >= 60 ? 'About ' + Math.ceil(rounded / 60) + ' min left' : 'About ' + rounded + ' sec left');
        detail.textContent = completed + ' / ' + total + ' locations · ' + estimate;
      }
    } catch {
      // Progress is optional. The availability request still finishes independently.
    } finally {
      if (!signal.aborted && current === request) timer = setTimeout(poll, 800);
    }
  }

  timer = setTimeout(poll, 250);
  return () => clearTimeout(timer);
}

let refreshController;
async function render({reset = false} = {}) {
  const current = ++request;
  refreshController?.abort();
  const controller = new AbortController();
  refreshController = controller;
  const days = weekend();
  if (reset) lookup = {};
  drawHead(days);
  drawRows(days);
  if (reset) jump(0);
  id('status').textContent = 'Checking availability…';
  id('refresh').disabled = true;
  const query = '?saturday=' + iso(days[0]);
  const stopWatching = watchRefresh(current, query, controller.signal);
  try {
    const response = await fetch('api/weekend' + query, {signal:controller.signal});
    if (!response.ok) throw new Error('availability unavailable');
    const data = await response.json();
    if (current !== request) return;
    lookup = data.locations;
    drawRows(days);
    const checked = new Date(data.checkedAt).toLocaleTimeString('en-US', {
      timeZone:'America/Los_Angeles', hour:'numeric', minute:'2-digit'
    });
    const failures = data.failed ? ' · ' + data.failed + ' failed' : '';
    const blocked = data.forbidden ? ' (' + data.forbidden + ' denied by Rec.us)' : '';
    if (!data.enabled) {
      id('status').textContent = 'Directory-only mode. Use a park name for the official schedule.';
    } else if (data.loaded) {
      id('status').textContent = data.loaded + ' Rec.us locations returned schedules' + failures + blocked + ' · ' + checked + ' PT';
    } else {
      id('status').textContent = 'Live availability is unavailable' + blocked + '. Use a park name for the official schedule.';
    }
  } catch {
    if (current === request) {
      lookup = {};
      drawRows(days);
      id('status').textContent = 'Live availability is unavailable. Use a park name for the official schedule.';
    }
  } finally {
    controller.abort();
    stopWatching();
    if (current === request) {
      id('refresh-activity').hidden = true;
      id('refresh').disabled = false;
    }
  }
}
for (const key of ['tennis','pickleball','reserve','walk','search','net']) id(key).addEventListener('input', () => {
  id('net-label').hidden = !id('pickleball').checked;
  drawRows(weekend());
});
let distanceRequest;
id('distance-form').addEventListener('submit', async event => {
  event.preventDefault();
  const address = id('address').value.trim();
  if (!address) return;
  distanceRequest?.abort();
  const controller = new AbortController();
  distanceRequest = controller;
  id('sort-distance').disabled = true;
  id('address').readOnly = true;
  id('clear-distance').hidden = false;
  id('distance-status').textContent = 'Looking up address…';
  try {
    const response = await fetch('api/address', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({address}), signal:controller.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (controller.signal.aborted) return;
    origin = result.point;
    drawRows(weekend());
    id('distance-status').textContent = 'Sorted from ' + result.label + '.';
  } catch (error) {
    if (!controller.signal.aborted) {
      id('distance-status').textContent = error.message || 'Address lookup is unavailable.';
    }
  } finally {
    if (!controller.signal.aborted) {
      id('sort-distance').disabled = false;
      id('address').readOnly = false;
    }
  }
});
id('clear-distance').onclick = () => {
  distanceRequest?.abort();
  origin = undefined;
  id('address').value = '';
  id('address').readOnly = false;
  id('sort-distance').disabled = false;
  id('clear-distance').hidden = true;
  id('distance-status').textContent = '';
  drawRows(weekend());
};
id('previous').onclick = () => { offset--; render({reset:true}); };
id('next').onclick = () => { offset++; render({reset:true}); };
id('refresh').onclick = () => render();
id('sat').onclick = () => jump(0);
id('sun').onclick = () => jump(1);
render({reset:true});
