/* ============================================================================
   RADAR WIDGET — script.js
   Vanilla ES6, no dependencies. Organized as small isolated modules that are
   composed together at the bottom by RadarApp. No variables are attached to
   the global scope — everything lives inside the module closures below.
   ============================================================================ */

/* ============================================================================
   1. COLOR UTILITIES
   Conversions between HEX / RGB / HSL so the settings panel can accept any
   of the three formats and always resolve back to a canonical hex string.
   ============================================================================ */
const ColorUtil = (() => {

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function hexToRgb(hex) {
    const clean = hex.replace('#', '').trim();
    const full = clean.length === 3
      ? clean.split('').map(c => c + c).join('')
      : clean;
    const num = parseInt(full, 16);
    if (Number.isNaN(num) || full.length !== 6) return null;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function rgbToHex({ r, g, b }) {
    const toHex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }

  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function hslToRgb({ h, s, l }) {
    h /= 360; s /= 100; l /= 100;
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    };
  }

  // Parses "#RRGGBB", "rgb(r,g,b)" or "hsl(h,s%,l%)" strings into a hex string.
  function parseToHex(input) {
    const str = input.trim();
    if (str.startsWith('#')) {
      const rgb = hexToRgb(str);
      return rgb ? rgbToHex(rgb) : null;
    }
    const rgbMatch = str.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (rgbMatch) {
      return rgbToHex({ r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] });
    }
    const hslMatch = str.match(/hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%?[,\s]+([\d.]+)%?/i);
    if (hslMatch) {
      return rgbToHex(hslToRgb({ h: +hslMatch[1], s: +hslMatch[2], l: +hslMatch[3] }));
    }
    return null;
  }

  function hexToString(hex, format) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    if (format === 'rgb') return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    if (format === 'hsl') {
      const hsl = rgbToHsl(rgb);
      return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
    }
    return hex.toUpperCase();
  }

  // Hex string + alpha (0-1) -> "rgba(...)" for canvas fills.
  function hexToRgba(hex, alpha) {
    const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  return { hexToRgb, rgbToHex, rgbToHsl, hslToRgb, parseToHex, hexToString, hexToRgba };
})();

/* ============================================================================
   2. DEFAULT STATE + STORAGE
   Single source of truth for the widget. Persisted to localStorage so the
   embed keeps its data between Notion page loads.
   ============================================================================ */
const StorageService = (() => {
  const characterId =
    new URLSearchParams(window.location.search).get("id") || "default";

  const KEY = `radarWidget.state.${characterId}`;
  function defaultState() {
    return {
      theme: 'light',
      appearance: {
        fill: '#5B5FEF',
        line: '#5B5FEF',
        grid: '#9A9AA5',
        text: '#5B5B66'
      },
      skills: [
        { id: cryptoId(), name: 'Design', value: 82 },
        { id: cryptoId(), name: 'Communication', value: 64 },
        { id: cryptoId(), name: 'Strategy', value: 74 },
        { id: cryptoId(), name: 'Engineering', value: 90 },
        { id: cryptoId(), name: 'Leadership', value: 55 },
        { id: cryptoId(), name: 'Creativity', value: 70 }
      ]
    };
  }

  function cryptoId() {
    return 'sk_' + Math.random().toString(36).slice(2, 10);
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.skills) || parsed.skills.length < 3) return defaultState();
      return parsed;
    } catch (err) {
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      /* storage unavailable (e.g. private mode) — fail silently */
    }
  }

  return { defaultState, load, save, cryptoId };
})();

/* ============================================================================
   3. RADAR CHART ENGINE
   Owns the canvas: high-DPI scaling, resize handling, the render loop with
   spring-eased animation, hover hit-testing, and the actual drawing.
   ============================================================================ */
