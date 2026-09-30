(function () {
  'use strict';

  // ---------- Config ----------
  var USER_NAME = 'Sean';
  var DEFAULT_LOCATION = {
    name: 'Boca Raton',
    admin: 'Florida',
    country: 'United States',
    latitude: 26.3683,
    longitude: -80.1289
  };
  var FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  var GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
  var REFRESH_MS = 10 * 60 * 1000;

  // WMO weather interpretation codes -> [description, day icon, night icon]
  var WMO = {
    0: ['Clear sky', '☀️', '🌙'],
    1: ['Mainly clear', '🌤️', '🌙'],
    2: ['Partly cloudy', '⛅', '☁️'],
    3: ['Overcast', '☁️', '☁️'],
    45: ['Fog', '🌫️', '🌫️'],
    48: ['Depositing rime fog', '🌫️', '🌫️'],
    51: ['Light drizzle', '🌦️', '🌧️'],
    53: ['Drizzle', '🌦️', '🌧️'],
    55: ['Dense drizzle', '🌧️', '🌧️'],
    56: ['Light freezing drizzle', '🌧️', '🌧️'],
    57: ['Freezing drizzle', '🌧️', '🌧️'],
    61: ['Light rain', '🌦️', '🌧️'],
    63: ['Rain', '🌧️', '🌧️'],
    65: ['Heavy rain', '🌧️', '🌧️'],
    66: ['Light freezing rain', '🌧️', '🌧️'],
    67: ['Freezing rain', '🌧️', '🌧️'],
    71: ['Light snow', '🌨️', '🌨️'],
    73: ['Snow', '🌨️', '🌨️'],
    75: ['Heavy snow', '❄️', '❄️'],
    77: ['Snow grains', '🌨️', '🌨️'],
    80: ['Light showers', '🌦️', '🌧️'],
    81: ['Showers', '🌧️', '🌧️'],
    82: ['Violent showers', '⛈️', '⛈️'],
    85: ['Light snow showers', '🌨️', '🌨️'],
    86: ['Snow showers', '🌨️', '🌨️'],
    95: ['Thunderstorm', '⛈️', '⛈️'],
    96: ['Thunderstorm with hail', '⛈️', '⛈️'],
    99: ['Severe thunderstorm with hail', '⛈️', '⛈️']
  };

  // ---------- State ----------
  var state = {
    location: load('location', DEFAULT_LOCATION),
    units: load('units', 'imperial'),
    data: null,
    timer: null,
    lastFetch: 0,
    requestId: 0
  };

  // ---------- Helpers ----------
  function $(id) { return document.getElementById(id); }

  function load(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function wmo(code, isDay) {
    var w = WMO[code] || ['Unknown', '🌡️', '🌡️'];
    return { desc: w[0], icon: isDay === 0 ? w[2] : w[1] };
  }

  function round(n) { return n == null || isNaN(n) ? '--' : Math.round(n); }

  function cardinal(deg) {
    if (deg == null) return '';
    var dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  // Open-Meteo returns local times as "YYYY-MM-DDTHH:MM" in the location's timezone.
  // Parse them as wall-clock values so display is always in the location's local time.
  function parseLocal(iso) {
    var p = iso.split(/[-T:]/).map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0));
  }

  function fmtTime(iso, opts) {
    return parseLocal(iso).toLocaleTimeString([], Object.assign({ timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }, opts));
  }

  function fmtHour(iso) {
    return parseLocal(iso).toLocaleTimeString([], { timeZone: 'UTC', hour: 'numeric' });
  }

  function fmtDay(iso, i) {
    if (i === 0) return 'Today';
    return parseLocal(iso).toLocaleDateString([], { timeZone: 'UTC', weekday: 'short' });
  }

  function locationLabel(loc) {
    return [loc.name, loc.admin || loc.country].filter(Boolean).join(', ');
  }

  function setStatus(msg, isError) {
    var el = $('status');
    if (!msg) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle('error', !!isError);
  }

  // ---------- Greeting ----------
  function greetingWord() {
    var h = new Date().getHours();
    if (h < 5) return 'Good evening';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function renderGreeting() {
    $('greeting').textContent = greetingWord() + ', ' + USER_NAME + ' 👋';
    var d = state.data;
    if (!d) {
      $('greeting-sub').textContent = 'Welcome to your weather dashboard. Pulling live conditions now…';
      return;
    }
    var w = wmo(d.current.weather_code, d.current.is_day);
    var unit = state.units === 'imperial' ? '°F' : '°C';
    $('greeting-sub').textContent =
      'Welcome back. It\'s ' + round(d.current.temperature_2m) + unit + ' and ' +
      w.desc.toLowerCase() + ' in ' + state.location.name + ' right now.';
  }

  // ---------- Theme ----------
  function applyTheme(choice) {
    var root = document.documentElement;
    if (choice === 'light' || choice === 'dark') root.setAttribute('data-theme', choice);
    else root.removeAttribute('data-theme');
    try { localStorage.setItem('theme', choice); } catch (e) {}

    document.querySelectorAll('[data-theme-choice]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-theme-choice') === choice));
    });
    updateThemeColor();
  }

  function updateThemeColor() {
    var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta && bg) meta.setAttribute('content', bg);
  }

  function initTheme() {
    var saved = 'system';
    try { saved = localStorage.getItem('theme') || 'system'; } catch (e) {}
    applyTheme(saved);

    document.querySelectorAll('[data-theme-choice]').forEach(function (b) {
      b.addEventListener('click', function () { applyTheme(b.getAttribute('data-theme-choice')); });
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onChange = function () { updateThemeColor(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  // ---------- Units ----------
  function initUnits() {
    document.querySelectorAll('[data-unit]').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-unit') === state.units));
      b.addEventListener('click', function () {
        var u = b.getAttribute('data-unit');
        if (u === state.units) return;
        state.units = u;
        save('units', u);
        document.querySelectorAll('[data-unit]').forEach(function (x) {
          x.setAttribute('aria-checked', String(x === b));
        });
        fetchWeather();
      });
    });
  }

  // ---------- Data ----------
  function fetchWeather() {
    var loc = state.location;
    var imperial = state.units === 'imperial';
    var params = new URLSearchParams({
      latitude: loc.latitude,
      longitude: loc.longitude,
      current: [
        'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'is_day',
        'precipitation', 'weather_code', 'cloud_cover', 'pressure_msl',
        'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
        'dew_point_2m', 'visibility', 'uv_index'
      ].join(','),
      hourly: ['temperature_2m', 'weather_code', 'precipitation_probability', 'is_day'].join(','),
      daily: [
        'weather_code', 'temperature_2m_max', 'temperature_2m_min',
        'precipitation_probability_max', 'sunrise', 'sunset'
      ].join(','),
      temperature_unit: imperial ? 'fahrenheit' : 'celsius',
      wind_speed_unit: imperial ? 'mph' : 'kmh',
      precipitation_unit: imperial ? 'inch' : 'mm',
      timezone: 'auto',
      forecast_days: 7
    });

    var id = ++state.requestId;
    var btn = $('btn-refresh');
    btn.disabled = true;
    btn.classList.add('spinning');

    return fetch(FORECAST_URL + '?' + params.toString())
      .then(function (r) {
        if (!r.ok) throw new Error('Weather service returned ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (id !== state.requestId) return; // a newer request superseded this one
        state.data = data;
        state.lastFetch = Date.now();
        setStatus(null);
        render();
      })
      .catch(function (err) {
        if (id !== state.requestId) return;
        setStatus('Could not load weather data (' + err.message + '). Retrying on next refresh.', true);
      })
      .then(function () {
        if (id !== state.requestId) return;
        btn.disabled = false;
        btn.classList.remove('spinning');
        scheduleRefresh();
      });
  }

  function scheduleRefresh() {
    clearTimeout(state.timer);
    state.timer = setTimeout(fetchWeather, REFRESH_MS);
  }

  // ---------- Rendering ----------
  function render() {
    var d = state.data;
    var c = d.current;
    var u = d.current_units;
    var imperial = state.units === 'imperial';
    var speedUnit = imperial ? 'mph' : 'km/h';
    var w = wmo(c.weather_code, c.is_day);

    document.title = round(c.temperature_2m) + '° ' + state.location.name + ' · Boca Weather';

    $('loc-name').textContent = locationLabel(state.location);
    $('loc-time').textContent = 'Local time ' + fmtTime(c.time, { weekday: 'long' }) + ' · ' + (d.timezone_abbreviation || d.timezone);
    $('cur-icon').textContent = w.icon;
    $('cur-temp').textContent = round(c.temperature_2m);
    $('cur-unit').textContent = imperial ? '°F' : '°C';
    $('cur-desc').textContent = w.desc;
    $('cur-feels').textContent = round(c.apparent_temperature) + '°';
    $('cur-hi').textContent = round(d.daily.temperature_2m_max[0]) + '°';
    $('cur-lo').textContent = round(d.daily.temperature_2m_min[0]) + '°';

    // Wind: also show knots, since that's how pilots think about it.
    var toKt = imperial ? 0.868976 : 0.539957;
    $('m-wind').textContent = round(c.wind_speed_10m) + ' ' + speedUnit +
      ' ' + cardinal(c.wind_direction_10m) + ' (' + round(c.wind_direction_10m) + '°) · ' +
      round(c.wind_speed_10m * toKt) + ' kt';
    $('m-gusts').textContent = round(c.wind_gusts_10m) + ' ' + speedUnit +
      ' · ' + round(c.wind_gusts_10m * toKt) + ' kt';
    $('m-humidity').textContent = round(c.relative_humidity_2m) + '%';
    $('m-dew').textContent = round(c.dew_point_2m) + '°';

    // Pressure is always hPa from the API; show inHg for imperial.
    $('m-pressure').textContent = imperial
      ? (c.pressure_msl * 0.0295300).toFixed(2) + ' inHg'
      : round(c.pressure_msl) + ' hPa';

    // Visibility unit varies (m or ft) depending on the unit system requested.
    var visMeters = u.visibility === 'ft' ? c.visibility * 0.3048 : c.visibility;
    $('m-vis').textContent = imperial
      ? formatVis(visMeters / 1609.344) + ' mi'
      : formatVis(visMeters / 1000) + ' km';

    $('m-cloud').textContent = round(c.cloud_cover) + '%';
    $('m-uv').textContent = c.uv_index == null ? '--' : c.uv_index.toFixed(1) + ' ' + uvLabel(c.uv_index);
    $('m-sunrise').textContent = fmtTime(d.daily.sunrise[0]);
    $('m-sunset').textContent = fmtTime(d.daily.sunset[0]);

    renderHourly(d);
    renderDaily(d);
    renderGreeting();

    $('updated').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function formatVis(v) {
    if (v == null || isNaN(v)) return '--';
    return v >= 10 ? '10+' : v.toFixed(1);
  }

  function uvLabel(uv) {
    if (uv < 3) return '(Low)';
    if (uv < 6) return '(Moderate)';
    if (uv < 8) return '(High)';
    if (uv < 11) return '(Very high)';
    return '(Extreme)';
  }

  function renderHourly(d) {
    var h = d.hourly;
    var nowHour = d.current.time.slice(0, 13); // "YYYY-MM-DDTHH"
    var start = 0;
    for (var i = 0; i < h.time.length; i++) {
      if (h.time[i].slice(0, 13) >= nowHour) { start = i; break; }
    }

    var el = $('hourly');
    el.textContent = '';
    for (var j = start; j < Math.min(start + 24, h.time.length); j++) {
      var w = wmo(h.weather_code[j], h.is_day[j]);
      var pop = h.precipitation_probability[j];

      var cell = document.createElement('div');
      cell.className = 'hour' + (j === start ? ' now' : '');
      cell.title = w.desc;
      cell.appendChild(span('h-time', j === start ? 'Now' : fmtHour(h.time[j])));
      cell.appendChild(span('h-icon', w.icon));
      cell.appendChild(span('h-temp', round(h.temperature_2m[j]) + '°'));
      cell.appendChild(span('h-pop', pop ? pop + '%' : ''));
      el.appendChild(cell);
    }
    el.scrollLeft = 0;
  }

  function renderDaily(d) {
    var dl = d.daily;
    var lo = Math.min.apply(null, dl.temperature_2m_min);
    var hi = Math.max.apply(null, dl.temperature_2m_max);
    var span_ = Math.max(hi - lo, 1);

    var el = $('daily');
    el.textContent = '';
    for (var i = 0; i < dl.time.length; i++) {
      var w = wmo(dl.weather_code[i], 1);
      var pop = dl.precipitation_probability_max[i];
      var li = document.createElement('li');
      li.className = 'day';
      li.title = w.desc;

      li.appendChild(span('d-name', fmtDay(dl.time[i], i)));
      li.appendChild(span('d-icon', w.icon));
      li.appendChild(span('d-pop', pop ? pop + '%' : ''));

      var range = document.createElement('div');
      range.className = 'd-range';
      range.appendChild(span('d-lo', round(dl.temperature_2m_min[i]) + '°'));
      var bar = document.createElement('div');
      bar.className = 'bar';
      var fill = document.createElement('span');
      fill.style.left = ((dl.temperature_2m_min[i] - lo) / span_ * 100) + '%';
      fill.style.right = ((hi - dl.temperature_2m_max[i]) / span_ * 100) + '%';
      bar.appendChild(fill);
      range.appendChild(bar);
      li.appendChild(range);

      li.appendChild(span('d-hi', round(dl.temperature_2m_max[i]) + '°'));
      el.appendChild(li);
    }
  }

  function span(cls, text) {
    var s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  // ---------- Location ----------
  function setLocation(loc) {
    state.location = loc;
    save('location', loc);
    $('loc-name').textContent = locationLabel(loc);
    fetchWeather();
  }

  function initSearch() {
    var form = $('search-form');
    var input = $('search-input');
    var list = $('search-results');
    var debounce;

    function close() { list.hidden = true; list.textContent = ''; }

    function search(q) {
      if (q.length < 2) { close(); return; }
      var params = new URLSearchParams({ name: q, count: 8, language: 'en', format: 'json' });
      fetch(GEOCODE_URL + '?' + params.toString())
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (input.value.trim() !== q) return;
          list.textContent = '';
          var results = res.results || [];
          if (!results.length) {
            var li = document.createElement('li');
            li.className = 'empty';
            li.textContent = 'No matches for "' + q + '"';
            list.appendChild(li);
          }
          results.forEach(function (r) {
            var li = document.createElement('li');
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'option');
            b.appendChild(document.createTextNode(r.name));
            b.appendChild(span('sub', [r.admin1, r.country].filter(Boolean).join(', ')));
            b.addEventListener('click', function () {
              setLocation({
                name: r.name,
                admin: r.admin1 || '',
                country: r.country || '',
                latitude: r.latitude,
                longitude: r.longitude
              });
              input.value = '';
              close();
            });
            li.appendChild(b);
            list.appendChild(li);
          });
          list.hidden = false;
        })
        .catch(function () { close(); setStatus('Location search is unavailable right now.', true); });
    }

    input.addEventListener('input', function () {
      clearTimeout(debounce);
      var q = input.value.trim();
      debounce = setTimeout(function () { search(q); }, 300);
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var first = list.querySelector('button');
      if (!list.hidden && first) first.click();
      else search(input.value.trim());
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowDown') {
        var first = list.querySelector('button');
        if (first) { e.preventDefault(); first.focus(); }
      }
    });

    list.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(list.querySelectorAll('button'));
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : input).focus(); }
      if (e.key === 'Escape') { close(); input.focus(); }
    });

    document.addEventListener('click', function (e) {
      if (!form.contains(e.target)) close();
    });
  }

  function initButtons() {
    $('btn-home').addEventListener('click', function () { setLocation(DEFAULT_LOCATION); });
    $('btn-refresh').addEventListener('click', function () { fetchWeather(); });

    var locate = $('btn-locate');
    if (!('geolocation' in navigator)) { locate.hidden = true; return; }
    locate.addEventListener('click', function () {
      locate.disabled = true;
      setStatus('Finding your location…');
      navigator.geolocation.getCurrentPosition(function (pos) {
        locate.disabled = false;
        setLocation({
          name: 'My location',
          admin: pos.coords.latitude.toFixed(2) + ', ' + pos.coords.longitude.toFixed(2),
          country: '',
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        });
      }, function (err) {
        locate.disabled = false;
        setStatus('Could not get your location: ' + err.message, true);
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    });
  }

  // Refresh when the tab becomes visible again after being in the background.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !state.data) return;
    var age = Date.now() - (state.lastFetch || 0);
    if (age > REFRESH_MS) fetchWeather();
  });

  // ---------- Boot ----------
  initTheme();
  initUnits();
  initSearch();
  initButtons();
  renderGreeting();
  $('loc-name').textContent = locationLabel(state.location);
  fetchWeather();
  setInterval(renderGreeting, 60 * 1000);
})();
