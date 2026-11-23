# SF Court Weekend

A weekend grid for San Francisco tennis and pickleball. Court rows show half-hour slots on Saturday and Sunday, in Pacific time. Use the sport, access, park, and pickleball net filters to narrow the list. Official court links handle reservation and payment.

Each day runs from one hour before estimated San Francisco sunrise to one hour after sunset. The first and last cells can be shorter than 30 minutes. Sport and access are independently selectable.

Submit a complete U.S. street address to sort locations by straight-line distance in kilometres. The local server sends the address to the U.S. Census Geocoder on submission. The app does not persist it. Park coordinates come from the [city park locations layer](https://services2.arcgis.com/I9cUOJUZvdGAJncI/ArcGIS/rest/services/Parks_and_Recreation_San_Francisco/FeatureServer/0) and OpenStreetMap for Goldman Tennis Center.

## Run locally

Run `node server.js` with Node.js 20 or newer, then open http://127.0.0.1:8787. The dashboard lists courts from the official [tennis](https://recpark.sf.gov/1446/Tennis-Court-Directory) and [pickleball](https://recpark.sf.gov/1772/Pickleball-Court-Directory) directories. Where no provider court number is available, the row labels use directory counts. Dedicated open-play sessions are outside the walk-up filter.

## Live availability

Rec.us uses an undocumented read-only schedule endpoint at `https://api.rec.us/v1/locations/{id}/schedule?startDate=YYYY-MM-DD`. The local server queries Rec.us by default and caches each weekend for two minutes. Run `REC_LIVE=0 node server.js` for directory-only mode. Rec.us may reject direct requests, in which case affected cells show as unknown. Its [terms](https://www.rec.us/tos) restrict automated data collection. The dashboard has no dependency on SF Court Finder.

- Green marks a half-hour covered by a published reservable block after the release window opens. The official booking page determines allowed start times and session lengths.
- Gray means unavailable. White means the server lacks reliable data for that cell. Goldman Tennis Center uses CourtReserve and has an official booking link instead of live status.
- Stripes identify walk-up courts. Park hours, closures and on-site occupancy need to be checked separately.