class RadarChart {
  constructor(canvas, frame) {
    this.canvas = canvas;
    this.frame = frame;
    this.ctx = canvas.getContext('2d');

    this.skills = [];           // { id, name, value }
    this.animated = [];         // current animated 0-100 values, one per skill
    this.appearance = {};

    this.hoverIndex = -1;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.cssWidth = 0;
    this.cssHeight = 0;

    this._bindEvents();
    this._resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /* ---------- public API ---------- */

  setData(skills, appearance) {
    this.appearance = appearance;

    // Keep animated values keyed by id so re-ordering/adding/removing skills
    // doesn't cause existing wedges to jump.
    const prevById = new Map(this.skills.map((s, i) => [s.id, this.animated[i]]));
    this.skills = skills;
    this.animated = skills.map(s => prevById.has(s.id) ? prevById.get(s.id) : 0);
  }

  resize() {
    this._resize();
  }

  /* ---------- internal: sizing ---------- */

  _resize() {
    const rect = this.frame.getBoundingClientRect();
    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.cssWidth * this.dpr);
    this.canvas.height = Math.round(this.cssHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /* ---------- internal: interaction ---------- */

  _bindEvents() {
    this.canvas.addEventListener('mousemove', (e) => this._onPointerMove(e.clientX, e.clientY));
    this.canvas.addEventListener('mouseleave', () => { this.hoverIndex = -1; });
    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches[0]) this._onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    this.canvas.addEventListener('touchend', () => { this.hoverIndex = -1; });
  }

  _onPointerMove(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const geo = this._geometry();
    let closest = -1;
    let closestDist = 26; // px hit radius
    geo.points.forEach((p, i) => {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < closestDist) { closestDist = d; closest = i; }
    });
    this.hoverIndex = closest;
  }

  /* ---------- internal: geometry ---------- */

  _geometry() {
    const n = this.skills.length;
    const cx = this.cssWidth / 2;
    const cy = this.cssHeight / 2;
    const labelPad = Math.max(46, Math.min(this.cssWidth, this.cssHeight) * 0.11);
    const radius = Math.min(this.cssWidth, this.cssHeight) / 2 - labelPad;

    const points = this.skills.map((s, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = radius * (this.animated[i] / 100);
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        angle
      };
    });

    return { cx, cy, radius, points, n };
  }

  /* ---------- internal: animation loop ---------- */

  _loop() {
    // Ease each animated value toward its target skill value.
    let stillMoving = false;
    this.skills.forEach((s, i) => {
      const diff = s.value - this.animated[i];
      if (Math.abs(diff) > 0.05) {
        this.animated[i] += diff * 0.14;
        stillMoving = true;
      } else {
        this.animated[i] = s.value;
      }
    });

    this._draw();
    requestAnimationFrame(this._loop);
  }

  /* ---------- internal: drawing ---------- */

  _draw() {
    const ctx = this.ctx;
    const { cx, cy, radius, points, n } = this._geometry();

    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    if (n < 3) return;

    const rings = 4;

    // --- grid rings ---
    ctx.strokeStyle = this.appearance.grid;
    ctx.lineWidth = 1;
    for (let ring = 1; ring <= rings; ring++) {
      const r = (radius * ring) / rings;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.globalAlpha = ring === rings ? 0.9 : 0.45;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- axis spokes ---
    ctx.strokeStyle = this.appearance.grid;
    ctx.globalAlpha = 0.45;
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- data polygon fill ---
    ctx.beginPath();
    points.forEach((p, i) => { i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    ctx.fillStyle = ColorUtil.hexToRgba(this.appearance.fill, 0.28);
    ctx.fill();

    // --- data polygon stroke ---
    ctx.lineWidth = 2.25;
    ctx.strokeStyle = this.appearance.line;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // --- vertices ---
    points.forEach((p, i) => {
      const isHover = i === this.hoverIndex;
      const r = isHover ? 6.5 : 4;

      if (isHover) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 7, 0, Math.PI * 2);
        ctx.fillStyle = ColorUtil.hexToRgba(this.appearance.line, 0.16);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.appearance.line;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();
    });

    // --- labels ---
    ctx.fillStyle = this.appearance.text;
    ctx.font = `500 ${Math.max(12, radius * 0.052)}px -apple-system, "SF Pro Text", Inter, sans-serif`;
    this.skills.forEach((s, i) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const lx = cx + Math.cos(angle) * (radius + 26);
      const ly = cy + Math.sin(angle) * (radius + 26);

      // Anchor text away from the chart based on which side it falls on,
      // so labels never overlap the polygon or each other.
      const cos = Math.cos(angle);
      ctx.textAlign = Math.abs(cos) < 0.25 ? 'center' : (cos > 0 ? 'left' : 'right');
      const sin = Math.sin(angle);
      ctx.textBaseline = Math.abs(sin) < 0.25 ? 'middle' : (sin > 0 ? 'top' : 'bottom');

      ctx.fillText(s.name, lx, ly);
    });
  }
}

