# SF Court Weekend

A weekend grid for San Francisco tennis and pickleball. Court rows show every half-hour of Saturday and Sunday, in Pacific time. Use the sport, access, park, and pickleball net filters to narrow the list. Official court links handle reservation and payment.

## Run locally

Run `node server.js` with Node.js 20 or newer, then open http://127.0.0.1:8787. The dashboard starts in directory mode. It lists courts from the official [tennis](https://recpark.sf.gov/1446/Tennis-Court-Directory) and [pickleball](https://recpark.sf.gov/1772/Pickleball-Court-Directory) directories. Court labels in directory mode are counts, not official court numbers. Dedicated open-play sessions are outside the walk-up filter.

## Live availability

Rec.us uses an undocumented read-only schedule endpoint at `https://api.rec.us/v1/locations/{id}/schedule?startDate=YYYY-MM-DD`. Its [terms](https://www.rec.us/tos) restrict automated data collection. With provider authorization, start the local server using `REC_LIVE=1 node server.js`. The server requests published schedule data directly from Rec.us and shares results for two minutes to limit traffic. The dashboard has no dependency on SF Court Finder.

- Green marks a half-hour covered by a published reservable block after the release window opens. The official booking page determines allowed start times and session lengths.
- Gray means unavailable. White means the server lacks reliable data for that cell. Goldman Tennis Center uses CourtReserve and has an official booking link instead of live status.
- Stripes identify walk-up courts. Park hours, closures and on-site occupancy need to be checked separately.
