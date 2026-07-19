/* =============================================================================
   RADAR CONSOLE — script.js
   Pure vanilla JS. Canvas-only rendering, no external libraries.

   Sections:
     1. Constants
     2. State
     3. Utilities
     4. UI
     5. Canvas Renderer
     6. Animation
     7. Events
     8. Resize
     9. Init
   ============================================================================= */

(() => {
  'use strict';

  /* =========================================================================
     1. CONSTANTS
     ========================================================================= */

  const STORAGE_KEY = 'radarConsole.state.v1';   // localStorage key
  const MAX_VALUE = 100;                          // top of the value scale
  const MIN_SKILLS = 3;                           // a polygon needs at least 3 points
  const MAX_SKILLS = 10;                          // keep labels legible
  const GRID_LEVELS = 5;                          // concentric rings drawn on the grid
  const LERP_SPEED = 0.16;                        // per-frame smoothing factor (0-1)
  const HOVER_LERP_SPEED = 0.22;                  // smoothing factor for hover scale
  const HOVER_RADIUS_PX = 16;                     // pointer distance that triggers hover
  const VERTEX_RADIUS = 4.5;                      // resting vertex dot radius (px)
  const VERTEX_RADIUS_HOVER = 8;                  // vertex dot radius while hovered (px)
  const LABEL_PADDING = 34;                       // px beyond the outer ring for name labels
  const CHART_PADDING_RATIO = 0.24;               // fraction of canvas reserved as margin

  const DEFAULT_COLORS = {
    fill: 'rgba(57, 255, 136, 0.28)',
    line: '#39ff88',
    grid: 'rgba(120, 255, 200, 0.28)',
    text: '#cfe8d8',
  };

  const DEFAULT_SKILLS = [
    { name: 'JavaScript', value: 82 },
    { name: 'CSS', value: 74 },
    { name: 'Backend', value: 65 },
    { name: 'DevOps', value: 48 },
    { name: 'Design', value: 58 },
    { name: 'Communication', value: 70 },
  ];

  // Cached DOM references, gathered once at init time.
  const dom = {
    canvas: document.getElementById('radarChart'),
    scope: document.querySelector('.scope'),
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    closePanelBtn: document.getElementById('closePanel'),
    scrim: document.getElementById('scrim'),
    resetBtn: document.getElementById('resetBtn'),
    addSkillBtn: document.getElementById('addSkillBtn'),
    skillsList: document.getElementById('skillsList'),
    colorFields: {
      fill: { picker: document.getElementById('fillColorPicker'), text: document.getElementById('fillColorText') },
      line: { picker: document.getElementById('lineColorPicker'), text: document.getElementById('lineColorText') },
      grid: { picker: document.getElementById('gridColorPicker'), text: document.getElementById('gridColorText') },
      text: { picker: document.getElementById('textColorPicker'), text: document.getElementById('textColorText') },
    },
  };

  const ctx = dom.canvas.getContext('2d');

  /* =========================================================================
     2. STATE
     ========================================================================= */

  // The single source of truth for the widget. `skills[i].value` is the target
  // value driven by the UI; `skills[i].anim` is the smoothed value the renderer
  // actually draws, eased toward `value` every animation frame.
  const state = {
    skills: [],
    colors: { ...DEFAULT_COLORS },
    hoverIndex: -1,          // index of the vertex currently under the pointer, -1 if none
  };

  let uidCounter = 1;
  // Generates a short, collision-free id for a new skill row.
  function nextId() {
    return `s${Date.now().toString(36)}${(uidCounter++).toString(36)}`;
  }

  /* =========================================================================
     3. UTILITIES
     ========================================================================= */

  // Clamp a number between min and max.
  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  // Linear interpolation between a and b by factor t.
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // A single reusable 1x1 canvas used purely to validate/convert CSS color
  // strings. The 2D context's fillStyle setter silently ignores invalid
  // values (it keeps the previous one), which is what we exploit to detect
  // invalid input.
  const swatchCanvas = document.createElement('canvas');
  swatchCanvas.width = 1;
  swatchCanvas.height = 1;
  const swatchCtx = swatchCanvas.getContext('2d');

  // Returns true if `str` is any valid CSS color: hex (#rgb, #rrggbb,
  // #rrggbbaa), rgb(), rgba(), hsl(), hsla(), or a named color. Prefers the
  // native CSS.supports check; falls back to a sentinel round-trip through
  // canvas fillStyle for older browsers that lack it.
  function isValidCssColor(str) {
    if (typeof str !== 'string' || str.trim() === '') return false;
    const value = str.trim();
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
      return CSS.supports('color', value);
    }
    const sentinel = '#010203';
    swatchCtx.fillStyle = sentinel;
    swatchCtx.fillStyle = value;
    return swatchCtx.fillStyle !== sentinel || value.toLowerCase() === sentinel;
  }

  // Converts any valid CSS color string to a plain #rrggbb hex string
  // (alpha is dropped) so it can populate an <input type="color"> swatch.
  function cssColorToHex(str) {
    swatchCtx.clearRect(0, 0, 1, 1);
    swatchCtx.fillStyle = '#000000';
    swatchCtx.fillStyle = str;
    swatchCtx.fillRect(0, 0, 1, 1);
    const [r, g, b] = swatchCtx.getImageData(0, 0, 1, 1).data;
    const toHex = (n) => n.toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // Reads persisted state from localStorage. Returns null if nothing usable
  // is stored (missing, corrupt, or wrong shape).
  function loadPersistedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.skills) || !parsed.colors) return null;
      return parsed;
    } catch (err) {
      console.warn('Radar console: could not read saved state', err);
      return null;
    }
  }

  // Persists the durable parts of state (skill names/values, colors) to
  // localStorage. Called after every user-driven mutation.
  function persistState() {
    try {
      const payload = {
        skills: state.skills.map((s) => ({ id: s.id, name: s.name, value: s.value })),
        colors: state.colors,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('Radar console: could not save state', err);
    }
  }

  /* =========================================================================
     4. UI
     ========================================================================= */

  // Rebuilds the skills list in the settings panel from current state.
  // Called after add/delete, and once at init.
  function renderSkillsList() {
    dom.skillsList.innerHTML = '';
    const canDelete = state.skills.length > MIN_SKILLS;

    state.skills.forEach((skill) => {
      const row = document.createElement('div');
      row.className = 'skill-row';
      row.dataset.id = skill.id;

      const top = document.createElement('div');
      top.className = 'skill-row__top';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'skill-row__name';
      nameInput.value = skill.name;
      nameInput.maxLength = 24;
      nameInput.setAttribute('aria-label', 'Skill name');
      nameInput.addEventListener('input', () => {
        skill.name = nameInput.value || 'Untitled';
        persistState();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'skill-row__delete';
      deleteBtn.setAttribute('aria-label', `Delete ${skill.name}`);
      deleteBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
      deleteBtn.disabled = !canDelete;
      deleteBtn.title = canDelete ? 'Delete skill' : `Keep at least ${MIN_SKILLS} skills`;
      deleteBtn.addEventListener('click', () => deleteSkill(skill.id));

      top.appendChild(nameInput);
      top.appendChild(deleteBtn);

      const bottom = document.createElement('div');
      bottom.className = 'skill-row__bottom';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.className = 'skill-row__slider';
      slider.min = '0';
      slider.max = String(MAX_VALUE);
      slider.value = String(skill.value);
      slider.style.setProperty('--fill-pct', `${skill.value}%`);
      slider.setAttribute('aria-label', `${skill.name} value`);

      const valueLabel = document.createElement('span');
      valueLabel.className = 'skill-row__value';
      valueLabel.textContent = String(skill.value);

      slider.addEventListener('input', () => {
        const v = clamp(parseInt(slider.value, 10) || 0, 0, MAX_VALUE);
        skill.value = v;
        slider.style.setProperty('--fill-pct', `${v}%`);
        valueLabel.textContent = String(v);
        persistState();
      });

      bottom.appendChild(slider);
      bottom.appendChild(valueLabel);

      row.appendChild(top);
      row.appendChild(bottom);
      dom.skillsList.appendChild(row);
    });
  }

  // Adds a new skill with a default name/value, unless the cap has been hit.
  function addSkill() {
    if (state.skills.length >= MAX_SKILLS) return;
    state.skills.push({ id: nextId(), name: 'New Skill', value: 50, anim: 0 });
    renderSkillsList();
    persistState();
  }

  // Removes a skill by id, unless doing so would drop below the minimum
  // needed to draw a polygon.
  function deleteSkill(id) {
    if (state.skills.length <= MIN_SKILLS) return;
    state.skills = state.skills.filter((s) => s.id !== id);
    renderSkillsList();
    persistState();
  }

  // Syncs a color's picker + text input to match state.colors[key], and
  // applies it to the corresponding CSS custom property so the chrome
  // around the canvas (accent buttons, etc.) stays visually consistent.
  function syncColorField(key) {
    const { picker, text } = dom.colorFields[key];
    const value = state.colors[key];
    text.value = value;
    text.classList.remove('is-invalid');
    try {
      picker.value = cssColorToHex(value);
    } catch (err) {
      /* leave the picker at its previous value if conversion fails */
    }
  }

  function syncAllColorFields() {
    Object.keys(dom.colorFields).forEach(syncColorField);
  }

  // Applies the four theme colors as CSS custom properties, used by the
  // glass chrome (buttons, accents) as well as read by the renderer.
  function applyColorsToDocument() {
    const root = document.documentElement.style;
    root.setProperty('--chart-fill', state.colors.fill);
    root.setProperty('--chart-line', state.colors.line);
    root.setProperty('--chart-grid', state.colors.grid);
    root.setProperty('--chart-text', state.colors.text);
    root.setProperty('--accent', state.colors.line);
    root.setProperty('--accent-dim', state.colors.grid);
  }

  // Opens the settings panel and shows the scrim.
  function openPanel() {
    dom.settingsPanel.classList.add('is-open');
    dom.settingsPanel.setAttribute('aria-hidden', 'false');
    dom.scrim.classList.add('is-visible');
    dom.settingsBtn.setAttribute('aria-expanded', 'true');
  }

  // Closes the settings panel and hides the scrim.
  function closePanel() {
    dom.settingsPanel.classList.remove('is-open');
    dom.settingsPanel.setAttribute('aria-hidden', 'true');
    dom.scrim.classList.remove('is-visible');
    dom.settingsBtn.setAttribute('aria-expanded', 'false');
  }

  /* =========================================================================
     5. CANVAS RENDERER
     ========================================================================= */

  // Geometry cache, recomputed on resize and whenever the skill count
  // changes, so per-frame drawing only does trigonometry once per point.
  let geometry = { cx: 0, cy: 0, radius: 0, angles: [] };

  // Recomputes the chart's center point, usable radius, and per-axis angles
  // based on the canvas's current CSS pixel size and skill count.
  function computeGeometry() {
    const rect = dom.canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const radius = Math.min(rect.width, rect.height) * (0.5 - CHART_PADDING_RATIO);
    const n = state.skills.length;
    const angles = [];
    for (let i = 0; i < n; i++) {
      // Start at the top (-90deg) and go clockwise.
      angles.push((-Math.PI / 2) + (i * (2 * Math.PI / n)));
    }
    geometry = { cx, cy, radius, angles };
  }

  // Returns the {x, y} point on axis `i` at a given 0-1 fraction of the
  // chart radius (fraction 1 = outer ring, fraction 0 = center).
  function pointOnAxis(i, fraction) {
    const angle = geometry.angles[i];
    return {
      x: geometry.cx + Math.cos(angle) * geometry.radius * fraction,
      y: geometry.cy + Math.sin(angle) * geometry.radius * fraction,
    };
  }

  // Draws the concentric polygon grid rings and the radial spokes.
  function drawGrid() {
    const n = state.skills.length;
    ctx.strokeStyle = state.colors.grid;
    ctx.lineWidth = 1;

    // Concentric rings, evenly spaced from the center out to the edge.
    for (let level = 1; level <= GRID_LEVELS; level++) {
      const fraction = level / GRID_LEVELS;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const p = pointOnAxis(i, fraction);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Radial spokes from the center to each axis tip.
    for (let i = 0; i < n; i++) {
      const p = pointOnAxis(i, 1);
      ctx.beginPath();
      ctx.moveTo(geometry.cx, geometry.cy);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }

  // Draws the filled/stroked data polygon using each skill's animated
  // (smoothed) value, plus a vertex dot per skill whose radius reacts to
  // hover state.
  function drawDataPolygon() {
    const n = state.skills.length;
    const points = state.skills.map((skill, i) => pointOnAxis(i, clamp(skill.anim, 0, MAX_VALUE) / MAX_VALUE));

    // Fill
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = state.colors.fill;
    ctx.fill();

    // Stroke
    ctx.lineWidth = 2;
    ctx.strokeStyle = state.colors.line;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Vertex dots (radius eases toward the hover radius via `hoverAnim`)
    for (let i = 0; i < n; i++) {
      const p = points[i];
      const skill = state.skills[i];
      const r = lerp(VERTEX_RADIUS, VERTEX_RADIUS_HOVER, skill.hoverAnim || 0);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = state.colors.line;
      ctx.fill();
      if ((skill.hoverAnim || 0) > 0.02) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5 * skill.hoverAnim, 0, Math.PI * 2);
        ctx.strokeStyle = state.colors.line;
        ctx.globalAlpha = 0.35 * skill.hoverAnim;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  // Draws each skill's name beyond the outer ring, and its current value
  // just outside the data vertex.
  function drawLabels() {
    const n = state.skills.length;
    ctx.fillStyle = state.colors.text;
    ctx.font = '600 13px Inter, "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < n; i++) {
      const angle = geometry.angles[i];
      const labelPoint = {
        x: geometry.cx + Math.cos(angle) * (geometry.radius + LABEL_PADDING),
        y: geometry.cy + Math.sin(angle) * (geometry.radius + LABEL_PADDING),
      };

      // Align text away from the chart so labels don't overlap the polygon.
      const cos = Math.cos(angle);
      ctx.textAlign = cos > 0.15 ? 'left' : cos < -0.15 ? 'right' : 'center';

      ctx.fillText(state.skills[i].name, labelPoint.x, labelPoint.y);

      // Value readout, small and dim, just below/above the name.
      ctx.save();
      ctx.font = '600 11px "Share Tech Mono", monospace';
      ctx.globalAlpha = 0.7;
      ctx.fillText(String(Math.round(state.skills[i].anim)), labelPoint.x, labelPoint.y + 16);
      ctx.restore();
    }
  }

  // The full draw pass for a single frame: clear, grid, polygon, labels.
  function render() {
    const rect = dom.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (state.skills.length < MIN_SKILLS) return;
    drawGrid();
    drawDataPolygon();
    drawLabels();
  }

  /* =========================================================================
     6. ANIMATION
     ========================================================================= */

  let rafId = null;

  // Advances every skill's animated value and hover scale a step closer to
  // their targets, then redraws. Runs continuously via requestAnimationFrame;
  // the per-frame cost is trivial for a handful of points so there is no
  // need to pause the loop when idle.
  function tick() {
    state.skills.forEach((skill, i) => {
      // Ease the drawn value toward the user-set target.
      if (skill.anim === undefined) skill.anim = skill.value;
      const valueDiff = skill.value - skill.anim;
      skill.anim = Math.abs(valueDiff) > 0.05 ? skill.anim + valueDiff * LERP_SPEED : skill.value;

      // Ease the vertex's hover scale toward 1 (hovered) or 0 (not).
      if (skill.hoverAnim === undefined) skill.hoverAnim = 0;
      const hoverTarget = i === state.hoverIndex ? 1 : 0;
      const hoverDiff = hoverTarget - skill.hoverAnim;
      skill.hoverAnim = Math.abs(hoverDiff) > 0.01 ? skill.hoverAnim + hoverDiff * HOVER_LERP_SPEED : hoverTarget;
    });

    render();
    rafId = requestAnimationFrame(tick);
  }

  /* =========================================================================
     7. EVENTS
     ========================================================================= */

  // Handles color text-input edits: validates, updates state + CSS vars +
  // the matching picker, and persists. Invalid input is flagged visually
  // without touching state, so a half-typed value doesn't break the chart.
  function handleColorTextInput(key) {
    const { text } = dom.colorFields[key];
    const value = text.value.trim();
    if (!isValidCssColor(value)) {
      text.classList.add('is-invalid');
      return;
    }
    text.classList.remove('is-invalid');
    state.colors[key] = value;
    dom.colorFields[key].picker.value = cssColorToHex(value);
    applyColorsToDocument();
    persistState();
  }

  // Handles native color-picker changes: pickers only produce #rrggbb, so
  // we store that directly and mirror it into the text field.
  function handleColorPickerInput(key) {
    const { picker, text } = dom.colorFields[key];
    state.colors[key] = picker.value;
    text.value = picker.value;
    text.classList.remove('is-invalid');
    applyColorsToDocument();
    persistState();
  }

  // Finds the index of the vertex nearest the pointer, within HOVER_RADIUS_PX,
  // in canvas CSS-pixel coordinates.
  function findHoveredVertex(clientX, clientY) {
    const rect = dom.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let closestIndex = -1;
    let closestDist = HOVER_RADIUS_PX;

    state.skills.forEach((skill, i) => {
      const p = pointOnAxis(i, clamp(skill.anim ?? skill.value, 0, MAX_VALUE) / MAX_VALUE);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < closestDist) {
        closestDist = d;
        closestIndex = i;
      }
    });
    return closestIndex;
  }

  // Wires up every persistent event listener. Called once during init.
  function bindEvents() {
    dom.settingsBtn.addEventListener('click', openPanel);
    dom.closePanelBtn.addEventListener('click', closePanel);
    dom.scrim.addEventListener('click', closePanel);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dom.settingsPanel.classList.contains('is-open')) closePanel();
    });

    dom.addSkillBtn.addEventListener('click', addSkill);

    dom.resetBtn.addEventListener('click', () => {
      state.colors = { ...DEFAULT_COLORS };
      state.skills = DEFAULT_SKILLS.map((s) => ({ id: nextId(), name: s.name, value: s.value, anim: s.value, hoverAnim: 0 }));
      applyColorsToDocument();
      syncAllColorFields();
      renderSkillsList();
      computeGeometry();
      persistState();
    });

    Object.keys(dom.colorFields).forEach((key) => {
      dom.colorFields[key].text.addEventListener('input', () => handleColorTextInput(key));
      dom.colorFields[key].picker.addEventListener('input', () => handleColorPickerInput(key));
    });

    dom.canvas.addEventListener('mousemove', (e) => {
      state.hoverIndex = findHoveredVertex(e.clientX, e.clientY);
      dom.canvas.style.cursor = state.hoverIndex >= 0 ? 'pointer' : 'default';
    });
    dom.canvas.addEventListener('mouseleave', () => {
      state.hoverIndex = -1;
    });
  }

  /* =========================================================================
     8. RESIZE
     ========================================================================= */

  // Resizes the canvas's backing store to match its CSS size at the
  // device's pixel ratio, so drawing stays crisp on HiDPI screens, then
  // recomputes chart geometry for the new dimensions.
  function resizeCanvas() {
    const rect = dom.scope.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    dom.canvas.width = Math.round(rect.width * dpr);
    dom.canvas.height = Math.round(rect.height * dpr);
    dom.canvas.style.width = `${rect.width}px`;
    dom.canvas.style.height = `${rect.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeGeometry();
  }

  /* =========================================================================
     9. INIT
     ========================================================================= */

  // Builds the initial state from localStorage (falling back to defaults),
  // wires up the DOM, sizes the canvas, and starts the animation loop.
  function init() {
    const saved = loadPersistedState();

    if (saved && Array.isArray(saved.skills) && saved.skills.length >= MIN_SKILLS) {
      state.skills = saved.skills.map((s) => ({
        id: s.id || nextId(),
        name: s.name || 'Untitled',
        value: clamp(Number(s.value) || 0, 0, MAX_VALUE),
        anim: clamp(Number(s.value) || 0, 0, MAX_VALUE),
        hoverAnim: 0,
      }));
      state.colors = {
        fill: isValidCssColor(saved.colors.fill) ? saved.colors.fill : DEFAULT_COLORS.fill,
        line: isValidCssColor(saved.colors.line) ? saved.colors.line : DEFAULT_COLORS.line,
        grid: isValidCssColor(saved.colors.grid) ? saved.colors.grid : DEFAULT_COLORS.grid,
        text: isValidCssColor(saved.colors.text) ? saved.colors.text : DEFAULT_COLORS.text,
      };
    } else {
      state.skills = DEFAULT_SKILLS.map((s) => ({ id: nextId(), name: s.name, value: s.value, anim: s.value, hoverAnim: 0 }));
      state.colors = { ...DEFAULT_COLORS };
    }

    applyColorsToDocument();
    syncAllColorFields();
    renderSkillsList();
    bindEvents();

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(resizeCanvas).observe(dom.scope);
    }

    if (rafId) cancelAnimationFrame(rafId);
    tick();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
