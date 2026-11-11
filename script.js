/* =========================================================
   Стереометрия 3D — конструктор сечений (Vue 3 + Three.js)
   Структура файла:
   1. Описание фигур   2. Математика (плоскость, сечение)
   3. Пояснения («Ход построения»)   4. Vue + Three.js
   ========================================================= */
const { createApp, ref, onMounted, watch, nextTick } = Vue;

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const LETTERS = 'ABCDEFGH';
const NAMES = ['M', 'N', 'K'];                       // имена трёх заданных точек
const EXTRA = 'PQRTUWXYZ'.split('');                 // имена найденных точек
const POLY_NAMES = ['', '', '', 'треугольник', 'четырёхугольник', 'пятиугольник', 'шестиугольник', 'семиугольник', 'восьмиугольник'];
const PT_COLORS = ['#f472b6', '#34d399', '#fde047'];
const fmt = x => (Math.round(x * 100) / 100).toString().replace('.', ',');

/* ---------- 1. ФИГУРЫ ---------- */
const regular = (n, R) => Array.from({ length: n }, (_, i) => [R * Math.cos(2 * Math.PI * i / n), R * Math.sin(2 * Math.PI * i / n)]);
const rect = (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];

// Достраивает описание многогранника: центрирует, находит рёбра и плоскости граней
function makePoly(verts, faces) {
  const box = new THREE.Box3();
  verts.forEach(v => box.expandByPoint(V3(...v.p)));
  const c = box.getCenter(V3(0, 0, 0));
  const vs = verts.map(v => ({ name: v.name, p: V3(...v.p).sub(c) }));
  const edges = [], seen = new Set();
  faces.forEach(f => f.forEach((a, k) => {
    const b = f[(k + 1) % f.length], key = Math.min(a, b) + '-' + Math.max(a, b);
    if (!seen.has(key)) { seen.add(key); edges.push([a, b]); }
  }));
  const planes = faces.map(f => {
    const [a, b, c2] = f.map(i => vs[i].p);
    const n = b.clone().sub(a).cross(c2.clone().sub(a)).normalize();
    return { n, d: n.dot(a), name: f.map(i => vs[i].name).join('') };   // уравнение n·x = d
  });
  return { poly: true, verts: vs, faces, edges, planes };
}
// Призма: основание base (xz) и высота h
function prism(base, h) {
  const n = base.length, verts = [];
  base.forEach(([x, z], i) => verts.push({ p: [x, 0, z], name: LETTERS[i] }));
  base.forEach(([x, z], i) => verts.push({ p: [x, h, z], name: LETTERS[i] + '₁' }));
  const idx = [...Array(n).keys()];
  const faces = [idx, idx.map(i => n + i)];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([i, j, n + j, n + i]); }
  return makePoly(verts, faces);
}
// Пирамида: основание base и вершина apex
function pyramid(base, apex, apexName = 'S') {
  const n = base.length, verts = base.map(([x, z], i) => ({ p: [x, 0, z], name: LETTERS[i] }));
  verts.push({ p: apex, name: apexName });
  const faces = [[...Array(n).keys()]];
  for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n]);
  return makePoly(verts, faces);
}
const SHAPES = [
  { key: 'cube', name: 'Куб', make: () => prism(rect(2, 2), 2) },
  { key: 'box', name: 'Прямоугольный параллелепипед', make: () => prism(rect(3, 2), 1.8) },
  { key: 'tri-prism', name: 'Правильная треугольная призма', make: () => prism(regular(3, 1.4), 2.4) },
  { key: 'quad-prism', name: 'Правильная четырёхугольная призма', make: () => prism(rect(2, 2), 3) },
  { key: 'hex-prism', name: 'Правильная шестиугольная призма', make: () => prism(regular(6, 1.3), 2.2) },
  { key: 'tetra', name: 'Треугольная пирамида (тетраэдр)', make: () => pyramid([[-1.6, -1], [1.7, -0.8], [0, 1.7]], [0.2, 2.6, 0.1]) },
  { key: 'quad-pyr', name: 'Четырёхугольная пирамида', make: () => pyramid(rect(2.6, 2), [0.2, 2.6, 0.1]) },
  { key: 'hex-pyr', name: 'Правильная шестиугольная пирамида', make: () => pyramid(regular(6, 1.4), [0, 2.8, 0]) },
  { key: 'reg-tetra', name: 'Правильный тетраэдр', make: () => { const a = 2.8; return pyramid(regular(3, a / Math.sqrt(3)), [0, a * Math.sqrt(2 / 3), 0], 'D'); } },
  { key: 'cyl', name: 'Цилиндр', make: () => ({ round: true, kind: 'cyl', R: 1.2, H: 2.6, geo: () => new THREE.CylinderGeometry(1.2, 1.2, 2.6, 64, 1) }) },
  { key: 'cone', name: 'Конус', make: () => ({ round: true, kind: 'cone', R: 1.3, H: 2.8, geo: () => new THREE.ConeGeometry(1.3, 2.8, 64, 1) }) },
  { key: 'sphere', name: 'Шар', make: () => ({ round: true, kind: 'sphere', R: 1.7, geo: () => new THREE.SphereGeometry(1.7, 48, 32) }) }
];

