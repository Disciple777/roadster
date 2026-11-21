// WORLD TOUR: every street circuit back to back, one lap each, against the same seven rivals.
// Points per race (10-8-6-5-4-3-2-1) add up across the tour; the standings carry over between races and the page
// reloads between circuits, so the whole tour lives in localStorage rt_tour (quitting mid-tour keeps it for later).
(() => {
  const PTS = [10, 8, 6, 5, 4, 3, 2, 1];
  // one colour per stop for the final chart
  const HUES = ['#ff2a3c', '#ff8a1a', '#ffd23a', '#4fe07a', '#3fc6ff', '#8a6bff', '#ff5fc8', '#c8d0da'];
  G.TOUR = { name: 'WORLD TOUR', laps: 1, rivals: 7, pts: PTS, hues: HUES };
  G.tourTracks = () => Object.keys(G.TRACKS);
  G.tourState = () => { const t = G.store.get('tour', null); return t && Array.isArray(t.order) && t.i < t.order.length ? t : null; };
  G.tourSave = (t) => G.store.set('tour', t);
  G.tourEnd = () => G.store.set('tour', null);
  G.tourNew = () => ({ order: G.tourTracks(), i: 0, races: [], pts: {}, colors: {} });

  // a finished race, rows in finishing order: [{ name, me, color }]. Returns the rows with their points.
  G.tourScore = (t, rows) => {
    const out = rows.map((r, k) => ({ name: r.name, me: !!r.me, place: k + 1, pts: PTS[k] || 0 }));
    for (const r of rows) if (r.color != null) t.colors[r.name] = r.color;
    for (const r of out) t.pts[r.name] = (t.pts[r.name] || 0) + r.pts;
    t.races.push({ track: t.order[t.i], rows: out });
    t.i++;
    return out;
  };

  // standings, best first: points, then wins, then the better result in the latest race
  G.tourStandings = (t) => {
    const names = Object.keys(t.pts);
    const rows = names.map((n) => {
      const per = t.races.map((rc) => { const r = rc.rows.find((q) => q.name === n); return r ? r : { place: 9, pts: 0 }; });
      return { name: n, me: per.some((r) => r.me), pts: t.pts[n], wins: per.filter((r) => r.place === 1).length, last: per.length ? per[per.length - 1].place : 9, per, color: t.colors[n] };
    });
    rows.sort((a, b) => b.pts - a.pts || b.wins - a.wins || a.last - b.last);
    return rows;
  };

  const dot = (r) => (r.me ? '#ff2a3c' : r.color != null ? '#' + Number(r.color).toString(16).padStart(6, '0') : '#888');
  const trackName = (id) => (G.TRACKS[id] || {}).name || id.toUpperCase();

  // the standings list: position, driver, this race's result, total points
  G.tourRowsHTML = (t, lastRace) => G.tourStandings(t).map((r, i) => {
    const lr = lastRace && lastRace.rows.find((q) => q.name === r.name);
    const sub = lr ? `P${lr.place} on ${trackName(lastRace.track)} · +${lr.pts}` : `${r.wins} win${r.wins === 1 ? '' : 's'}`;
    return `<div class="row ${r.me ? 'me' : ''}"><span class="p">${i + 1}</span><span class="dot" style="background:${dot(r)}"></span>` +
      `<span class="n">${r.me ? 'YOU' : r.name}<small>${sub}</small></span><span class="t">${r.pts} PTS</span></div>`;
  }).join('');

  // the final chart: one bar per driver, a coloured block per race
  G.tourChartHTML = (t) => {
    const st = G.tourStandings(t), max = Math.max(1, ...st.map((r) => r.pts));
    const bars = st.map((r, i) => {
      const segs = r.per.map((q, k) => (q.pts ? `<i style="width:${(q.pts / max) * 100}%;background:${HUES[k % HUES.length]}" title="${trackName(t.races[k].track)}: P${q.place}, ${q.pts} pts"></i>` : '')).join('');
      return `<div class="row tbar ${r.me ? 'me' : ''}"><span class="p">${i + 1}</span><span class="dot" style="background:${dot(r)}"></span>` +
        `<span class="n">${r.me ? 'YOU' : r.name}</span><span class="bar">${segs}</span><span class="t">${r.pts}</span></div>`;
    }).join('');
    const key = t.races.map((rc, k) => `<span><i style="background:${HUES[k % HUES.length]}"></i>${trackName(rc.track)}</span>`).join('');
    return bars + `<div class="tkey">${key}</div>`;
  };

  // the tour's stops for the panel: done (with your place), next, still to come
  G.tourStopsHTML = (t) => {
    const order = t ? t.order : G.tourTracks();
    return order.map((id, k) => {
      const rc = t && t.races[k], me = rc && rc.rows.find((q) => q.me);
      const cls = rc ? 'done' : t && k === t.i ? 'next' : '';
      const st = rc ? `P${me.place} · +${me.pts}` : t && k === t.i ? 'NEXT' : '';
      return `<div class="stop ${cls}"><span class="k">${k + 1}</span><b>${trackName(id)}</b><small>${(G.TRACKS[id] || {}).tag || ''}</small><span class="st">${st}</span></div>`;
    }).join('');
  };
})();
