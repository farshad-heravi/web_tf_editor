import * as THREE from "three";
import { makeTransformStampedMessage } from "./ros.js";

const AXIS_SIZE = 0.15;

function makeLabelSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = "32px system-ui, sans-serif";
  ctx.fillStyle = "#e6e6e6";
  ctx.fillText(text, 4, 44);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.24, 0.06, 1);
  sprite.position.set(0, 0, AXIS_SIZE * 1.4);
  sprite.renderOrder = 999;
  return sprite;
}

/**
 * Right-handed orthonormal basis with `primaryAxis` ('x'|'y'|'z') aligned to `dir`.
 * Falls back from the Z-up hint to world +X when `dir` is near-parallel to it.
 */
export function basisAlignedTo(primaryAxis, dir, upHintIn) {
  const primary = dir.clone().normalize();
  let upHint = (upHintIn ? upHintIn.clone() : new THREE.Vector3(0, 0, 1)).normalize();
  if (Math.abs(primary.dot(upHint)) > 0.99) {
    upHint = new THREE.Vector3(1, 0, 0);
  }

  let x, y, z;
  if (primaryAxis === "z") {
    z = primary;
    x = new THREE.Vector3().crossVectors(upHint, z).normalize();
    y = new THREE.Vector3().crossVectors(z, x).normalize();
  } else if (primaryAxis === "x") {
    x = primary;
    y = new THREE.Vector3().crossVectors(upHint, x).normalize();
    z = new THREE.Vector3().crossVectors(x, y).normalize();
  } else {
    y = primary;
    z = new THREE.Vector3().crossVectors(upHint, y).normalize();
    x = new THREE.Vector3().crossVectors(y, z).normalize();
  }
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

let _autoId = 1;

export class Frame {
  constructor(name, parentFrame, localPosition, localQuaternion) {
    this.name = name;
    this.parentFrame = parentFrame;
    this.local = { position: localPosition.clone(), quaternion: localQuaternion.clone() };
    this.visible = true;
    this.published = false;
    this.dragDirection = null; // last drag direction (world space), for context-menu realign

    this.group = new THREE.Group();
    this.group.add(new THREE.AxesHelper(AXIS_SIZE));
    this.group.add(makeLabelSprite(name));
  }

  static autoName() {
    return `frame_${_autoId++}`;
  }
}

export class FrameManager {
  constructor({ viewer, ros, tfTree, fixedFrame }) {
    this.viewer = viewer;
    this.ros = ros;
    this.tfTree = tfTree;
    this.fixedFrame = fixedFrame;
    this.frames = new Map();
    this.selected = null;
    this._onChange = [];

    this._setTopic = ros.advertiseAndPublish("/interactive_frame/set", "geometry_msgs/TransformStamped");
    this._deleteTopic = ros.advertiseAndPublish("/interactive_frame/delete", "std_msgs/String");

    viewer.transformControls.addEventListener("objectChange", () => {
      const frame = this._frameForGroup(viewer.transformControls.object);
      if (frame) this._onGizmoChange(frame);
    });
  }

  onChange(cb) {
    this._onChange.push(cb);
  }

  _emitChange() {
    for (const cb of this._onChange) cb(this.list());
  }

  list() {
    return Array.from(this.frames.values());
  }

  _frameForGroup(group) {
    for (const f of this.frames.values()) if (f.group === group) return f;
    return null;
  }

  create({ name, parentFrame, worldPosition, worldQuaternion }) {
    const finalName = name || Frame.autoName();
    const parentWorld = this.tfTree.getWorldTransform(parentFrame);
    const parentQuatInv = parentWorld.quaternion.clone().invert();
    const localPosition = worldPosition.clone().sub(parentWorld.position).applyQuaternion(parentQuatInv);
    const localQuaternion = parentQuatInv.clone().multiply(worldQuaternion);

    const frame = new Frame(finalName, parentFrame, localPosition, localQuaternion);
    this.frames.set(finalName, frame);
    this.viewer.framesRoot.add(frame.group);
    this.tfTree.setLocalEdge(finalName, parentFrame, localPosition, localQuaternion);
    this._syncGroupTransform(frame);
    this.select(frame);
    return frame;
  }

  rename(frame, newName) {
    if (newName === frame.name) return true;
    if (!newName || newName.includes("/") || this.frames.has(newName)) return false;
    const wasPublished = frame.published;
    if (wasPublished) this._publishDelete(frame.name);
    this.frames.delete(frame.name);
    frame.name = newName;
    frame.group.remove(frame.group.children[1]); // old label sprite
    frame.group.add(makeLabelSprite(newName));
    this.frames.set(newName, frame);
    this.tfTree.setLocalEdge(newName, frame.parentFrame, frame.local.position, frame.local.quaternion);
    if (wasPublished) this._publishSet(frame);
    this._emitChange();
    return true;
  }

  setParent(frame, newParentFrame) {
    if (newParentFrame === frame.parentFrame) return;
    const worldBefore = this.tfTree.getWorldTransform(frame.name);
    frame.parentFrame = newParentFrame;
    const parentWorld = this.tfTree.getWorldTransform(newParentFrame);
    const parentQuatInv = parentWorld.quaternion.clone().invert();
    frame.local.position = worldBefore.position.clone().sub(parentWorld.position).applyQuaternion(parentQuatInv);
    frame.local.quaternion = parentQuatInv.clone().multiply(worldBefore.quaternion);
    this.tfTree.setLocalEdge(frame.name, newParentFrame, frame.local.position, frame.local.quaternion);
    this._syncGroupTransform(frame);
    if (frame.published) this._publishSet(frame);
    this._emitChange();
  }

  setLocalPose(frame, position, quaternion) {
    frame.local.position.copy(position);
    frame.local.quaternion.copy(quaternion);
    this.tfTree.setLocalEdge(frame.name, frame.parentFrame, frame.local.position, frame.local.quaternion);
    this._syncGroupTransform(frame);
    if (frame.published) this._publishSet(frame);
    this._emitChange();
  }

  alignAxis(frame, axis) {
    if (!frame.dragDirection) return;
    frame.local.quaternion.copy(basisAlignedTo(axis, frame.dragDirection));
    this.tfTree.setLocalEdge(frame.name, frame.parentFrame, frame.local.position, frame.local.quaternion);
    this._syncGroupTransform(frame);
    if (frame.published) this._publishSet(frame);
    this._emitChange();
  }

  setVisible(frame, visible) {
    frame.visible = visible;
    frame.group.visible = visible;
    this._emitChange();
  }

  get gizmoOn() {
    return !!this._gizmoOn;
  }

  /** Select a frame for editing in the panel. Does not by itself show the 6-DoF gizmo. */
  select(frame) {
    this.selected = frame;
    if (!frame) {
      this._gizmoOn = false;
      this.viewer.transformControls.detach();
    } else if (this._gizmoOn) {
      this.viewer.transformControls.attach(frame.group);
    } else {
      this.viewer.transformControls.detach();
    }
    this._emitChange();
  }

  showGizmo(frame) {
    this._gizmoOn = true;
    this.select(frame);
  }

  /** Hides the gizmo but keeps the frame selected (unlike select(null), which deselects it). */
  hideGizmo() {
    this._gizmoOn = false;
    this.viewer.transformControls.detach();
    this._emitChange();
  }

  setPublished(frame, published) {
    frame.published = published;
    if (published) {
      this._publishSet(frame);
    } else {
      this._publishDelete(frame.name);
    }
    this._emitChange();
  }

  delete(frame) {
    if (frame.published) this._publishDelete(frame.name);
    this.viewer.framesRoot.remove(frame.group);
    if (this.selected === frame) this.select(null);
    this.frames.delete(frame.name);
    this._emitChange();
  }

  /** Called every frame (or on tf update) to keep group world transforms following live parent poses. */
  syncAll() {
    for (const frame of this.frames.values()) this._syncGroupTransform(frame);
  }

  _syncGroupTransform(frame) {
    const parentWorld = this.tfTree.getWorldTransform(frame.parentFrame);
    const worldPos = frame.local.position.clone().applyQuaternion(parentWorld.quaternion).add(parentWorld.position);
    const worldQuat = parentWorld.quaternion.clone().multiply(frame.local.quaternion);
    frame.group.position.copy(worldPos);
    frame.group.quaternion.copy(worldQuat);
  }

  _onGizmoChange(frame) {
    const parentWorld = this.tfTree.getWorldTransform(frame.parentFrame);
    const parentQuatInv = parentWorld.quaternion.clone().invert();
    frame.local.position = frame.group.position.clone().sub(parentWorld.position).applyQuaternion(parentQuatInv);
    frame.local.quaternion = parentQuatInv.clone().multiply(frame.group.quaternion);
    this.tfTree.setLocalEdge(frame.name, frame.parentFrame, frame.local.position, frame.local.quaternion);
    if (frame.published) this._publishSet(frame);
    this._emitChange();
  }

  _publishSet(frame) {
    const msg = makeTransformStampedMessage({
      parentFrame: frame.parentFrame,
      childFrame: frame.name,
      position: frame.local.position,
      quaternion: frame.local.quaternion,
    });
    this._setTopic.publish(msg);
  }

  _publishDelete(name) {
    this._deleteTopic.publish({ data: name });
  }
}
