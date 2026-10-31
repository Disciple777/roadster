// editor.js — the obstacle-course editor. A course is a list of items ({t, s, p}) on one of the circuits (see
// course.js); here players lay them out over the real 3D street seen from above, with a flat "unrolled" strip of the
// lap underneath (along the road → right, across it → up). Courses are kept in this browser, can be shared by code,
// and test-driven straight from the editor. Race control (Ctrl+Alt+Shift+O + passkey) edits the official courses.
(function () {
  const T = THREE;
  const $ = (id) => document.getElementById(id);
  const MAX_ITEMS = 600;
  const CAT_COL = { set: '#ffc21a', obs: '#ff7a3a', jump: '#5fd4ff', haz: '#ff3a4c', pick: '#6dffa8' };
  const TRACK_NAME = { city: 'DOWNTOWN', highway: 'EXPRESSWAY' };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const cleanName = (t, f) => String(t || '').replace(/[^\w \-.!?'#&]/g, '').trim().slice(0, 24).toUpperCase() || f;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const firstLat = (t) => { const d = G.PIECES[t]; const q = d && d.params.find((x) => x[2] === 'lat'); return q ? q[0] : null; };

  class Editor {
    constructor(game) {
      this.game = game;
      this.def = null; this.sel = -1; this.tool = null; this.undoStack = [];
      this.camS = 60; this.zoom = 1; this.fp = []; this.hover = null; this.drag = null;
      try { this.adminKey = sessionStorage.getItem('rt-ak') || ''; } catch (e) { this.adminKey = ''; }
      this.ray = new T.Raycaster(); this.plane = new T.Plane(new T.Vector3(0, 1, 0), 0);
      this.v2 = new T.Vector2(); this.v3 = new T.Vector3(); this.nq = {}; this.sq = {};
      this.wireHome();
      this.wireAdmin();
      this.wireEditor();
    }

    // ---------------- storage ----------------
    mine() { const l = G.store.get('myCourses', []); return Array.isArray(l) ? l : []; }
    saveMine(def) {
      const l = this.mine().filter((c) => c.id !== def.id);
      l.unshift({ id: def.id, name: def.name, track: def.track, items: def.items, code: def.code, updated: Date.now() });
      G.store.set('myCourses', l);
    }

    // ---------------- the courses panel ----------------
    wireHome() {
      const g = this.game;
      this.newTrack = G.TRACK_ID; this.newBase = 'blank';
      const seg = (id, key) => {
        const el = $(id), set = () => el.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.v === this[key]));
        el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { this[key] = b.dataset.v; set(); }));
        set();
      };
      seg('c-track', 'newTrack'); seg('c-base', 'newBase');
      for (const id of ['c-name', 'c-code', 'a-key', 'ed-name']) $(id).addEventListener('keydown', (e) => e.stopPropagation());
      $('c-new').addEventListener('click', () => {
        const n = this.mine().length + 1;
        const def = { id: newId(), name: cleanName($('c-name').value, 'MY COURSE ' + n), track: this.newTrack, items: [] };
        if (this.newBase === 'official') { def.items = null; def.base = 'official'; }
        $('c-name').value = '';
        this.open(def);
      });
      const play = () => {
        const code = $('c-code').value.trim().toUpperCase();
        if (!/^[A-Z0-9]{5}$/.test(code)) { this.status('c-status', 'Course codes are 5 letters and numbers.', true); return; }
        this.playCode(code);
      };
      $('c-play').addEventListener('click', play);
      $('c-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
      // list buttons (rows are rebuilt, so one listener on each list)
      $('c-mine').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-a]');
        if (!b) return;
        const c = this.mine().find((x) => x.id === b.dataset.id);
        if (!c) return;
        if (b.dataset.a === 'edit') this.open(clone(c));
        else if (b.dataset.a === 'play') this.play(clone(c));
        else if (b.dataset.a === 'share') this.share(c);
        else if (b.dataset.a === 'del' && confirm(`Delete "${c.name}"? This can't be undone.`)) {
          G.store.set('myCourses', this.mine().filter((x) => x.id !== c.id));
          this.renderMine();
        }
      });
      $('c-comm').addEventListener('click', (e) => { const b = e.target.closest('button[data-code]'); if (b) this.playCode(b.dataset.code); });
    }
    status(id, text, err) { const el = $(id); el.textContent = text || ''; el.classList.toggle('err', !!err); }

    home() {
      this.status('c-status', '');
      this.game.showPanel('courses');
      this.renderMine();
      this.loadCommunity('c-comm', false);
    }
    renderMine() {
      const l = this.mine();
      $('c-mine').innerHTML = l.length ? l.map((c) => `<div class="row"><span class="n">${esc(c.name)}<small>${TRACK_NAME[c.track] || ''} · ${(c.items || []).length} pieces${c.code ? ' · CODE ' + esc(c.code) : ''}</small></span>` +
        `<button data-a="play" data-id="${c.id}">PLAY</button><button data-a="edit" data-id="${c.id}">EDIT</button><button data-a="share" data-id="${c.id}">SHARE</button><button class="x" data-a="del" data-id="${c.id}" title="Delete">✕</button></div>`).join('')
        : '<div class="hint">No courses yet. Make one below!</div>';
    }
    loadCommunity(id, admin) {
      const el = $(id);
      el.innerHTML = '<div class="hint">Loading…</div>';
      G.api.sharedList().then((r) => {
        const rows = r.rows || [];
        el.innerHTML = rows.length ? rows.map((c) => `<div class="row"><span class="n">${esc(c.name)}<small>${esc(c.author)} · ${TRACK_NAME[c.track] || ''} · ${c.n} pieces · ${c.plays} plays · ${esc(c.code)}</small></span>` +
          (admin ? `<button class="x" data-del="${esc(c.code)}">DELETE</button>` : `<button data-code="${esc(c.code)}">PLAY</button>`) + '</div>').join('')
          : '<div class="hint">No shared courses yet: be the first!</div>';
      }).catch(() => { el.innerHTML = '<div class="hint">Community courses are offline right now.</div>'; });
    }
    share(c) {
      if (!(c.items || []).length) { this.status('c-status', 'Add some pieces before sharing.', true); return; }
      this.status('c-status', 'Sharing…');
      G.api.share({ name: this.game.settings.mpName, cname: c.name, track: c.track, items: c.items, cid: c.id }).then((r) => {
        const l = this.mine(), m = l.find((x) => x.id === c.id);
        if (m) { m.code = r.code; G.store.set('myCourses', l); }
        try { navigator.clipboard.writeText(r.code); } catch (e) { /* ignore */ }
        this.status('c-status', `Shared! Course code ${r.code} (copied). Friends enter it under PLAY A SHARED COURSE.`);
        this.renderMine(); this.loadCommunity('c-comm', false);
      }).catch((e) => this.status('c-status', /429|limit/i.test(e.message) ? 'Sharing limit reached for today.' : 'Could not share: ' + e.message, true));
    }
    playCode(code) {
      this.status('c-status', 'Loading course ' + code + '…');
      G.api.shared(code).then((r) => {
        const c = r.course;
        this.play({ id: 's_' + c.code, name: c.name, track: c.track, items: c.items, author: c.author });
      }).catch(() => this.status('c-status', 'No course with code ' + code + '.', true));
    }

    // another circuit means a fresh page: remember what to open and reload
    reloadInto(o) {
      const g = this.game;
      try { sessionStorage.setItem('rt-course', JSON.stringify(o)); } catch (e) { return; }
      g.settings.track = o.def.track; g.saveSettings('track');
      location.reload();
    }
    resume(o) {
      if (!o || !o.def) return;
      if (o.act === 'play') this.play(o.def); else this.open(o.def, { official: o.official });
    }
    play(def) {
      if (def.track && def.track !== G.TRACK_ID) { this.reloadInto({ act: 'play', def }); return; }
      const g = this.game;
      g.toMenu();
      g.customCourse = Object.assign({}, def, { editing: false });
      g.startRace('course');
      g.hud.popup(def.name || 'CUSTOM COURSE', def.author ? 'by ' + def.author : '', 'blue');
    }

    // ---------------- editing ----------------
    open(def, o = {}) {
      if (def.track && def.track !== G.TRACK_ID) { this.reloadInto({ act: 'edit', def, official: o.official }); return; }
      const g = this.game;
      def.track = G.TRACK_ID;
      if (!Array.isArray(def.items)) {
        def.items = def.base === 'builtin' ? G.bakeCourse(G.COURSES.street, g.track) : def.base === 'official' ? G.officialCourse(g.track).items : [];
        delete def.base;
      }
      g.toMenu();
      g.closePanels();
      $('menu').classList.remove('open');
      if (g.traffic) { g.traffic.dispose(); g.traffic = null; }
      this.def = def; this.official = !!o.official;
      def.editing = true;
      g.customCourse = def;
      this.undoStack = []; this.sel = -1; this.tool = null; this.changed = false;
      if (o.s == null) this.camS = 60; else this.camS = o.s;
      g.state = 'editor';
      document.body.classList.add('editing');
      $('editor').classList.remove('hidden');
      $('ed-name').value = def.name || '';
      $('ed-name').disabled = this.official;
      $('ed-save').classList.toggle('hidden', this.official);
      $('ed-official').classList.toggle('hidden', !this.official);
      $('ed-resetlbl').classList.toggle('hidden', !this.official);
      $('ed-reset').checked = false;
      this.renderPalette();
      this.rebuild();
      this.renderInspector();
      this.msg(this.official ? 'EDITING THE OFFICIAL ' + TRACK_NAME[G.TRACK_ID] + ' COURSE' : 'Pick a piece on the left, then click the road');
    }
    // back from a test run
    back() {
      if (!this.def) { this.game.toMenu(); return; }
      const s = this.camS, sel = this.sel;
      this.open(this.def, { official: this.official, s });
      this.select(sel < this.def.items.length ? sel : -1);
    }
    exit() {
      const g = this.game;
      if (this.official && this.changed && !confirm('Leave without saving the official course?')) return;
      if (!this.official) this.save(true);
      $('editor').classList.add('hidden');
      document.body.classList.remove('editing');
      this.disposeMarks();
      const off = this.official;
      this.def = null;
      g.toMenu();
      if (off) this.showAdmin(); else this.home();
    }
    save(quiet) {
      if (!this.def || this.official) return;
      this.def.name = cleanName($('ed-name').value, this.def.name || 'MY COURSE');
      $('ed-name').value = this.def.name;
      this.saveMine(this.def);
      this.changed = false;
      if (!quiet) this.msg('Saved');
    }
    test(here) {
      const g = this.game;
      if (!this.official) this.save(true);
      $('editor').classList.add('hidden');
      document.body.classList.remove('editing');
      this.disposeMarks();
      g.customCourse = this.def;
      g.startRace('course', here ? { s0: this.camS + 20 } : {});
    }
    saveOfficial() {
      const reset = $('ed-reset').checked;
      if (!confirm(`Publish this layout as the official ${TRACK_NAME[G.TRACK_ID]} obstacle course${reset ? ' and wipe its leaderboard and ghosts' : ''}?`)) return;
      this.msg('Publishing…');
      G.api.admin('official_save', this.adminKey, { track: G.TRACK_ID, items: this.def.items, reset: reset ? 1 : 0 }).then(() => {
        G.store.set('official_' + G.TRACK_ID, { items: clone(this.def.items) });
        this.game.officialDef = null;
        this.changed = false;
        this.msg('Official course published' + (reset ? ', leaderboard reset' : ''));
      }).catch((e) => this.msg('Not published: ' + e.message, true));
    }

    snapshot() { this.undoStack.push(JSON.stringify(this.def.items)); if (this.undoStack.length > 60) this.undoStack.shift(); this.changed = true; }
    undo() {
      const s = this.undoStack.pop();
      if (s == null) { this.msg('Nothing to undo'); return; }
      this.def.items.length = 0;
      for (const it of JSON.parse(s)) this.def.items.push(it);
      this.select(-1);
      this.rebuild();
    }

    // the course is rebuilt from the item list after each change (while dragging, at most ~12 times a second)
    rebuild() {
      const g = this.game;
      if (g.course) g.course.dispose();
      g.course = new G.Course(g, this.def);
      g.course.reset();
      this.fp = g.course.footprints();
      this.dirty = false; this.lastBuild = performance.now();
      this.marks();
      $('ed-info').textContent = `${TRACK_NAME[G.TRACK_ID]} · ${this.def.items.length}/${MAX_ITEMS} pieces`;
    }
    touch() { this.dirty = true; this.changed = true; }

    place(t, s, lat) {
      const items = this.def.items;
      if (items.length >= MAX_ITEMS) { this.msg(`A course holds at most ${MAX_ITEMS} pieces`, true); return; }
      this.snapshot();
      const p = {}, lk = firstLat(t);
      if (lk) p[lk] = Math.round(lat * 10) / 10;
      items.push({ t, s: Math.round(G.wrap(s, this.game.track.length) * 10) / 10, p });
      this.rebuild();
      this.select(items.length - 1);
    }
    remove() {
      if (this.sel < 0) return;
      this.snapshot();
      this.def.items.splice(this.sel, 1);
      this.select(-1);
      this.rebuild();
    }
    duplicate() {
      if (this.sel < 0) return;
      const it = this.def.items[this.sel], d = G.PIECES[it.t];
      if (this.def.items.length >= MAX_ITEMS) { this.msg(`A course holds at most ${MAX_ITEMS} pieces`, true); return; }
      this.snapshot();
      const c = clone(it);
      c.s = Math.round(G.wrap(it.s + Math.max(12, (d ? d.len : 10) + 14), this.game.track.length) * 10) / 10;
      this.def.items.push(c);
      this.rebuild();
      this.select(this.def.items.length - 1);
      this.camS = c.s - 20;
    }
    reroll() {
      if (this.sel < 0) return;
      const it = this.def.items[this.sel], d = G.PIECES[it.t];
      if (!d || !d.rnd) return;
      this.snapshot();
      for (const k of d.rnd) delete it.p[k];
      this.rebuild();
      this.renderInspector();
    }
    select(i) {
      this.sel = i;
      this.renderInspector();
      this.marks();
    }

    // ---------------- UI ----------------
    msg(text, err) {
      const el = $('ed-msg');
      el.textContent = text; el.classList.toggle('err', !!err); el.classList.add('on');
      clearTimeout(this._msgT); this._msgT = setTimeout(() => el.classList.remove('on'), 2600);
    }
    renderPalette() {
      let h = '';
      for (const [cat, name] of G.PIECE_CATS) {
        h += `<h4>${name}</h4><div class="grid">`;
        for (const [t, d] of Object.entries(G.PIECES)) if (d.cat === cat) h += `<button data-t="${t}" title="${esc(d.desc)}" class="${this.tool === t ? 'sel' : ''}"><span class="sw" style="background:${CAT_COL[cat]}"></span>${esc(d.name)}</button>`;
        h += '</div>';
      }
      $('ed-pal').innerHTML = h;
    }
    setTool(t) {
      this.tool = this.tool === t ? null : t;
      $('ed-pal').querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.t === this.tool));
      if (this.tool) this.msg(`Click the road to place: ${G.PIECES[t].name} (right-click or Esc to stop)`);
    }
    renderInspector() {
      const el = $('ed-insp');
      const it = this.def && this.sel >= 0 ? this.def.items[this.sel] : null;
      if (!it) { el.innerHTML = ''; return; }
      const d = G.PIECES[it.t] || { name: it.t, params: [], desc: '' }, R = G.ROAD_HALF, L = this.game.track.length;
      let h = `<h4>${esc(d.name)}</h4><p class="desc">${esc(d.desc)}</p>`;
      const row = (key, label, min, max, step, v) => `<div class="prm"><div><span>${esc(label)}</span><b data-v="${key}">${fmt(v, step)}</b></div><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}"></div>`;
      const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : Number(v).toFixed(1));
      h += row('_s', 'Position (m)', 0, Math.floor(L), 1, it.s);
      for (const [k, label, a, b, st] of d.params) {
        const lat = a === 'lat', min = lat ? -(R - 0.5) : a, max = lat ? R - 0.5 : b, step = lat ? 0.1 : st;
        const v = it.p[k] != null && Number.isFinite(+it.p[k]) ? +it.p[k] : lat ? 0 : min;
        h += row(k, label, min, max, step, v);
      }
      h += `<div class="btns"><button data-b="dup" title="Ctrl+D">DUPLICATE</button>${d.rnd ? '<button data-b="reroll" title="New random details">REROLL</button>' : ''}<button data-b="del" class="warn" title="Delete">DELETE</button></div>`;
      el.innerHTML = h;
    }

    wireEditor() {
      const g = this.game, cv = g.renderer.domElement;
      const btn = (id, fn) => $(id).addEventListener('click', () => { G.audio.init(); G.audio.tone(700, 0.05, 0.08, 'triangle'); fn(); });
      btn('ed-undo', () => this.undo());
      btn('ed-save', () => this.save());
      btn('ed-official', () => this.saveOfficial());
      btn('ed-test', () => this.test(false));
      btn('ed-testhere', () => this.test(true));
      btn('ed-exit', () => this.exit());
      $('ed-name').addEventListener('change', () => { if (this.def) { this.def.name = cleanName($('ed-name').value, this.def.name); this.changed = true; } });
      $('ed-pal').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (b) this.setTool(b.dataset.t); });
      const insp = $('ed-insp');
      insp.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-b]');
        if (!b) return;
        if (b.dataset.b === 'dup') this.duplicate(); else if (b.dataset.b === 'del') this.remove(); else this.reroll();
      });
      insp.addEventListener('pointerdown', (e) => { if (e.target.type === 'range') this._slid = false; });
      insp.addEventListener('input', (e) => {
        const r = e.target;
        if (r.type !== 'range' || this.sel < 0) return;
        if (!this._slid) { this.snapshot(); this._slid = true; }
        const it = this.def.items[this.sel], v = Number(r.value);
        if (r.dataset.k === '_s') it.s = v; else it.p[r.dataset.k] = v;
        const out = insp.querySelector(`b[data-v="${r.dataset.k}"]`);
        if (out) out.textContent = Number(r.step) >= 1 ? String(Math.round(v)) : v.toFixed(1);
        this.touch();
      });
      insp.addEventListener('change', () => { this._slid = false; });
      insp.addEventListener('keydown', (e) => { if (e.target.type === 'range') { e.stopPropagation(); this._slid = false; } });

      // 3D view: click to place / select, drag to move a piece or the view, wheel to travel along the lap
      cv.addEventListener('pointerdown', (e) => { if (g.state === 'editor') this.down(e, this.pick3d(e)); });
      cv.addEventListener('pointermove', (e) => { if (g.state === 'editor') this.move(e, this.pick3d(e)); });
      cv.addEventListener('contextmenu', (e) => { if (g.state === 'editor') e.preventDefault(); });
      cv.addEventListener('wheel', (e) => { if (g.state === 'editor') this.wheel(e); }, { passive: false });
      // the strip: the same, on the unrolled lap
      const st = $('ed-strip');
      st.addEventListener('pointerdown', (e) => this.down(e, this.pickStrip(e)));
      st.addEventListener('pointermove', (e) => this.move(e, this.pickStrip(e)));
      st.addEventListener('contextmenu', (e) => e.preventDefault());
      st.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
      const ov = $('ed-over');
      const jump = (e) => { const r = ov.getBoundingClientRect(); this.camS = G.clamp((e.clientX - r.left) / r.width, 0, 1) * g.track.length - 25; };
      ov.addEventListener('pointerdown', (e) => { jump(e); ov.setPointerCapture(e.pointerId); this._ov = true; });
      ov.addEventListener('pointermove', (e) => { if (this._ov) jump(e); });
      ov.addEventListener('pointerup', () => { this._ov = false; });
      window.addEventListener('pointerup', () => this.up());
      window.addEventListener('keydown', (e) => this.key(e));
    }

    // pointer → road coordinates {s, lat} (null off the road area)
    pick3d(e) {
      const cam = this.game.camera;
      this.v2.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      this.ray.setFromCamera(this.v2, cam);
      if (!this.ray.ray.intersectPlane(this.plane, this.v3)) return null;
      const n = this.game.track.nearest(this.v3.x, this.v3.z, -1, this.nq);
      if (Math.abs(n.lat) > G.ROAD_HALF + 6) return null;
      return { s: n.s, lat: G.clamp(n.lat, -G.ROAD_HALF + 0.5, G.ROAD_HALF - 0.5) };
    }
    stripView() {
      const cv = $('ed-strip'), w = cv.clientWidth, span = 260 * this.zoom;
      return { s0: this.camS + 25 - span / 2, span, w, h: cv.clientHeight };
    }
    pickStrip(e) {
      const r = $('ed-strip').getBoundingClientRect(), v = this.stripView(), R = G.ROAD_HALF;
      const s = v.s0 + ((e.clientX - r.left) / r.width) * v.span;
      const lat = (0.5 - (e.clientY - r.top) / r.height) * 2 * (R + 2);
      return { s: G.wrap(s, this.game.track.length), lat: G.clamp(lat, -R + 0.5, R - 0.5), strip: true, x: e.clientX };
    }
    hit(q) {
      let best = -1, ba = 1e9;
      const L = this.game.track.length;
      for (const f of this.fp) {
        let d = f.s - q.s;
        if (d > L / 2) d -= L; else if (d < -L / 2) d += L;
        if (Math.abs(d) > f.hl + 0.8 || Math.abs(f.lat - q.lat) > f.hw + 0.8) continue;
        const a = (f.hl + 1) * (f.hw + 1);
        if (a < ba) { ba = a; best = f.it; }
      }
      return best;
    }
    down(e, q) {
      if (!this.def) return;
      e.preventDefault();
      try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (e.button === 2) { if (this.tool) this.setTool(this.tool); else this.select(-1); return; }
      if (e.button !== 0 || !q) { if (e.button === 0) this.drag = { pan: true, q0: null, x: e.clientX, y: e.clientY, s0: this.camS }; return; }
      if (this.tool) { this.place(this.tool, q.s, q.lat); return; }
      const i = this.hit(q);
      if (i >= 0) {
        if (i !== this.sel) this.select(i);
        const it = this.def.items[i], lk = firstLat(it.t);
        this.drag = { item: i, ds: it.s - q.s, dl: lk ? (+it.p[lk] || 0) - q.lat : 0, lk, moved: false, strip: q.strip };
      } else {
        this.select(-1);
        this.drag = { pan: true, x: e.clientX, y: e.clientY, s0: this.camS, strip: q.strip };
      }
    }
    move(e, q) {
      this.hover = q;
      const d = this.drag;
      if (!d) return;
      if (d.pan) {
        // drag the road: up/down in the 3D view, left/right on the strip
        const px = d.strip ? -(e.clientX - d.x) / $('ed-strip').clientWidth * this.stripView().span : (e.clientY - d.y) * 0.12 * this.zoom * (60 / 45);
        this.camS = d.s0 + px;
        return;
      }
      if (!q) return;
      const it = this.def.items[d.item];
      if (!d.moved) { this.snapshot(); d.moved = true; }
      it.s = Math.round(G.wrap(q.s + d.ds, this.game.track.length) * 10) / 10;
      if (d.lk) it.p[d.lk] = Math.round(G.clamp(q.lat + d.dl, -G.ROAD_HALF + 0.5, G.ROAD_HALF - 0.5) * 10) / 10;
      this.touch();
    }
    up() {
      if (this.drag && this.drag.moved) { this.rebuild(); this.renderInspector(); }
      this.drag = null;
    }
    wheel(e) {
      if (!this.def) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.zoom = G.clamp(this.zoom * Math.exp(e.deltaY * 0.002), 0.35, 3);
      else this.camS += (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * 0.12 * this.zoom;
    }
    key(e) {
      if (this.game.state !== 'editor' || !this.def) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      const k = e.code, ctrl = e.ctrlKey || e.metaKey, big = e.shiftKey ? 5 : 1;
      if (ctrl && k === 'KeyZ') { e.preventDefault(); this.undo(); return; }
      if (ctrl && k === 'KeyD') { e.preventDefault(); this.duplicate(); return; }
      if (ctrl && k === 'KeyS') { e.preventDefault(); if (this.official) this.saveOfficial(); else this.save(); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.remove(); return; }
      if (k === 'Escape') { if (this.tool) this.setTool(this.tool); else this.select(-1); return; }
      const it = this.sel >= 0 ? this.def.items[this.sel] : null;
      const dir = { ArrowUp: [1, 0], ArrowDown: [-1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], KeyW: [1, 0], KeyS: [-1, 0], KeyA: [0, -1], KeyD: [0, 1] }[k];
      if (!dir) return;
      e.preventDefault();
      if (!it) { this.camS += dir[0] * 15 * big; return; }
      // nudge the selected piece (Shift: 5×)
      if (!e.repeat || !this._nudge) this.snapshot();
      this._nudge = true;
      it.s = Math.round(G.wrap(it.s + dir[0] * big, this.game.track.length) * 10) / 10;
      const lk = firstLat(it.t);
      if (lk && dir[1]) it.p[lk] = Math.round(G.clamp((+it.p[lk] || 0) + dir[1] * 0.5 * big, -G.ROAD_HALF + 0.5, G.ROAD_HALF - 0.5) * 10) / 10;
      this.touch();
      clearTimeout(this._nudgeT); this._nudgeT = setTimeout(() => { this._nudge = false; this.renderInspector(); }, 400);
    }

    // ---------------- 3D marks: the selection and the cursor ----------------
    disposeMarks() {
      if (this.markGrp) { this.game.scene.remove(this.markGrp); this.markGrp.traverse((o) => { if (o.geometry && o.geometry !== this.edgeG && o.geometry !== this.curG) o.geometry.dispose(); }); this.markGrp = null; }
    }
    marks() {
      const g = this.game;
      this.disposeMarks();
      if (!this.def) return;
      if (!this.edgeG) {
        this.edgeG = new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
        this.selM = new T.LineBasicMaterial({ color: new T.Color(0.6, 3, 4), toneMapped: false });
        this.curG = new T.RingGeometry(0.9, 1.25, 32).rotateX(-Math.PI / 2);
        this.curM = new T.MeshBasicMaterial({ color: new T.Color(0.6, 3, 4), toneMapped: false, transparent: true, opacity: 0.85, depthTest: false });
      }
      const grp = (this.markGrp = new T.Group());
      if (this.sel >= 0) for (const f of this.fp) if (f.it === this.sel) {
        const p = g.track.sample(f.s, this.sq), x = p.x + p.rx * f.lat, z = p.z + p.rz * f.lat;
        const h = f.c === 'ring' ? 0 : f.c === 'pendulum' ? 15.5 : f.c === 'container' ? 2.8 : 3;
        const l = new T.LineSegments(this.edgeG, this.selM);
        l.matrixAutoUpdate = false;
        const y0 = 0;
        l.matrix.set(p.rx * (f.hw * 2 + 0.6), 0, -p.tx * (f.hl * 2 + 0.6), x, 0, Math.max(h, 0.2) + 0.3, 0, y0, p.rz * (f.hw * 2 + 0.6), 0, -p.tz * (f.hl * 2 + 0.6), z, 0, 0, 0, 1);
        grp.add(l);
      }
      this.cursor = new T.Mesh(this.curG, this.curM);
      this.cursor.renderOrder = 10; this.cursor.visible = false;
      grp.add(this.cursor);
      g.scene.add(grp);
    }

    // ---------------- per frame (the game's loop hands over while state === 'editor') ----------------
    frame(dt) {
      const g = this.game, tr = g.track, L = tr.length, cam = g.camera;
      if (!this.def) return;
      this.camS = G.wrap(this.camS, L);
      if (this.dirty && (!this.drag || performance.now() - this.lastBuild > 80)) this.rebuild();
      // overhead camera: behind and above the point of interest, looking down the road
      const p = tr.sample(this.camS, this.sq), z = this.zoom;
      const tx = p.tx, tz = p.tz, cx = p.x, cz = p.z;
      cam.position.set(cx - tx * 26 * z, 44 * z, cz - tz * 26 * z);
      cam.lookAt(cx + tx * 20 * z, 0, cz + tz * 20 * z);
      if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); }
      this.v3.set(cx, 0, cz);
      g.city.update(dt, cam.position, this.v3);
      if (g.course) g.course.update(dt, false);
      if (this.cursor) {
        const h = this.hover;
        this.cursor.visible = !!h && !this.drag;
        if (h) {
          const q = tr.pointAt(h.s, h.lat, this.nq);
          this.cursor.position.set(q.x, 0.08, q.z);
          const r = this.tool ? Math.max(1, Math.min(4, (G.PIECES[this.tool].len || 2) / 4)) : 1;
          this.cursor.scale.setScalar(r);
        }
      }
      this.drawStrip();
    }

    drawStrip() {
      const g = this.game, L = g.track.length, R = G.ROAD_HALF;
      const fit = (cv) => {
        const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
        return c;
      };
      // unrolled lap around the camera
      const cv = $('ed-strip'), c = fit(cv), v = this.stripView(), W = v.w, H = v.h;
      const X = (s) => { let d = s - v.s0; d = G.wrap(d, L); if (d > L - 200) d -= L; return (d / v.span) * W; };
      const Y = (lat) => (0.5 - lat / (2 * (R + 2))) * H;
      c.fillStyle = 'rgba(40,44,54,0.9)'; c.fillRect(0, Y(R), W, Y(-R) - Y(R));
      c.strokeStyle = 'rgba(255,255,255,0.18)'; c.setLineDash([8, 8]); c.beginPath(); c.moveTo(0, Y(0)); c.lineTo(W, Y(0)); c.stroke(); c.setLineDash([]);
      // metre ticks
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.font = '10px Rajdhani, sans-serif';
      const step = v.span > 400 ? 100 : 50;
      for (let s = Math.ceil(v.s0 / step) * step; s < v.s0 + v.span; s += step) { const x = ((s - v.s0) / v.span) * W; c.fillRect(x, H - 6, 1, 6); c.fillText(String(Math.round(G.wrap(s, L))), x + 3, H - 2); }
      // start / finish line
      const xs = X(0);
      if (xs >= 0 && xs <= W) { for (let k = 0; k < 8; k++) { c.fillStyle = k & 1 ? '#000' : '#fff'; c.fillRect(xs - 2, Y(R) + (k * (Y(-R) - Y(R))) / 8, 4, (Y(-R) - Y(R)) / 8); } }
      // the circuit's own jump ramps (fixed)
      c.fillStyle = 'rgba(150,150,160,0.6)';
      for (const r of g.track.ramps) { const x = X(r.s - r.len / 2); c.fillRect(x, Y(r.lat + r.w / 2), (r.len / v.span) * W, Y(r.lat - r.w / 2) - Y(r.lat + r.w / 2)); }
      // the course
      const items = this.def.items;
      for (const f of this.fp) {
        const it = items[f.it], d = it && G.PIECES[it.t];
        const x0 = X(f.s - f.hl), x1 = X(f.s + f.hl);
        if (x1 < -5 || x0 > W + 5) continue;
        c.fillStyle = d ? CAT_COL[d.cat] : '#fff';
        c.globalAlpha = f.it === this.sel ? 1 : 0.75;
        c.fillRect(x0, Y(f.lat + f.hw), Math.max(2, x1 - x0), Math.max(2, Y(f.lat - f.hw) - Y(f.lat + f.hw)));
      }
      c.globalAlpha = 1;
      if (this.sel >= 0) {
        c.strokeStyle = '#fff'; c.lineWidth = 1.5;
        for (const f of this.fp) if (f.it === this.sel) { const x0 = X(f.s - f.hl), x1 = X(f.s + f.hl); c.strokeRect(x0 - 1.5, Y(f.lat + f.hw) - 1.5, Math.max(2, x1 - x0) + 3, Math.max(2, Y(f.lat - f.hw) - Y(f.lat + f.hw)) + 3); }
      }
      // what the 3D view is looking at
      c.strokeStyle = 'rgba(95,212,255,0.8)'; c.lineWidth = 1;
      c.strokeRect(X(this.camS - 5), 1, ((60 * this.zoom) / v.span) * W, H - 2);
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.fillText('scroll / drag: move along the lap · ctrl+scroll: zoom · Del: delete · ctrl+Z: undo', 6, 11);

      // whole-lap overview
      const ov = $('ed-over'), o = fit(ov), OW = ov.clientWidth, OH = ov.clientHeight;
      o.fillStyle = 'rgba(40,44,54,0.9)'; o.fillRect(0, OH / 2 - 2, OW, 4);
      for (const it of items) { const d = G.PIECES[it.t]; o.fillStyle = d ? CAT_COL[d.cat] : '#fff'; o.fillRect((it.s / L) * OW - 1, 3, 2, OH - 6); }
      o.strokeStyle = '#fff'; o.lineWidth = 1.5;
      o.strokeRect((G.wrap(v.s0, L) / L) * OW, 1, Math.max(3, (v.span / L) * OW), OH - 2);
    }

    // ---------------- race control ----------------
    wireAdmin() {
      const g = this.game;
      window.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey && e.altKey && e.shiftKey && e.code === 'KeyO')) return;
        if (g.state !== 'menu') return;
        e.preventDefault();
        if (this.adminKey) this.showAdmin();
        else { this.status('a-status', ''); g.showPanel('adminkey'); setTimeout(() => $('a-key').focus(), 50); }
      });
      const enter = () => {
        const key = $('a-key').value;
        if (!key) return;
        this.status('a-status', 'Checking…');
        G.api.admin('admin_check', key).then(() => {
          this.adminKey = key;
          try { sessionStorage.setItem('rt-ak', key); } catch (e) { /* ignore */ }
          $('a-key').value = '';
          g.closePanels();
          this.showAdmin();
        }).catch((e) => this.status('a-status', /forbidden|passkey|403/i.test(e.message) ? 'Wrong passkey.' : 'Race control is offline: ' + e.message, true));
      };
      $('a-enter').addEventListener('click', enter);
      $('a-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });
      $('a-lock').addEventListener('click', () => {
        this.adminKey = '';
        try { sessionStorage.removeItem('rt-ak'); } catch (e) { /* ignore */ }
        g.closePanels(); $('menu').classList.add('open');
      });
      $('a-tracks').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-a]');
        if (!b) return;
        const track = b.dataset.t;
        if (b.dataset.a === 'edit') this.editOfficial(track);
        else if (b.dataset.a === 'revert' && confirm(`Put the built-in ${TRACK_NAME[track]} course back for everyone? (The leaderboard is kept.)`)) {
          G.api.admin('official_save', this.adminKey, { track, items: null, reset: 0 }).then(() => {
            if (track === G.TRACK_ID) { G.store.set('official_' + track, { items: null }); g.officialDef = null; }
            this.status('a-msg', TRACK_NAME[track] + ': built-in course restored.');
            this.showAdmin();
          }).catch((err) => this.status('a-msg', err.message, true));
        }
      });
      $('a-comm').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-del]');
        if (!b || !confirm('Delete shared course ' + b.dataset.del + '?')) return;
        G.api.admin('shared_delete', this.adminKey, { code: b.dataset.del }).then(() => { this.status('a-msg', 'Deleted ' + b.dataset.del); this.loadCommunity('a-comm', true); })
          .catch((err) => this.status('a-msg', err.message, true));
      });
    }
    showAdmin() {
      const g = this.game;
      $('menu').classList.remove('open');
      g.closePanels();
      g.showPanel('admin');
      const el = $('a-tracks');
      el.innerHTML = ['city', 'highway'].map((t) => `<div class="row"><span class="n">${TRACK_NAME[t]}<small id="a-st-${t}">…</small></span><button data-a="edit" data-t="${t}">EDIT</button><button class="x" data-a="revert" data-t="${t}">BUILT-IN</button></div>`).join('');
      for (const t of ['city', 'highway']) G.api.official(t).then((r) => { $('a-st-' + t).textContent = Array.isArray(r.items) ? `edited · ${r.items.length} pieces` : 'built-in layout'; }).catch(() => { $('a-st-' + t).textContent = 'offline'; });
      this.loadCommunity('a-comm', true);
    }
    editOfficial(track) {
      this.status('a-msg', 'Loading…');
      G.api.official(track).then((r) => {
        const def = { id: 'official_' + track, name: 'OFFICIAL · ' + TRACK_NAME[track], track };
        if (Array.isArray(r.items)) def.items = r.items; else { def.items = null; def.base = 'builtin'; }
        this.open(def, { official: true });
      }).catch((e) => this.status('a-msg', 'Could not load: ' + e.message, true));
    }
  }

  G.Editor = Editor;
})();
