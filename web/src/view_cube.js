import * as THREE from "three";

// World axes follow REP103 (X forward/front, Y left, Z up). Every clickable region (6 faces,
// 12 edges, 8 corners) is keyed by a [fx, fy, fz] coefficient triple in {-1,0,1} (not all zero):
// its view direction is normalize(fx, fy, fz), i.e. the sum of the world axes it touches.
const AXES = [0, 1, 2];
const FACE_LABELS = { "1,0,0": "Front", "-1,0,0": "Back", "0,1,0": "Left", "0,-1,0": "Right", "0,0,1": "Top", "0,0,-1": "Bottom" };

// Reference "up" for laying out a face's label text -- world Z, except on the Top/Bottom faces
// themselves, where the face normal *is* Z, so the text basis needs a different reference axis.
// This is unrelated to (and must never be assigned to) the main camera's `up`: OrbitControls
// fixes its orbit axis to whatever `camera.up` was at construction time (Z here), so permanently
// changing camera.up to look "correct" for a top-down view instead makes every later drag roll
// around the wrong axis.
function textUpFor(coeffs) {
  const isPureVertical = coeffs[2] !== 0 && coeffs[0] === 0 && coeffs[1] === 0;
  return isPureVertical ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
}

const CUBE_HALF = 0.75;
const CHAMFER = 0.24; // size of each edge/corner bevel facet
const INNER = CUBE_HALF - CHAMFER; // half-size of the inset main faces
const CAM_DISTANCE = 4;

function makeFaceTexture(label) {
  // Rendered at 4x the on-screen face size (a ~24px face at the default camera distance) so
  // text stays crisp instead of blurring out at native canvas resolution.
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#2b2f37";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#4a4f58";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, size - 8, size - 8);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let fontSize = 84;
  const font = (px) => `800 ${px}px system-ui, -apple-system, sans-serif`;
  ctx.font = font(fontSize);
  while (ctx.measureText(label).width > size * 0.82 && fontSize > 24) {
    fontSize -= 2;
    ctx.font = font(fontSize);
  }
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 8;
  ctx.fillStyle = "#f7f8fa";
  ctx.fillText(label, size / 2, size / 2 + fontSize * 0.03);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

// A plane per face (rather than a single BoxGeometry) so each face's text orientation can be
// pinned explicitly to `up` -- BoxGeometry's per-face UV axes don't agree with each other, which
// left labels reading sideways on some faces.
function makeFaceMesh(coeffs) {
  const normal = new THREE.Vector3(...coeffs).normalize();
  const up = textUpFor(coeffs);
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const trueUp = new THREE.Vector3().crossVectors(normal, right).normalize();

  const geo = new THREE.PlaneGeometry(INNER * 2, INNER * 2);
  const label = FACE_LABELS[coeffs.join(",")];
  const material = new THREE.MeshBasicMaterial({ map: makeFaceTexture(label) });
  const mesh = new THREE.Mesh(geo, material);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, trueUp, normal));
  mesh.position.copy(normal).multiplyScalar(CUBE_HALF);
  return mesh;
}

// Orders a triangle's vertices so its (right-hand-rule) normal points along `outward`, since we
// build these from raw corner coordinates rather than a parametric geometry.
function orientedTriangle(v1, v2, v3, outward) {
  const normal = new THREE.Vector3()
    .subVectors(v2, v1)
    .cross(new THREE.Vector3().subVectors(v3, v1));
  return normal.dot(outward) < 0 ? [v1, v3, v2] : [v1, v2, v3];
}

function triMeshFromVerts(verts, material) {
  const positions = verts.flatMap((v) => [v.x, v.y, v.z]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

// The chamfer facet for a 2-nonzero-coefficient edge is the rectangle connecting the two
// adjacent inset faces' near boundaries; for a 3-nonzero-coefficient corner it's the triangle
// connecting all three. Both are planar by construction.
function makeBevelMesh(coeffs, material) {
  const nz = AXES.filter((i) => coeffs[i] !== 0);
  const outward = new THREE.Vector3(...coeffs).normalize();

  if (nz.length === 2) {
    // Rectangle connecting the two adjacent inset faces' near boundaries. Planar since
    // (signed a-component) + (signed b-component) = INNER + CUBE_HALF for every vertex,
    // independent of the free axis's value.
    const [a, b] = nz;
    const f = AXES.find((i) => coeffs[i] === 0);
    const [sa, sb] = [coeffs[a], coeffs[b]];
    const pt = (aVal, bVal, fVal) => {
      const v = new THREE.Vector3();
      v.setComponent(a, sa * aVal);
      v.setComponent(b, sb * bVal);
      v.setComponent(f, fVal);
      return v;
    };
    const p1 = pt(INNER, CUBE_HALF, -INNER);
    const p2 = pt(INNER, CUBE_HALF, INNER);
    const p3 = pt(CUBE_HALF, INNER, INNER);
    const p4 = pt(CUBE_HALF, INNER, -INNER);
    const [t1a, t1b, t1c] = orientedTriangle(p1, p2, p3, outward);
    const [t2a, t2b, t2c] = orientedTriangle(p1, p3, p4, outward);
    return triMeshFromVerts([t1a, t1b, t1c, t2a, t2b, t2c], material);
  }

  // nz.length === 3: triangle connecting all three adjacent inset faces' near corners.
  const [s0, s1, s2] = coeffs;
  const v1 = new THREE.Vector3(s0 * CUBE_HALF, s1 * INNER, s2 * INNER);
  const v2 = new THREE.Vector3(s0 * INNER, s1 * CUBE_HALF, s2 * INNER);
  const v3 = new THREE.Vector3(s0 * INNER, s1 * INNER, s2 * CUBE_HALF);
  const [a, b, c] = orientedTriangle(v1, v2, v3, outward);
  return triMeshFromVerts([a, b, c], material);
}

function allRegionCoeffs() {
  const combos = [];
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        if (x === 0 && y === 0 && z === 0) continue;
        combos.push([x, y, z]);
      }
    }
  }
  return combos;
}

