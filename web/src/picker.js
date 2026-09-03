import * as THREE from "three";
import { basisAlignedTo } from "./frames.js";

const DRAG_MIN_LENGTH = 0.01;

/**
 * Handles "add frame" mode: pick a point on the robot or in empty space, drag to set a
 * direction, release to create the frame (Z axis aligned to the drag direction).
 */
export class Picker {
  constructor({ viewer, frameManager, hintEl }) {
    this.viewer = viewer;
    this.frameManager = frameManager;
    this.hintEl = hintEl;
    this.active = false;
    this._dragging = false;
    this._origin = null;
    this._raycaster = new THREE.Raycaster();

    this._hoverDot = this._makeHoverDot();
    this._dropLine = this._makeDropLine();
    this._dragArrow = null;
    viewer.scene.add(this._hoverDot, this._dropLine);
    this._hoverDot.visible = false;
    this._dropLine.visible = false;

    const dom = viewer.renderer.domElement;
    dom.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    dom.addEventListener("pointermove", (e) => this._onPointerMove(e));
    window.addEventListener("pointerup", (e) => this._onPointerUp(e));
  }

  _makeHoverDot() {
    const geo = new THREE.SphereGeometry(0.012, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0x4da3ff });
    return new THREE.Mesh(geo, mat);
  }

  _makeDropLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const mat = new THREE.LineDashedMaterial({ color: 0x4da3ff, dashSize: 0.02, gapSize: 0.02 });
    const line = new THREE.Line(geo, mat);
    return line;
  }

  setActive(active) {
    this.active = active;
    this.viewer.canvas.style.cursor = active ? "crosshair" : "default";
    this._hoverDot.visible = false;
    this._dropLine.visible = false;
    this.hintEl.textContent = active
      ? "Click a point (robot or empty space) and drag to set direction, release to place"
      : "";
  }

  /** Robot meshes first, then ground plane (z=0), then a camera-facing plane through the orbit target. */
  _pickPoint(clientX, clientY) {
    const raycaster = this.viewer.screenToRay(clientX, clientY);
    const hits = raycaster.intersectObject(this.viewer.robotRoot, true);
    if (hits.length > 0) return hits[0].point.clone();

    const groundHit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(this.viewer.groundPlane, groundHit)) {
      return groundHit;
    }

    const fallbackPlane = this.viewer.cameraFacingPlane(this.viewer.orbit.target);
    const fallbackHit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(fallbackPlane, fallbackHit)) {
      return fallbackHit;
    }
    return null;
  }

  _onPointerDown(e) {
    if (!this.active || e.button !== 0) return;
    const point = this._pickPoint(e.clientX, e.clientY);
    if (!point) return;
    this._dragging = true;
    this._origin = point;
    this.viewer.orbit.enabled = false;

    this._dragArrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), point, 0.001, 0x4da3ff, 0.03, 0.02);
    this.viewer.scene.add(this._dragArrow);
    this._hoverDot.visible = false;
    this._dropLine.visible = false;
  }

  _onPointerMove(e) {
    if (!this.active) return;

    if (this._dragging) {
      const dragPlane = this.viewer.cameraFacingPlane(this._origin);
      const raycaster = this.viewer.screenToRay(e.clientX, e.clientY);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(dragPlane, hit)) {
        const delta = hit.clone().sub(this._origin);
        const length = delta.length();
        if (length > 1e-6) {
          this._dragArrow.setDirection(delta.clone().normalize());
          this._dragArrow.setLength(Math.max(length, 0.02), 0.03, 0.02);
        }
      }
      return;
    }

    const point = this._pickPoint(e.clientX, e.clientY);
    if (!point) {
      this._hoverDot.visible = false;
      this._dropLine.visible = false;
      return;
    }
    this._hoverDot.visible = true;
    this._hoverDot.position.copy(point);

    const ground = new THREE.Vector3(point.x, point.y, 0);
    if (ground.distanceTo(point) > 1e-4) {
      this._dropLine.visible = true;
      const positions = this._dropLine.geometry.attributes.position;
      positions.setXYZ(0, point.x, point.y, point.z);
      positions.setXYZ(1, ground.x, ground.y, ground.z);
      positions.needsUpdate = true;
      this._dropLine.computeLineDistances();
    } else {
      this._dropLine.visible = false;
    }
  }

  _onPointerUp(e) {
    if (!this.active || !this._dragging) return;
    this._dragging = false;
    this.viewer.orbit.enabled = true;

    const dragPlane = this.viewer.cameraFacingPlane(this._origin);
    const raycaster = this.viewer.screenToRay(e.clientX, e.clientY);
    const hit = new THREE.Vector3();
    let direction = new THREE.Vector3(0, 0, 1);
    if (raycaster.ray.intersectPlane(dragPlane, hit)) {
      const delta = hit.clone().sub(this._origin);
      if (delta.length() > DRAG_MIN_LENGTH) direction = delta.normalize();
    }

    if (this._dragArrow) {
      this.viewer.scene.remove(this._dragArrow);
      this._dragArrow = null;
    }

    const quaternion = basisAlignedTo("z", direction);
    const frame = this.frameManager.create({
      name: null,
      parentFrame: this.frameManager.fixedFrame,
      worldPosition: this._origin,
      worldQuaternion: quaternion,
    });
    frame.dragDirection = direction.clone();

    this.setActive(false);
    this._onPlaced?.(frame);
  }

  onPlaced(cb) {
    this._onPlaced = cb;
  }
}
