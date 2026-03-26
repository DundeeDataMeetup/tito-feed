# tito-feed

Cloudflare Worker that proxies Tito checkout feeds and enriches events with parsed start/end datetimes.

## How it works

- Takes the incoming request path as `<PATH>`.
- Fetches `https://checkout.tito.io/<PATH>.json`.
- Reads events from `events.past`, `events.unscheduled`, and `events.upcoming`.
- Returns one flat JSON array of events.
- For each event URL, fetches the event page and reads the text from `.tito-event-homepage--basic-info-cal`.
- For each event URL, also reads venue details from `.tito-venues`.
- Parses values such as `6–8pm, February 24th, 2026` into:
  - `start_time` in ISO 8601 UTC
  - `end_time` in ISO 8601 UTC
- Sets `location` from the venue text in `.tito-venues`.
- Sets `location_map_url` from the venue block Google Maps anchor (`a[href]`).
- If parsing fails for an event, it still returns that event with:
  - `start_time: null`
  - `end_time: null`
  - `parse_error` with the parse failure reason
- Sorts the final flat list by `start_time` descending/newest-first (events with `null` `start_time` are last).

## Example

Request:

`GET /dundee-data-meetup/feb-2026`

Upstream fetched by the worker:

`https://checkout.tito.io/dundee-data-meetup/feb-2026.json`

Response shape:

```json
[
  {
    "banner_url": "https://...png",
    "location": "CodeBase, Dundee Map",
    "location_map_url": "https://maps.google.com/?q=codebase+dundee",
    "title": "Dundee Data Meetup: March 2026",
    "url": "https://ti.to/dundee-data-meetup/mar-2026",
    "start_time": "2026-03-31T18:30:00.000Z",
    "end_time": "2026-03-31T20:15:00.000Z"
  },
  {
    "banner_url": "https://...png",
    "location": "Bonar Hall, Dundee Map",
    "location_map_url": "https://maps.google.com/?q=bonar+hall",
    "title": "Dundee Data Meetup: February 2026",
    "url": "https://ti.to/dundee-data-meetup/feb-2026",
    "start_time": "2026-02-24T18:00:00.000Z",
    "end_time": "2026-02-24T20:00:00.000Z"
  },
  {
    "banner_url": "https://...png",
    "location": "Dundee, UK",
    "location_map_url": null,
    "title": "Event with missing calendar block",
    "url": "https://ti.to/dundee-data-meetup/apr-2026",
    "start_time": null,
    "end_time": null,
    "parse_error": "Could not find event calendar info block"
  }
]
```

## Run locally

- `npm run dev`

## Test

- `npm test -- --run`