/* ---------- 2. МАТЕМАТИКА ---------- */
const dist = (pl, p) => pl.n.dot(p) - pl.d;           // расстояние со знаком от точки до плоскости

// Прямая пересечения двух плоскостей (null, если они параллельны)
function planeLine(p1, p2) {
  const dir = p1.n.clone().cross(p2.n), l2 = dir.lengthSq();
  if (l2 < 1e-8) return null;
  const pt = p2.n.clone().cross(dir).multiplyScalar(p1.d).add(dir.clone().cross(p1.n).multiplyScalar(p2.d)).multiplyScalar(1 / l2);
  dir.normalize();
  return { p: pt.sub(dir.clone().multiplyScalar(pt.dot(dir))), dir };   // p — ближайшая к началу координат точка прямой
}
// Упорядочивает точки выпуклого сечения по обходу вокруг центра (в плоскости с нормалью n)
function orderPoly(arr, n) {
  if (arr.length < 3) return arr;
  const c = arr.reduce((s, o) => s.add(o.p), V3(0, 0, 0)).multiplyScalar(1 / arr.length);
  const u = arr[0].p.clone().sub(c).normalize(), v = n.clone().cross(u);
  const ang = o => { const w = o.p.clone().sub(c); return Math.atan2(w.dot(v), w.dot(u)); };
  return arr.sort((a, b) => ang(a) - ang(b));
}
function onSeg(a, b, p) {
  const ab = b.clone().sub(a), t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
  return a.clone().addScaledVector(ab, t).distanceTo(p) < 2e-3;
}

/* ---------- 4. VUE + THREE.JS ---------- */
function makeLabel(text, color, scale) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 64px "Segoe UI", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 9; g.strokeStyle = '#0b1030'; g.strokeText(text, 64, 64);
  g.fillStyle = color; g.fillText(text, 64, 64);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  s.scale.set(scale, scale, 1); s.renderOrder = 20;
  return s;
}
function clearGroup(g) {
  while (g.children.length) {
    const o = g.children.pop();
    o.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } });
  }
}

