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
  const sportFilter = id('sport').value;
  const access = id('access').value;
  return parks.filter(park => park.name.toLowerCase().includes(search)).flatMap(park =>
    sports.filter(sport => sportFilter === 'all' || sportFilter === sport).flatMap(sport => {
      const info = park[sport];
      if (!info || (sportFilter === 'pickleball' && id('net').checked && info.nets !== 'provided')) return [];
      const result = [];
      if (access !== 'walk' && info.reserve) {
        const live = (lookup[park.slug] ?? []).filter(court => court.datesBySport[sport]);
        for (const court of live) result.push({ title:court.name, dates:court.datesBySport[sport], mode:'reserve' });
        for (let n = live.length; n < info.reserve; n++) {
          result.push({ title:'Listed reservable court ' + (n + 1), dates:{}, mode:'reserve' });
        }
      }
      if (access !== 'reserve') {
        for (let n = 1; n <= info.walk; n++) result.push({ title:'Walk-up court ' + n, dates:{}, mode:'walk' });
      }
      return result.map(row => ({...row, park, sport, nets:info.nets}));
    }));
}

function drawHead(days) {
  id('weekend').textContent = dateLabel.formatRange(...days);
  id('previous').disabled = offset === 0;
  id('next').disabled = offset === 1;
  const dates = days.map((date,index) =>
    '<th scope="colgroup" colspan="48">' + (index ? 'Sunday' : 'Saturday') + ' · ' + dateLabel.format(date) + '</th>');
  const timesOfDay = days.flatMap((_,index) => times.map(minute =>
    '<th scope="col"' + (minute === 420 ? ' id="day-' + index + '"' : '') +
    (index && !minute ? ' class="day-start"' : '') + '>' +
    time(minute).replace(':00', '').replace(' ', '') + '</th>'));
  id('head').innerHTML = '<tr><th class="row-name" rowspan="2" scope="col">Park / court</th>' +
    dates.join('') + '</tr><tr>' + timesOfDay.join('') + '</tr>';
}

function drawRows(days) {
  id('body').innerHTML = rows().map(row => {
    const url = row.mode === 'reserve' ? booking(row.park) : directories[row.sport];
    const sport = row.sport === 'tennis' ? 'Tennis' : 'Pickleball';
    const nets = {provided:' · Nets provided',bring:' · Check / bring net',loan:' · Net lending hours'}[row.nets] ?? '';
    return '<tr><th class="row-name" scope="row"><a href="' + url + '" target="_blank" rel="noopener">' +
      escape(row.park.name) + '</a><small>' + escape(sport + ' · ' + row.title + nets) + '</small></th>' +
      days.flatMap((date,index) => times.map((minute,slot) => {
        const state = row.mode === 'walk' ? 'walk' : (row.dates[iso(date)]?.[slot] ?? 'unknown');
        const label = {free:'Available to reserve',closed:'Unavailable',unknown:'Availability unknown',walk:'Walk-up, check hours and occupancy'}[state] ?? 'Availability unknown';
        const detail = iso(date) + ' ' + time(minute) + ' · ' + label;
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

async function render({reset = false} = {}) {
  const current = ++request;
  const days = weekend();
  if (reset) lookup = {};
  drawHead(days);
  drawRows(days);
  if (reset) jump(0);
  id('status').textContent = 'Checking availability…';
  try {
    const response = await fetch('api/weekend?saturday=' + iso(days[0]));
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
  }
}
for (const key of ['sport','access','search','net']) id(key).addEventListener('input', () => {
  id('net-label').hidden = id('sport').value !== 'pickleball';
  drawRows(weekend());
});
id('previous').onclick = () => { offset--; render({reset:true}); };
id('next').onclick = () => { offset++; render({reset:true}); };
id('refresh').onclick = () => render();
id('sat').onclick = () => jump(0);
id('sun').onclick = () => jump(1);
render({reset:true});
