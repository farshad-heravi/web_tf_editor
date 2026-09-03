import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { setAxesResolution } from "./axes_helper.js";

/**
 * Owns the three.js scene, camera, renderer, orbit/transform controls and the render loop.
 */
export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1b1e23);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    this.camera.position.set(1.5, 1.5, 1.2);
    this.camera.up.set(0, 0, 1); // ROS convention: Z up

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0, 0.2);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.1;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.addEventListener("dragging-changed", (e) => {
      this.orbit.enabled = !e.value;
    });
    this.scene.add(this.transformControls.getHelper?.() ?? this.transformControls);

    this._setupLights();
    this._setupGround();

    this.robotRoot = new THREE.Group();
    this.scene.add(this.robotRoot);

    this.framesRoot = new THREE.Group();
    this.scene.add(this.framesRoot);

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(canvas.parentElement);
    this._onResize();

    this._clock = new THREE.Clock();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _setupLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x33363f, 1.2);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(2, 2, 3);
    this.scene.add(dir);
  }

  _setupGround() {
    const grid = new THREE.GridHelper(10, 20, 0x4da3ff, 0x363a42);
    grid.rotateX(Math.PI / 2); // GridHelper is XZ by default; rotate onto XY (Z up)
    this.scene.add(grid);

    // Invisible ground plane (z = 0) used for empty-space raycasting.
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  }

  _onResize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth;
    const h = el.clientHeight;
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    setAxesResolution(w, h);
  }

  _animate() {
    requestAnimationFrame(this._animate);
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Camera-facing plane through a given point, used as the drag/empty-space fallback. */
  cameraFacingPlane(point) {
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
  }

  screenToRay(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster;
  }
}
