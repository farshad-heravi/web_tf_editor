import * as THREE from "three";

const MAX_CHAIN_DEPTH = 64;

/**
 * Tracks known frame ids and their latest parent-relative transform (from /tf and /tf_static),
 * and can compose a world pose for any frame by walking the parent chain up to a root.
 */
export class TfTree {
  constructor(fixedFrame) {
    this.fixedFrame = fixedFrame;
    this.frames = new Set([fixedFrame]);
    // child frame id -> { parent, position: THREE.Vector3, quaternion: THREE.Quaternion }
    this._edges = new Map();
    this._onChange = [];
  }

  onChange(cb) {
    this._onChange.push(cb);
  }

  ingest(tfMessage) {
    let changed = false;
    for (const t of tfMessage.transforms || []) {
      const parent = t.header.frame_id;
      const child = t.child_frame_id;
      if (!this.frames.has(parent)) {
        this.frames.add(parent);
        changed = true;
      }
      if (!this.frames.has(child)) {
        this.frames.add(child);
        changed = true;
      }
      this._edges.set(child, {
        parent,
        position: new THREE.Vector3(
          t.transform.translation.x,
          t.transform.translation.y,
          t.transform.translation.z
        ),
        quaternion: new THREE.Quaternion(
          t.transform.rotation.x,
          t.transform.rotation.y,
          t.transform.rotation.z,
          t.transform.rotation.w
        ),
      });
    }
    if (changed) {
      for (const cb of this._onChange) cb(this.list());
    }
  }

  /** Register a locally-authored frame's local transform (used before /tf round-trips it back). */
  setLocalEdge(child, parent, position, quaternion) {
    if (!this.frames.has(child)) {
      this.frames.add(child);
      for (const cb of this._onChange) cb(this.list());
    }
    this._edges.set(child, { parent, position: position.clone(), quaternion: quaternion.clone() });
  }

  addFrame(name) {
    if (!this.frames.has(name)) {
      this.frames.add(name);
      for (const cb of this._onChange) cb(this.list());
    }
  }

  list() {
    return Array.from(this.frames).sort();
  }

  /** World pose of `frameId`, composed by walking parents up to a root (best-effort if disconnected). */
  getWorldTransform(frameId) {
    const chain = [];
    let current = frameId;
    let depth = 0;
    while (this._edges.has(current) && depth < MAX_CHAIN_DEPTH) {
      const edge = this._edges.get(current);
      chain.push(edge);
      current = edge.parent;
      depth += 1;
    }
    // chain is child->...->root order; compose root-down.
    const position = new THREE.Vector3(0, 0, 0);
    const quaternion = new THREE.Quaternion();
    for (let i = chain.length - 1; i >= 0; i--) {
      const edge = chain[i];
      const localPos = edge.position.clone().applyQuaternion(quaternion).add(position);
      const localQuat = quaternion.clone().multiply(edge.quaternion);
      position.copy(localPos);
      quaternion.copy(localQuat);
    }
    return { position, quaternion };
  }

  /** Local transform of `frameId` expressed relative to `parentId`, using composed world poses. */
  getRelativeTransform(frameId, parentId) {
    const worldChild = this.getWorldTransform(frameId);
    const worldParent = this.getWorldTransform(parentId);
    const parentQuatInv = worldParent.quaternion.clone().invert();
    const position = worldChild.position.clone().sub(worldParent.position).applyQuaternion(parentQuatInv);
    const quaternion = parentQuatInv.clone().multiply(worldChild.quaternion);
    return { position, quaternion };
  }
}