/**
 * Onshape-style view cube, overlaid in the top-right of the viewport (not a panel widget).
 * Click a face for Front/Back/Left/Right/Top/Bottom, or an edge/corner bevel for the matching
 * combined (e.g. Front-Top-Right) view. Runs its own tiny scene/renderer, mirroring the main
 * camera's orientation each frame.
 */
export class ViewCube {
  constructor({ viewer, canvas }) {
    this.viewer = viewer;
    this.canvas = canvas;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(96, 96, true);

    this._raycaster = new THREE.Raycaster();
    this._hovered = null;

    this._buildCube();
    this.scene.add(new THREE.AmbientLight(0xffffff, 1));

    canvas.addEventListener("pointermove", (e) => this._onPointerMove(e));
    canvas.addEventListener("pointerleave", () => this._setHovered(null));
    canvas.addEventListener("click", (e) => this._onClick(e));

    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _buildCube() {
    this.regionGroup = new THREE.Group();
    this.regions = [];

    for (const coeffs of allRegionCoeffs()) {
      const nz = AXES.filter((i) => coeffs[i] !== 0).length;
      let mesh;
      if (nz === 1) {
        mesh = makeFaceMesh(coeffs);
      } else {
        const material = new THREE.MeshBasicMaterial({ color: 0x363b44 });
        mesh = makeBevelMesh(coeffs, material);
      }
      mesh.userData.dir = new THREE.Vector3(...coeffs).normalize();
      this.regionGroup.add(mesh);
      this.regions.push(mesh);
    }
    this.scene.add(this.regionGroup);
  }

  _pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this.regions, false);
    return hits.length > 0 ? hits[0].object : null;
  }

  _setHovered(mesh) {
    if (mesh === this._hovered) return;
    if (this._hovered) this._hovered.material.color.set(this._hovered.userData.baseColor);
    if (mesh) {
      mesh.userData.baseColor ??= mesh.material.color.getHex();
      mesh.material.color.set(0x9fcaff);
    }
    this._hovered = mesh;
    this.canvas.style.cursor = mesh ? "pointer" : "default";
  }

  _onPointerMove(e) {
    this._setHovered(this._pick(e.clientX, e.clientY));
  }

  _onClick(e) {
    const mesh = this._pick(e.clientX, e.clientY);
    if (mesh) this._applyView(mesh.userData.dir);
  }

  // Camera.up is always left at world Z: OrbitControls' orbit axis is fixed to it at
  // construction time, so changing it here (even for a "straight down" Top/Bottom view) would
  // desync later drags from it -- see the note by textUpFor(). At the two poles where the view
  // direction is exactly parallel to Z, three.js's own Camera.lookAt() already falls back to a
  // stable nudged basis, which is all the degenerate case needs.
  _applyView(dir) {
    const { camera, orbit } = this.viewer;
    const distance = camera.position.distanceTo(orbit.target);
    camera.position.copy(orbit.target).addScaledVector(dir, distance);
    camera.up.set(0, 0, 1);
    camera.lookAt(orbit.target);
  }

  /** Named-face convenience, e.g. setView("front"). */
  setView(name) {
    const coeffs = Object.entries(FACE_LABELS).find(([, v]) => v.toLowerCase() === name)?.[0];
    if (!coeffs) return;
    const arr = coeffs.split(",").map(Number);
    this._applyView(new THREE.Vector3(...arr).normalize());
  }

  _animate() {
    requestAnimationFrame(this._animate);
    const dir = new THREE.Vector3();
    this.viewer.camera.getWorldDirection(dir);
    this.camera.position.copy(dir).multiplyScalar(-CAM_DISTANCE);
    this.camera.up.copy(this.viewer.camera.up);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }
}