/* ============================================================================
   4. SETTINGS PANEL UI
   Renders the color rows + skill rows from state and wires up every control.
   Talks to the outside world purely through callbacks passed in at creation.
   ============================================================================ */
class SettingsPanel {
  constructor({ colorRowsEl, skillsListEl, skillCountEl, onChange }) {
    this.colorRowsEl = colorRowsEl;
    this.skillsListEl = skillsListEl;
    this.skillCountEl = skillCountEl;
    this.onChange = onChange; // called whenever state should be persisted + redrawn

    this.colorFormats = { fill: 'hex', line: 'hex', grid: 'hex', text: 'hex' };
    this.colorLabels = { fill: 'Fill', line: 'Line', grid: 'Grid', text: 'Text' };
  }

  /* ---------- appearance ---------- */

  renderAppearance(appearance) {
    this.colorRowsEl.innerHTML = '';
    Object.keys(appearance).forEach((key) => {
      this.colorRowsEl.appendChild(this._buildColorRow(key, appearance[key]));
    });
  }

  _buildColorRow(key, hexValue) {
    const row = document.createElement('div');
    row.className = 'color-row';

    const swatchWrap = document.createElement('div');
    swatchWrap.className = 'swatch-wrap';
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = hexValue;
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = hexValue;
    swatchWrap.append(swatch, colorInput);

    const name = document.createElement('span');
    name.className = 'color-name';
    name.textContent = this.colorLabels[key];

    const formatSelect = document.createElement('select');
    formatSelect.className = 'format-select';
    ['hex', 'rgb', 'hsl'].forEach((f) => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f.toUpperCase();
      formatSelect.appendChild(opt);
    });
    formatSelect.value = this.colorFormats[key];

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'color-value';
    valueInput.spellcheck = false;
    valueInput.value = ColorUtil.hexToString(hexValue, this.colorFormats[key]);

    const commit = (hex) => {
      swatch.style.background = hex;
      colorInput.value = hex;
      valueInput.value = ColorUtil.hexToString(hex, formatSelect.value);
      this.onChange({ type: 'appearance', key, value: hex });
    };

    colorInput.addEventListener('input', () => commit(colorInput.value.toUpperCase()));

    formatSelect.addEventListener('change', () => {
      this.colorFormats[key] = formatSelect.value;
      valueInput.value = ColorUtil.hexToString(colorInput.value, formatSelect.value);
    });

    valueInput.addEventListener('change', () => {
      const parsed = ColorUtil.parseToHex(valueInput.value);
      if (parsed) commit(parsed);
      else valueInput.value = ColorUtil.hexToString(colorInput.value, formatSelect.value);
    });