createApp({
  setup() {
    // ----- реактивное состояние (то, что видно в интерфейсе) -----
    const view = ref(null), listEl = ref(null);
    const shapeKey = ref('cube'), mode = ref('auto');
    const step = ref(0), stepList = ref([]);
    const message = ref(''), isWarn = ref(false), polyName = ref('');
    const showHidden = ref(true), showVerts = ref(true), showPoints = ref(true), showExplain = ref(true);
    const color = ref('#f59e0b');
    const ptCount = ref(0), canUndo = ref(false);

    // ----- обычные переменные (3D-объекты не делаем реактивными) -----
    let renderer, scene, camera, controls, body = null, grid;
    let pts = [], history = [], build = null, camGoal = null, dragIdx = -1, dragSaved = false, downXY = null, base = { text: '', warn: false };
    const raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
    const bodyGroup = new THREE.Group(), secGroup = new THREE.Group(), ptGroup = new THREE.Group();
    const VIEWS = { iso: [5.5, 4.2, 6.5], front: [0, 0.3, 9], side: [9, 0.3, 0], top: [0.001, 10, 0.001] };

    /* ===== Сообщения ===== */
    const setBase = (text, warn) => { base = { text, warn }; message.value = text; isWarn.value = warn; };
    const flash = text => { message.value = text; isWarn.value = true; setTimeout(() => { message.value = base.text; isWarn.value = base.warn; }, 2600); };

    /* ===== Сцена ===== */
    function initThree() {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(...VIEWS.iso);
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      view.value.appendChild(renderer.domElement);
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = 0.08;
      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const dl = new THREE.DirectionalLight(0xffffff, 0.8); dl.position.set(4, 6, 5); scene.add(dl);
      grid = new THREE.GridHelper(12, 12, 0x4452b8, 0x242b6a); grid.position.y = -1.9;
      grid.material.transparent = true; grid.material.opacity = 0.5;
      scene.add(grid, bodyGroup, secGroup, ptGroup);
      const resize = () => {
        const w = view.value.clientWidth, h = view.value.clientHeight;
        renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
      };
      new ResizeObserver(resize).observe(view.value); resize();
      // pointerdown в фазе захвата — раньше OrbitControls, чтобы можно было перетаскивать точки
      const cv = renderer.domElement;
      cv.addEventListener('pointerdown', onDown, true);
      cv.addEventListener('pointermove', onMove);
      cv.addEventListener('pointerup', onUp);
      const tick = () => {
        requestAnimationFrame(tick);
        if (camGoal) { camera.position.lerp(camGoal, 0.15); if (camera.position.distanceTo(camGoal) < 0.02) camGoal = null; }
        controls.update(); renderer.render(scene, camera);
      };
      tick();
    }

    // Строит выбранное тело: прозрачные грани, видимые и невидимые рёбра, подписи вершин
    function buildBody(key) {
      clearGroup(bodyGroup);
      const def = SHAPES.find(s => s.key === key).make();
      let geo, edgeGeo;
      if (def.poly) {
        const pos = [];
        def.faces.forEach(f => { for (let i = 1; i < f.length - 1; i++) [f[0], f[i], f[i + 1]].forEach(k => pos.push(...def.verts[k].p.toArray())); });
        geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
        const ep = [];
        def.edges.forEach(([i, j]) => ep.push(...def.verts[i].p.toArray(), ...def.verts[j].p.toArray()));
        edgeGeo = new THREE.BufferGeometry(); edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3));
      } else {
        geo = def.geo();
        edgeGeo = def.kind === 'sphere' ? new THREE.WireframeGeometry(new THREE.SphereGeometry(def.R, 16, 12)) : new THREE.EdgesGeometry(geo, 25);
      }
      // «Глубинная» копия тела: нужна, чтобы отличать видимые рёбра от скрытых
      const depth = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      depth.renderOrder = 1;
      const faces = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x6d5dfc, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, shininess: 60 }));
      faces.renderOrder = 3;
      const solid = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xcfe8ff })); solid.renderOrder = 2;
      const hidden = new THREE.LineSegments(edgeGeo, new THREE.LineDashedMaterial({ color: 0x8b9cff, dashSize: 0.12, gapSize: 0.1, depthFunc: THREE.GreaterDepth }));
      hidden.computeLineDistances(); hidden.renderOrder = 2;
      bodyGroup.add(depth, faces, solid, hidden);
      const vLabels = [];
      if (def.poly) def.verts.forEach(v => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), new THREE.MeshBasicMaterial({ color: 0xe0f2fe }));
        m.position.copy(v.p); bodyGroup.add(m);
        const s = makeLabel(v.name, '#bfe3ff', 0.5);
        s.position.copy(v.p).add(v.p.clone().normalize().multiplyScalar(0.32));
        vLabels.push(s); bodyGroup.add(s);
      });
      body = { def, pick: faces, hidden, vLabels };
    }

    /* ===== Отрисовка сечения и пояснений ===== */
    function lineObj(a, b, col, dashed) {
      const g = new THREE.BufferGeometry().setFromPoints([a, b]);
      const l = new THREE.Line(g, dashed ? new THREE.LineDashedMaterial({ color: col, dashSize: 0.18, gapSize: 0.12, depthTest: false })
                                         : new THREE.LineBasicMaterial({ color: col, depthTest: false }));
      if (dashed) l.computeLineDistances();
      l.renderOrder = 12; return l;
    }
    function addFill(poly, col) {
      const c = poly.reduce((s, o) => s.add(o.p), V3(0, 0, 0)).multiplyScalar(1 / poly.length), pos = [];
      poly.forEach((o, i) => { const q = poly[(i + 1) % poly.length]; pos.push(...c.toArray(), ...o.p.toArray(), ...q.p.toArray()); });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
      m.renderOrder = 10; secGroup.add(m);
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(poly.map(o => o.p)), new THREE.LineBasicMaterial({ color: col.clone().offsetHSL(0, 0, 0.25), depthTest: false }));
      l.renderOrder = 12; secGroup.add(l);
    }
    function refresh3D() {
      if (!body) return;
      clearGroup(secGroup); clearGroup(ptGroup);
      body.hidden.visible = showHidden.value;
      body.vLabels.forEach(s => (s.visible = showVerts.value));
      // три заданные точки (с «невидимыми» увеличенными шарами для захвата мышью)
      pts.forEach((p, i) => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 16), new THREE.MeshBasicMaterial({ color: PT_COLORS[i], depthTest: false }));
        m.position.copy(p); m.renderOrder = 15; ptGroup.add(m);
        const hit = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
        hit.position.copy(p); hit.userData.idx = i; ptGroup.add(hit);
        if (showPoints.value) { const s = makeLabel(NAMES[i], PT_COLORS[i], 0.5); s.position.copy(p).add(V3(0, 0.26, 0)); ptGroup.add(s); }
      });
      if (!build) return;
      const col = new THREE.Color(color.value);
      for (let i = 0; i < step.value && i < build.steps.length; i++) {
        const st = build.steps[i];
        st.segs.forEach(s => secGroup.add(s.type === 'trace' ? lineObj(s.a, s.b, 0xc4b5fd, true) : lineObj(s.a, s.b, col.clone().offsetHSL(0, 0, 0.2), false)));
        st.pts.forEach(q => {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({ color: 0xa5f3fc, depthTest: false }));
          m.position.copy(q.p); m.renderOrder = 14; secGroup.add(m);
          if (q.label && showPoints.value) { const s = makeLabel(q.label, '#a5f3fc', 0.5); s.position.copy(q.p).add(V3(0, 0.26, 0)); secGroup.add(s); }
        });
        if (st.final) addFill(build.poly, col);
      }
    }

    /* ===== Вспомогательные функции для пояснений ===== */
    const vn = i => body.def.verts[i].name;
    const faceName = i => (i >= 0 ? body.def.planes[i].name : '?');
    const facesOf = p => body.def.planes.map((f, i) => (Math.abs(f.n.dot(p) - f.d) < 1e-3 ? i : -1)).filter(i => i >= 0);
    const common = (a, b) => { const fb = facesOf(b); return facesOf(a).filter(i => fb.includes(i)); };
    function describe(p) {
      const d = body.def, vi = d.verts.findIndex(v => v.p.distanceTo(p) < 2e-3);
      if (vi >= 0) return `совпадает с вершиной ${vn(vi)}`;
      const e = d.edges.find(([i, j]) => onSeg(d.verts[i].p, d.verts[j].p, p));
      if (e) return `лежит на ребре ${vn(e[0])}${vn(e[1])}`;
      return `лежит в грани ${faceName(facesOf(p)[0])}`;
    }
    const givenDesc = () => pts.map((p, i) => `${NAMES[i]} ${describe(p)}`).join('; ');
    const where = o => (o.edge ? ` на общем ребре ${vn(o.edge[0])}${vn(o.edge[1])}` : o.vert != null ? ` в вершине ${o.name}` : '');

    /* ===== Сечение: вычисление ===== */
    // Многогранник: пересекаем плоскость с каждым ребром
    function sectionPoly(pl) {
      const d = body.def, out = [];
      const add = (p, edge, vert) => { if (!out.some(o => o.p.distanceTo(p) < 1e-4)) out.push({ p, edge, vert }); };
      d.edges.forEach(([i, j]) => {
        const a = d.verts[i].p, b = d.verts[j].p, da = dist(pl, a), db = dist(pl, b);
        const za = Math.abs(da) < 1e-4, zb = Math.abs(db) < 1e-4;
        if (za) add(a.clone(), null, i);
        if (zb) add(b.clone(), null, j);
        if (!za && !zb && da * db < 0) add(a.clone().lerp(b, da / (da - db)), [i, j], null);   // вершины по разные стороны от α
      });
      return orderPoly(out, pl.n);
    }
    // Тела вращения: пересекаем плоскость с треугольниками сетки поверхности
    function sectionRound(pl) {
      const g = body.pick.geometry, pos = g.attributes.position, idx = g.index, out = [];
      const P = i => V3(pos.getX(i), pos.getY(i), pos.getZ(i));
      const add = p => { if (!out.some(o => o.p.distanceTo(p) < 2e-3)) out.push({ p }); };
      const nT = (idx ? idx.count : pos.count) / 3;
      for (let t = 0; t < nT; t++) {
        const v = [0, 1, 2].map(k => P(idx ? idx.getX(t * 3 + k) : t * 3 + k));
        for (let k = 0; k < 3; k++) {
          const a = v[k], b = v[(k + 1) % 3], da = dist(pl, a), db = dist(pl, b);
          if (da * db < 0) add(a.clone().lerp(b, da / (da - db))); else if (Math.abs(da) < 1e-6) add(a.clone());
        }
      }
      return orderPoly(out, pl.n);
    }

    /* ===== Пояснения: автоматическое построение ===== */
    function stepsAuto(pl, poly) {
      const st = [], drawn = new Set(), key = (a, b) => [a, b].sort().join('');
      const all = pts.map(facesOf).reduce((a, b) => a.filter(x => b.includes(x)));
      let t1 = `Точки M, N и K не лежат на одной прямой, поэтому они однозначно задают секущую плоскость α. ${givenDesc()}.`;
      if (all.length) t1 += ` Все три точки лежат в грани ${faceName(all[0])}, значит, α совпадает с плоскостью этой грани, а сечением является сама грань.`;
      st.push({ text: t1, segs: [], pts: [] });
      [[0, 1], [0, 2], [1, 2]].forEach(([i, j]) => {
        const a = NAMES[i], b = NAMES[j], c = common(pts[i], pts[j]);
        if (c.length) {
          drawn.add(key(a, b));
          st.push({ text: `Точки ${a} и ${b} лежат в одной грани ${faceName(c[0])}. Значит, прямая ${a}${b} лежит и в этой грани, и в плоскости α, то есть является линией их пересечения: отрезок ${a}${b} принадлежит сечению.`, segs: [{ a: pts[i], b: pts[j], type: 'solid' }], pts: [] });
        } else {
          st.push({ text: `Точки ${a} и ${b} не лежат ни в одной общей грани, поэтому отрезок ${a}${b} проходит внутри фигуры и стороной сечения не является. Ищем другие точки сечения.`, segs: [], pts: [] });
        }
      });
      poly.forEach(o => {
        if (o.given >= 0) return;
        if (o.vert != null) st.push({ text: `Плоскость α проходит через вершину ${o.name} фигуры, поэтому ${o.name} — вершина сечения.`, segs: [], pts: [{ p: o.p, label: null }] });
        else {
          const a = vn(o.edge[0]), b = vn(o.edge[1]);
          st.push({ text: `Вершины ${a} и ${b} лежат по разные стороны от плоскости α, поэтому α пересекает ребро ${a}${b} в точке ${o.name}. Она — вершина сечения.`, segs: [], pts: [{ p: o.p, label: o.name }] });
        }
      });
      poly.forEach((o, k) => {
        const q = poly[(k + 1) % poly.length];
        if (drawn.has(key(o.name, q.name))) return;
        const c = common(o.p, q.p), where2 = c.length ? `лежат в одной грани ${faceName(c[0])}, поэтому ` : '';
        st.push({ text: `Точки ${o.name} и ${q.name} ${where2}соединяем их отрезком ${o.name}${q.name} — стороной сечения.`, segs: [{ a: o.p, b: q.p, type: 'solid' }], pts: [] });
      });
      st.push(finalStep(poly));
      return st;
    }
    const finalStep = poly => ({ final: true, segs: [], pts: [],
      text: `Результат: последовательно соединив точки ${poly.map(o => o.name).join(', ')}, получаем ${POLY_NAMES[poly.length]} ${poly.map(o => o.name).join('')} — искомое сечение фигуры плоскостью α.` });

    /* ===== Пояснения: метод следов ===== */
    function stepsTraces(pl, poly) {
      const d = body.def, L = poly.length, st = [];
      st.push({ text: `Точки M, N и K не лежат на одной прямой и задают секущую плоскость α. ${givenDesc()}. Метод следов: следом плоскости α на грани называется прямая, по которой α пересекает плоскость этой грани. Построим следы и по ним найдём сечение.`, segs: [], pts: [] });
      const sides = poly.map((o, k) => { const q = poly[(k + 1) % L], c = common(o.p, q.p); return { a: o, b: q, f: c.length ? c[0] : -1 }; });
      const s0 = sides.findIndex(s => s.f === 0), rot = s0 >= 0 ? s0 : 0;
      const ordered = sides.slice(rot).concat(sides.slice(0, rot));
      const items = s0 >= 0 ? ordered : [{ f: 0, none: true }].concat(ordered);   // начинаем с основания (грань №0)
      const shown = new Set(); let prev = null;
      items.forEach(it => {
        const F = faceName(it.f), ln = it.f >= 0 ? planeLine(pl, d.planes[it.f]) : null, segs = [], pa = [];
        let text;
        if (ln) segs.push({ a: ln.p.clone().addScaledVector(ln.dir, -5), b: ln.p.clone().addScaledVector(ln.dir, 5), type: 'trace' });
        if (it.none) {
          text = ln ? `След α на плоскости основания ${F} — штриховая прямая. Она не даёт стороны сечения на этой грани (проходит вне основания или касается его).`
                    : `Плоскость α параллельна плоскости основания ${F}, поэтому следа на основании нет.`;
        } else {
          segs.push({ a: it.a.p, b: it.b.p, type: 'solid' });
          text = ln ? `След α на плоскости грани ${F} — штриховая прямая. Её часть внутри грани — отрезок ${it.a.name}${it.b.name}: это сторона сечения.`
                    : `Плоскость α совпадает с плоскостью грани ${F}, поэтому отрезок ${it.a.name}${it.b.name} — сторона самой грани и сторона сечения.`;
          if (prev && prev.b === it.a && it.a.given < 0) text += ` Точка ${it.a.name} — пересечение следов соседних граней${where(it.a)}.`;
          [it.a, it.b].forEach(o => { if (o.given < 0 && !shown.has(o.name)) { shown.add(o.name); pa.push({ p: o.p, label: o.vert != null ? null : o.name }); } });
          prev = it;
        }
        st.push({ text, segs, pts: pa });
      });
      st.push(finalStep(poly));
      return st;
    }

    /* ===== Пояснения: тела вращения ===== */
    function roundName(pl) {
      const d = body.def;
      if (d.kind === 'sphere' || Math.abs(pl.n.y) > 0.9999) return 'круг';
      return 'плоская фигура (эллипс, парабола, гипербола или многоугольник)';
    }
    function stepsRound(pl, poly) {
      const d = body.def, st = [], R = d.R;
      st.push({ text: 'Точки M, N и K лежат на поверхности тела и не лежат на одной прямой, поэтому задают секущую плоскость α.', segs: [], pts: [] });
      if (d.kind === 'sphere') {
        const h = Math.abs(pl.d);
        st.push({ text: `Находим расстояние от центра шара O до плоскости α: h = ${fmt(h)}. Радиус шара R = ${fmt(R)}.`, segs: [], pts: [] });
        st.push({ text: `Так как h < R, плоскость пересекает шар по окружности радиуса r = √(R² − h²) = ${fmt(Math.sqrt(Math.max(0, R * R - h * h)))}; сечение — круг.`, segs: [], pts: [] });
      } else if (mode.value === 'traces') {
        const ln = planeLine(pl, { n: V3(0, 1, 0), d: -d.H / 2 });
        if (!ln) st.push({ text: 'Плоскость α параллельна основанию, поэтому следа на основании нет; сечение — круг.', segs: [], pts: [] });
        else {
          const segs = [{ a: ln.p.clone().addScaledVector(ln.dir, -5), b: ln.p.clone().addScaledVector(ln.dir, 5), type: 'trace' }];
          const a = ln.dir.x ** 2 + ln.dir.z ** 2, b = 2 * (ln.p.x * ln.dir.x + ln.p.z * ln.dir.z), c = ln.p.x ** 2 + ln.p.z ** 2 - R * R, D = b * b - 4 * a * c;
          if (D > 0) {
            const t1 = (-b - Math.sqrt(D)) / (2 * a), t2 = (-b + Math.sqrt(D)) / (2 * a);
            st.push({ text: 'След α на плоскости нижнего основания — штриховая прямая. Она пересекает окружность основания в точках P и Q: это крайние точки сечения на основании.', segs,
              pts: [{ p: ln.p.clone().addScaledVector(ln.dir, t1), label: 'P' }, { p: ln.p.clone().addScaledVector(ln.dir, t2), label: 'Q' }] });
          } else st.push({ text: 'След α на плоскости нижнего основания — штриховая прямая. Она не пересекает круг основания, поэтому сечение не доходит до основания.', segs, pts: [] });
        }
        st.push({ text: 'Остальные точки сечения получаем, пересекая α с образующими боковой поверхности; соединяем их плавной линией через M, N, K.', segs: [], pts: [] });
      } else {
        st.push({ text: `Плоскость α пересекает поверхность тела по плоской замкнутой кривой. Находим точки пересечения α с поверхностью (найдено ${poly.length}) и соединяем их плавной линией.`, segs: [], pts: [] });
      }
      st.push({ final: true, segs: [], pts: [], text: `Результат: получено сечение — ${roundName(pl)}.` });
      return st;
    }

    /* ===== Главный пересчёт ===== */
    function fail(text) { setBase(text, true); step.value = 0; refresh3D(); }
    function recompute() {
      const had = !!build;
      build = null; polyName.value = ''; stepList.value = []; ptCount.value = pts.length;
      if (pts.length < 3) {
        const k = 3 - pts.length;
        setBase(`Поставьте на фигуре ещё ${k} ${k === 1 ? 'точку' : 'точки'} (клик по ребру, вершине или грани).`, false);
        step.value = 0; refresh3D(); return;
      }
      const [A, B, C] = pts;
      if (A.distanceTo(B) < 0.04 || A.distanceTo(C) < 0.04 || B.distanceTo(C) < 0.04) return fail('Две из точек M, N, K совпадают — плоскость не определена. Передвиньте точку.');
      const n = B.clone().sub(A).cross(C.clone().sub(A));
      if (n.length() < 2e-3) return fail('Точки M, N и K лежат на одной прямой, поэтому через них проходит бесконечно много плоскостей. Передвиньте одну из точек.');
      n.normalize();
      const pl = { n, d: n.dot(A) };
      const poly = body.def.poly ? sectionPoly(pl) : sectionRound(pl);
      if (poly.length < 3) return fail('Плоскость только касается фигуры — сечения нет. Передвиньте точки.');
      if (body.def.poly) {                                   // даём имена вершинам сечения
        let ex = 0;
        poly.forEach(o => {
          o.given = pts.findIndex(q => q.distanceTo(o.p) < 2e-3);
          o.name = o.given >= 0 ? NAMES[o.given] : o.vert != null ? vn(o.vert) : EXTRA[ex++];
        });
      }
      const steps = body.def.poly ? (mode.value === 'auto' ? stepsAuto(pl, poly) : stepsTraces(pl, poly)) : stepsRound(pl, poly);
      build = { steps, poly };
      stepList.value = steps.map(s => ({ text: s.text, final: !!s.final }));
      polyName.value = body.def.poly ? `${POLY_NAMES[poly.length]} ${poly.map(o => o.name).join('')}` : roundName(pl);
      step.value = mode.value === 'auto' ? steps.length : (had ? Math.min(Math.max(step.value, 1), steps.length) : 1);
      setBase(`Сечение построено: ${polyName.value}.`, false);
      refresh3D();
    }

    /* ===== Мышь: постановка и перетаскивание точек ===== */
    function ndc(ev) {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set((ev.clientX - r.left) / r.width * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(mouse, camera);
    }
    // Прилипание: к вершине, затем к ребру (точки ставятся только на поверхности)
    function snap(p) {
      const d = body.def; let best = null, bd = 0.22;
      d.verts.forEach(v => { const k = v.p.distanceTo(p); if (k < bd) { bd = k; best = v.p.clone(); } });
      if (best) return best;
      bd = 0.17;
      d.edges.forEach(([i, j]) => {
        const a = d.verts[i].p, b = d.verts[j].p, ab = b.clone().sub(a);
        const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq()));
        const q = a.clone().addScaledVector(ab, t), k = q.distanceTo(p);
        if (k < bd) { bd = k; best = q; }
      });
      return best || p;
    }
    function pickBody(ev) {
      ndc(ev);
      const h = raycaster.intersectObject(body.pick)[0];
      if (!h) return null;
      return body.def.poly ? snap(h.point.clone()) : h.point.clone();
    }
    const hitMeshes = () => ptGroup.children.filter(c => c.userData.idx !== undefined);
    function onDown(ev) {
      if (ev.button !== 0) return;
      downXY = [ev.clientX, ev.clientY]; ndc(ev);
      const h = raycaster.intersectObjects(hitMeshes())[0];
      if (h) { dragIdx = h.object.userData.idx; dragSaved = false; controls.enabled = false; renderer.domElement.setPointerCapture(ev.pointerId); }
    }
    function onMove(ev) {
      if (dragIdx >= 0) {
        const p = pickBody(ev);
        if (p) { if (!dragSaved) { pushHistory(); dragSaved = true; } pts[dragIdx].copy(p); recompute(); }
      } else {
        ndc(ev); renderer.domElement.style.cursor = raycaster.intersectObjects(hitMeshes())[0] ? 'grab' : 'default';
      }
    }
    function onUp(ev) {
      if (dragIdx >= 0) { dragIdx = -1; controls.enabled = true; return; }
      if (ev.button !== 0 || !downXY) return;
      const moved = Math.hypot(ev.clientX - downXY[0], ev.clientY - downXY[1]); downXY = null;
      if (moved > 5) return;                                 // это было вращение, а не клик
      if (pts.length >= 3) return flash('Уже стоят три точки: перетащите любую из них или нажмите «Удалить точки».');
      const p = pickBody(ev);
      if (!p) return;
      pushHistory(); pts.push(p); recompute();
    }

    /* ===== Кнопки ===== */
    function pushHistory() { history.push(pts.map(p => p.clone())); canUndo.value = true; }
    function undo() { if (!history.length) return; pts = history.pop(); canUndo.value = history.length > 0; build = null; recompute(); }
    function clearPoints() { if (!pts.length) return; pushHistory(); pts = []; build = null; recompute(); }
    function selectShape(key) {
      shapeKey.value = key; pts = []; history = []; canUndo.value = false; build = null;
      buildBody(key); recompute();
    }
    function setMode(m) { mode.value = m; if (pts.length >= 3) { build = null; recompute(); } }
    function showAnswer() {
      if (!build) return flash('Сначала поставьте три точки или нажмите «Автопостроение».');
      step.value = build.steps.length; showExplain.value = true;
    }
    function setView(name) { camGoal = V3(...VIEWS[name]); }
    function resetCamera() { controls.target.set(0, 0, 0); setView('iso'); }
    // Автопостроение: случайные три точки, дающие настоящее сечение
    function autoBuild() {
      for (let tries = 0; tries < 300; tries++) {
        let cand = [];
        if (body.def.poly) {
          const E = body.def.edges, ids = new Set();
          while (ids.size < 3) ids.add(Math.floor(Math.random() * E.length));
          cand = [...ids].map(k => body.def.verts[E[k][0]].p.clone().lerp(body.def.verts[E[k][1]].p, 0.2 + Math.random() * 0.6));
        } else {
          for (let k = 0; k < 3; k++) {
            const dir = V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
            raycaster.set(dir.clone().multiplyScalar(8), dir.clone().negate());
            const h = raycaster.intersectObject(body.pick)[0];
            if (h) cand.push(h.point.clone());
          }
          if (cand.length < 3) continue;
        }
        if (cand[1].clone().sub(cand[0]).cross(cand[2].clone().sub(cand[0])).length() < 0.4) continue;
        if (body.def.poly) { const f = cand.map(facesOf); if (f[0].some(i => f[1].includes(i) && f[2].includes(i))) continue; }
        pushHistory(); pts = cand; build = null; recompute(); return;
      }
    }

    watch([step, color, showHidden, showVerts, showPoints], refresh3D);
    watch(step, () => nextTick(() => { const el = listEl.value; if (el) el.scrollTop = el.scrollHeight; }));
    onMounted(() => { initThree(); selectShape('cube'); });

    return {
      view, listEl, shapes: SHAPES.map(({ key, name }) => ({ key, name })), shapeKey, mode, step, stepList, message, isWarn, polyName,
      showHidden, showVerts, showPoints, showExplain, color, ptCount, canUndo,
      selectShape, setMode, undo, clearPoints, autoBuild, showAnswer, setView, resetCamera
    };
  }
}).mount('#app');
