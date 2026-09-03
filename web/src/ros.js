import { Ros, Topic } from "roslib";

/**
 * Thin wrapper around roslib's Ros connection with reconnect + typed pub/sub helpers.
 */
export class RosClient {
  constructor(url) {
    this.url = url;
    this.ros = new Ros({ url });
    this.connected = false;
    this._onStatusChange = [];
    this._reconnectTimer = null;

    this.ros.on("connection", () => {
      this.connected = true;
      this._clearReconnect();
      this._emitStatus();
    });
    this.ros.on("close", () => {
      this.connected = false;
      this._emitStatus();
      this._scheduleReconnect();
    });
    this.ros.on("error", () => {
      this.connected = false;
      this._emitStatus();
    });
  }

  onStatusChange(cb) {
    this._onStatusChange.push(cb);
  }

  _emitStatus() {
    for (const cb of this._onStatusChange) cb(this.connected);
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      try {
        this.ros.connect(this.url);
      } catch {
        // will retry on next close/error event
      }
    }, 2000);
  }

  _clearReconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  subscribe(name, messageType, cb, throttleRate = 0) {
    const topic = new Topic({ ros: this.ros, name, messageType, throttle_rate: throttleRate });
    topic.subscribe(cb);
    return topic;
  }

  advertiseAndPublish(name, messageType) {
    const topic = new Topic({ ros: this.ros, name, messageType });
    return topic;
  }
}

export function makeTransformStampedMessage({ parentFrame, childFrame, position, quaternion, stampNow = true }) {
  return {
    header: {
      stamp: stampNow ? { sec: 0, nsec: 0 } : undefined,
      frame_id: parentFrame,
    },
    child_frame_id: childFrame,
    transform: {
      translation: { x: position.x, y: position.y, z: position.z },
      rotation: { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
    },
  };
}
