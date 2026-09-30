# Boca Weather

A responsive live-weather web app built for Sean Smith. It defaults to Boca Raton, FL (FAU).

- **Live data** from [Open-Meteo](https://open-meteo.com/). No API key, account, or payment is needed.
- **Greeting** that changes with the viewer's time of day: "Good morning, Sean".
- **Themes**: Light, Dark, and System (follows the device setting). The choice is remembered.
- **Responsive**: works on desktop browsers, tablets, and phones.
- Current conditions: temperature, feels-like, wind (with knots), gusts, humidity, dew point, pressure (inHg / hPa), visibility, cloud cover, UV, sunrise and sunset.
- 24-hour hourly strip and 7-day forecast.
- City search (Open-Meteo geocoding), "My location", and a one-tap return to Boca Raton.
- °F / °C toggle. Auto-refreshes every 10 minutes.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page markup |
| `styles.css` | Styling, theme tokens, responsive layout |
| `app.js` | API calls, rendering, theme, units, search |
| `netlify.toml` | Netlify publish settings and security headers |

## Deploy to Netlify

1. In Netlify, choose **Add new site → Import an existing project → GitHub**, then pick this repo.
2. Branch: `main`. Build command: *(leave empty)*. Publish directory: `.`
3. Deploy. There's nothing to install and no environment variables to set.

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8080
```

Weather data is for general awareness only. Don't use it for flight planning.
