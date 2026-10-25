// dev-only screenshot helpers (never deployed): load in the console with
//   await new Promise(r => { const s = document.createElement('script'); s.src = '/tools/shots.js?' + Date.now(); s.onload = r; document.body.appendChild(s); });
(function () {
  const ready = () => new Promise((r) => { const c = () => (window.G && G.game && G.game.state && G.game.state !== 'loading') ? r() : setTimeout(c, 200); c(); });
  window.shotSetup = async () => {
    await ready();
    const g = G.game; g.settings.traffic = 'off'; if (g.state === 'menu') g.startRace('free');
    g.renderer.setAnimationLoop(null);
  };
  // place the car at track distance ds / lateral lat, settle, optionally override the camera, save JPEG via the scratch shot server
  window.shot = async (name, ds, lat, camOv) => {
    const g = G.game, p = g.player;
    p.place(ds, lat, 0); p.vel.set(0, 0, 0);
    let t = performance.now();
    for (let i = 0; i < 150; i++) { t += 16.7; g.frame(t); }
    if (camOv) {
      const c = g.camera, n = g.track.sample(ds, {});
      // camOv in track space: along (a), lateral (l), height (h) for position and look target
      const P = (a, l, h) => { const q = g.track.sample(ds + a, {}); return [q.x + q.rx * l, h, q.z + q.rz * l]; };
      c.position.set(...P(...camOv.pos)); c.lookAt(...P(...camOv.look));
      if (camOv.fov) { c.fov = camOv.fov; c.updateProjectionMatrix(); }
      const rc = g.reflCam; g.reflCam = null; g.render(); g.reflCam = rc;
    }
    const url = g.renderer.domElement.toDataURL('image/jpeg', 0.85);
    await fetch('http://127.0.0.1:8091/' + name, { method: 'POST', body: url });
    return name;
  };
  window.resume = () => { const g = G.game; g.last = performance.now(); g.renderer.setAnimationLoop((n) => g.frame(n)); };
  // standard set of views used to judge the city
  window.shotSet = async (prefix) => {
    await shotSetup();
    const out = [];
    out.push(await shot(prefix + '_chase1', 40, 4));
    out.push(await shot(prefix + '_chase2', 700, 4));
    out.push(await shot(prefix + '_street', 300, 0, { pos: [0, -6, 5], look: [40, 15, 9], fov: 62 }));
    out.push(await shot(prefix + '_trees', 500, 0, { pos: [0, 9, 2.0], look: [22, 14.5, 4.5], fov: 60 }));
    out.push(await shot(prefix + '_skyline', 1100, 0, { pos: [0, -8, 4], look: [90, 2, 38], fov: 65 }));
    return out;
  };
})();