    row.append(swatchWrap, name, formatSelect, valueInput);
    return row;
  }

  /* ---------- skills ---------- */

  renderSkills(skills) {
    this.skillsListEl.innerHTML = '';
    this.skillCountEl.textContent = `${skills.length} / 10`;
    const canDelete = skills.length > 3;

    skills.forEach((skill) => {
      this.skillsListEl.appendChild(this._buildSkillRow(skill, canDelete));
    });
  }

  _buildSkillRow(skill, canDelete) {
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.dataset.id = skill.id;

    // top: name + delete
    const top = document.createElement('div');
    top.className = 'skill-row-top';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'skill-name-input';
    nameInput.value = skill.name;
    nameInput.maxLength = 24;
    nameInput.addEventListener('change', () => {
      this.onChange({ type: 'rename', id: skill.id, value: nameInput.value.trim() || 'Untitled' });
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'skill-delete-btn';
    deleteBtn.disabled = !canDelete;
    deleteBtn.title = canDelete ? 'Delete skill' : 'At least 3 skills required';
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    deleteBtn.addEventListener('click', () => {
      if (!deleteBtn.disabled) this.onChange({ type: 'delete', id: skill.id });
    });

    top.append(nameInput, deleteBtn);

    // bottom: slider + live value
    const bottom = document.createElement('div');
    bottom.className = 'skill-row-bottom';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'skill-slider';
    slider.min = 0;
    slider.max = 100;
    slider.value = skill.value;
    slider.style.setProperty('--_pct', `${skill.value}%`);

    const valueLabel = document.createElement('span');
    valueLabel.className = 'skill-value';
    valueLabel.textContent = skill.value;

    slider.addEventListener('input', () => {
      slider.style.setProperty('--_pct', `${slider.value}%`);
      valueLabel.textContent = slider.value;
      this.onChange({ type: 'value', id: skill.id, value: Number(slider.value) });
    });

    bottom.append(slider, valueLabel);
    row.append(top, bottom);
    return row;
  }
}

/* ============================================================================
   5. APP — wires everything together: state, chart, panel, persistence.
   ============================================================================ */
class RadarApp {
  constructor() {
    this.state = StorageService.load();

    // DOM references
    this.el = {
      canvas: document.getElementById('radarCanvas'),
      frame: document.getElementById('chartFrame'),
      fab: document.getElementById('settingsToggle'),
      panel: document.getElementById('panel'),
      panelClose: document.getElementById('panelClose'),
      scrim: document.getElementById('scrim'),
      themeToggle: document.getElementById('themeToggle'),
      colorRows: document.getElementById('colorRows'),
      skillsList: document.getElementById('skillsList'),
      skillCount: document.getElementById('skillCount'),
      addSkillBtn: document.getElementById('addSkillBtn'),
      randomizeBtn: document.getElementById('randomizeBtn'),
      resetBtn: document.getElementById('resetBtn'),
      exportBtn: document.getElementById('exportBtn'),
      importBtn: document.getElementById('importBtn'),
      importInput: document.getElementById('importInput')
    };

    this.chart = new RadarChart(this.el.canvas, this.el.frame);

    this.panel = new SettingsPanel({
      colorRowsEl: this.el.colorRows,
      skillsListEl: this.el.skillsList,
      skillCountEl: this.el.skillCount,
      onChange: (action) => this._handlePanelChange(action)
    });

    this._applyTheme(this.state.theme, { silent: true });
    this._syncChart();
    this._syncPanel();
    this._bindGlobalEvents();
  }

  /* ---------- state <-> chart/panel sync ---------- */

  _syncChart() {
    this.chart.setData(this.state.skills, this.state.appearance);
  }

  _syncPanel() {
    this.panel.renderAppearance(this.state.appearance);
    this.panel.renderSkills(this.state.skills);
  }

  _persist() {
    StorageService.save(this.state);
  }

  /* ---------- panel action handling ---------- */

  _handlePanelChange(action) {
    switch (action.type) {
      case 'appearance':
        this.state.appearance[action.key] = action.value;
        this.chart.setData(this.state.skills, this.state.appearance);
        break;

      case 'value': {
        const skill = this.state.skills.find(s => s.id === action.id);
        if (skill) skill.value = action.value;
        break;
      }

      case 'rename': {
        const skill = this.state.skills.find(s => s.id === action.id);
        if (skill) {
          skill.name = action.value;
          this.chart.setData(this.state.skills, this.state.appearance);
        }
        break;
      }

      case 'delete':
        this.state.skills = this.state.skills.filter(s => s.id !== action.id);
        this.chart.setData(this.state.skills, this.state.appearance);
        this._syncPanel();
        break;
    }
    this._persist();
  }

  /* ---------- top-level actions ---------- */

  addSkill() {
    if (this.state.skills.length >= 10) return;
    this.state.skills.push({ id: StorageService.cryptoId(), name: 'New skill', value: 50 });
    this._syncChart();
    this._syncPanel();
    this._persist();
  }

  randomize() {
    this.state.skills.forEach(s => { s.value = Math.round(Math.random() * 80) + 20; });
    this._syncPanel();
    this._persist();
  }

  reset() {
    this.state = StorageService.defaultState();
    this._applyTheme(this.state.theme, { silent: true });
    this._syncChart();
    this._syncPanel();
    this._persist();
  }

  exportData() {
    const blob = new Blob([JSON.stringify(this.state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'radar-data.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed.skills) || parsed.skills.length < 3) throw new Error('invalid');
        parsed.skills = parsed.skills.slice(0, 10).map(s => ({
          id: s.id || StorageService.cryptoId(),
          name: String(s.name || 'Skill').slice(0, 24),
          value: Math.min(100, Math.max(0, Number(s.value) || 0))
        }));
        parsed.appearance = { ...StorageService.defaultState().appearance, ...(parsed.appearance || {}) };
        parsed.theme = parsed.theme === 'dark' ? 'dark' : 'light';
        this.state = parsed;
        this._applyTheme(this.state.theme, { silent: true });
        this._syncChart();
        this._syncPanel();
        this._persist();
      } catch (err) {
        alert('That file doesn\'t look like valid radar data.');
      }
    };
    reader.readAsText(file);
  }

  /* ---------- theme ---------- */

  _applyTheme(theme, { silent = false } = {}) {
    document.documentElement.setAttribute('data-theme', theme);
    this.state.theme = theme;
    if (!silent) this._persist();
  }

  toggleTheme() {
    this._applyTheme(this.state.theme === 'dark' ? 'light' : 'dark');
  }

  /* ---------- panel open/close ---------- */

  openPanel() {
    this.el.panel.classList.add('open');
    this.el.panel.setAttribute('aria-hidden', 'false');
    this.el.scrim.classList.add('visible');
    this.el.fab.classList.add('is-active');
    this.el.fab.setAttribute('aria-expanded', 'true');
  }

  closePanel() {
    this.el.panel.classList.remove('open');
    this.el.panel.setAttribute('aria-hidden', 'true');
    this.el.scrim.classList.remove('visible');
    this.el.fab.classList.remove('is-active');
    this.el.fab.setAttribute('aria-expanded', 'false');
  }

  togglePanel() {
    this.el.panel.classList.contains('open') ? this.closePanel() : this.openPanel();
  }

  /* ---------- global event wiring ---------- */

  _bindGlobalEvents() {
    this.el.fab.addEventListener('click', () => this.togglePanel());
    this.el.panelClose.addEventListener('click', () => this.closePanel());
    this.el.scrim.addEventListener('click', () => this.closePanel());
    this.el.themeToggle.addEventListener('click', () => this.toggleTheme());

    this.el.addSkillBtn.addEventListener('click', () => this.addSkill());
    this.el.randomizeBtn.addEventListener('click', () => this.randomize());
    this.el.resetBtn.addEventListener('click', () => {
      if (confirm('Reset to the default skills and colors?')) this.reset();
    });
    this.el.exportBtn.addEventListener('click', () => this.exportData());
    this.el.importBtn.addEventListener('click', () => this.el.importInput.click());
    this.el.importInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.importData(file);
      this.el.importInput.value = '';
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closePanel();
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => this.chart.resize(), 80);
    });

    // ResizeObserver catches container-driven size changes (e.g. Notion
    // reflowing the embed) that a plain window resize wouldn't fire.
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => this.chart.resize()).observe(this.el.frame);
    }
  }
}

/* ============================================================================
   BOOTSTRAP
   ============================================================================ */
document.addEventListener('DOMContentLoaded', () => {
  new RadarApp();
});
