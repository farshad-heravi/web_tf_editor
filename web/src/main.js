import * as THREE from "three";
import { Viewer } from "./viewer.js";
import { RosClient } from "./ros.js";
import { TfTree } from "./tf_tree.js";
import { loadRobot, unloadRobot, applyJointStates } from "./robot.js";
import { FrameManager } from "./frames.js";
import { Picker } from "./picker.js";
import { Panel } from "./panel.js";
import { ShortcutHelp } from "./shortcuts.js";
import { ViewCube } from "./view_cube.js";

const BASE_FRAME_CANDIDATES = ["base_footprint", "base_link"];

// Namespaced robots often flatten their tf_prefix into frame ids instead of using a real "/"
// (e.g. "robot_base_link" for namespace "/robot"), so an exact match against "base_link" alone
// misses them. `prefixes` (derived from the topic the robot was loaded from, see
// guessFramePrefixes()) is tried next -- deliberately NOT a global suffix scan across every known
// frame: this app's /tf graph can carry several unrelated robots at once (confirmed: a bare
// scan over all frames once matched "campetella_base_link" for a robot loaded from "/robot/..."),
// and a wrong-robot match is worse than no match.
function findBaseFrame(tfTree, fixedFrame, prefixes = []) {
  for (const c of BASE_FRAME_CANDIDATES) {
    if (c !== fixedFrame && tfTree.frames.has(c)) return c;
  }
  for (const prefix of prefixes) {
    for (const c of BASE_FRAME_CANDIDATES) {
      const candidate = `${prefix}${c}`;
      if (candidate !== fixedFrame && tfTree.frames.has(candidate)) return candidate;
    }
  }
  return null;
}

// Best-effort tf_prefix guesses for a robot loaded from `topic` (e.g. "/robot/robot_description"
// -> namespace "/robot" -> try "robot_" and "robot/", covering both flattened and real-namespace
// conventions). Returns [] for parameter/file loads, which have no known namespace.
function guessFramePrefixes(descriptor) {
  if (descriptor.source !== "topic") return [];
  const ns = descriptor.topic.replace(/\/[^/]*$/, "");
  const name = ns.replace(/^\//, "");
  if (!name) return [];
  return [`${name}_`, `${name}/`];
}

// Identifies a robot/scene instance for add-vs-replace purposes: adding the same topic or file
// again refreshes that instance in place rather than stacking a duplicate on top of it. There's
// only ever one "parameter" source (the backend node holds a single robot_description param), so
// it always refers to the same instance.
function instanceId(descriptor) {
  if (descriptor.source === "topic") return `topic:${descriptor.topic}`;
  if (descriptor.source === "file") return `file:${descriptor.file.name}`;
  return "parameter";
}

function instanceLabel(descriptor) {
  if (descriptor.source === "topic") return descriptor.topic;
  if (descriptor.source === "file") return descriptor.file.name;
  return "robot_description (param)";
}

async function main() {
  const config = await fetch("/api/config").then((r) => r.json());

  const canvas = document.getElementById("viewport");
  const viewer = new Viewer(canvas);

  const tfTree = new TfTree(config.fixed_frame);
  const ros = new RosClient(config.ros_bridge_url);

  // Multiple robots/scenes can be loaded at once (e.g. a humanoid on /g1/robot_description plus
  // a static factory scene on /factory_site/robot_description). Each instance gets its own group
  // under viewer.robotRoot (so the picker's recursive raycast against robotRoot still covers all
  // of them for free), its own joint_states subscription, and its own TF base-frame search --
  // instances are positioned independently rather than moving one shared root.
  const robots = new Map();

  function refreshRobotPanel() {
    panel.setRobotCount(robots.size);
    panel.setRobotList(
      [...robots.values()].map((r) => ({
        id: r.id,
        label: r.label,
        name: r.name,
        jointCount: r.jointCount,
        status: r.status,
        ok: r.ok,
        frameNames: r.frameNames,
      }))
    );
  }

  function removeRobotInstance(id) {
    const instance = robots.get(id);
    if (!instance) return;
    instance.jointStatesSub?.unsubscribe();
    unloadRobot(instance.group);
    viewer.robotRoot.remove(instance.group);
    robots.delete(id);
    refreshRobotPanel();
  }

  async function addRobotInstance(descriptor) {
    const id = instanceId(descriptor);
    const label = instanceLabel(descriptor);
    panel.setRobotLoadStatus(`Loading ${label}...`);

    let xml;
    try {
      if (descriptor.source === "parameter") {
        xml = await fetch("/api/robot_description").then((r) => r.text());
      } else if (descriptor.source === "file") {
        xml = await descriptor.file.text();
      } else if (descriptor.source === "topic") {
        xml = await fetchUrdfFromTopic(descriptor.topic);
      } else {
        throw new Error(`Unknown robot source: ${descriptor.source}`);
      }
      if (!xml || !xml.trim()) throw new Error("Empty URDF");
    } catch (err) {
      console.error(`Failed to load robot URDF (${label}):`, err);
      panel.setRobotLoadStatus(`${label}: ${err.message || err}`, false);
      return;
    }

    removeRobotInstance(id); // replace in place if this id is already loaded

    const group = new THREE.Group();
    viewer.robotRoot.add(group);

    let robotObj;
    try {
      robotObj = await loadRobot(xml, group);
    } catch (err) {
      console.error(`Failed to parse URDF (${label}):`, err);
      viewer.robotRoot.remove(group);
      panel.setRobotLoadStatus(`${label}: ${err.message || err}`, false);
      return;
    }

    // Registers this robot's link names as known frames immediately, so they're selectable
    // (e.g. as Fixed Frame or a new frame's parent) even before /tf actually publishes them,
    // and remembered on the instance so the panel can attribute a frame back to its robot.
    const frameNames = Object.keys(robotObj.links || {});
    for (const linkName of frameNames) {
      tfTree.addFrame(linkName);
    }

    const instance = {
      id,
      label,
      group,
      robot: robotObj,
      descriptor,
      basePrefixes: guessFramePrefixes(descriptor),
      frameNames,
      name: robotObj.robotName || "robot",
      jointCount: Object.keys(robotObj.joints || {}).length,
      status: `Loaded from ${descriptor.source}`,
      ok: true,
    };
    const jointStatesTopic = descriptor.jointStatesTopic || "/joint_states";
    instance.jointStatesSub = ros.subscribe(jointStatesTopic, "sensor_msgs/JointState", (msg) =>
      applyJointStates(instance.robot, msg)
    );

    robots.set(id, instance);
    panel.setRobotLoadStatus(`Added ${label}`, true);
    refreshRobotPanel();
  }

  async function fetchUrdfFromTopic(topicName, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const topic = ros.subscribe(topicName, "std_msgs/String", (msg) => {
        if (settled) return;
        settled = true;
        topic.unsubscribe();
        resolve(msg.data);
      });
      setTimeout(() => {
        if (settled) return;
        settled = true;
        topic.unsubscribe();
        reject(new Error(`No message received on ${topicName} within ${timeoutMs / 1000}s`));
      }, timeoutMs);
    });
  }

  const frameManager = new FrameManager({ viewer, ros, tfTree });

  // Repositions every robot instance and frame using the current fixed frame as the render
  // anchor. Called on every /tf tick, and once more immediately when the fixed frame is switched
  // so the view doesn't wait for the next tick to reflect it.
  function syncSceneToFixedFrame() {
    for (const instance of robots.values()) {
      const baseFrame = findBaseFrame(tfTree, tfTree.fixedFrame, instance.basePrefixes);
      if (baseFrame) {
        const w = tfTree.getWorldTransform(baseFrame);
        instance.group.position.copy(w.position);
        instance.group.quaternion.copy(w.quaternion);
      }
    }
    frameManager.syncAll();
  }

  const panel = new Panel({
    frameManager,
    tfTree,
    el: document.getElementById("app"),
    onAddRobot: (descriptor) => addRobotInstance(descriptor),
    onRemoveRobot: (id) => removeRobotInstance(id),
    onSpaceToggle: () => shortcutHelp.render(),
    onFixedFrameChange: (name) => {
      tfTree.setFixedFrame(name);
      syncSceneToFixedFrame();
    },
  });
  const picker = new Picker({ viewer, frameManager, hintEl: document.getElementById("hint") });
  new ViewCube({ viewer, canvas: document.getElementById("view-cube") });

  const shortcutHelp = new ShortcutHelp({
    el: document.getElementById("shortcut-help"),
    picker,
    frameManager,
    viewer,
  });
  frameManager.onChange(() => shortcutHelp.render());
  shortcutHelp.render();

  ros.onStatusChange((connected) => panel.setConnectionStatus(connected));

  addRobotInstance({ source: "topic", topic: "/robot_description", jointStatesTopic: "/joint_states" });

  ros.subscribe("/tf", "tf2_msgs/TFMessage", (msg) => {
    tfTree.ingest(msg);
    syncSceneToFixedFrame();
  });
  ros.subscribe("/tf_static", "tf2_msgs/TFMessage", (msg) => tfTree.ingest(msg));

  // -- Add-frame button + keyboard shortcut --
  const addBtn = document.getElementById("add-frame-btn");
  const toggleAddMode = () => {
    picker.setActive(!picker.active);
    addBtn.classList.toggle("active", picker.active);
    shortcutHelp.render();
  };
  addBtn.addEventListener("click", toggleAddMode);
  picker.onPlaced(() => {
    addBtn.classList.remove("active");
    shortcutHelp.render();
  });

  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (e.key === "a" || e.key === "A") {
      toggleAddMode();
    } else if (e.key === "g" || e.key === "G") {
      if (frameManager.selected) {
        if (frameManager.gizmoOn) {
          frameManager.hideGizmo();
        } else {
          frameManager.showGizmo(frameManager.selected);
        }
      }
    } else if (e.key === "q" || e.key === "Q") {
      if (frameManager.selected && frameManager.gizmoOn) {
        const tc = viewer.transformControls;
        tc.setSpace(tc.space === "local" ? "world" : "local");
        panel.render();
        shortcutHelp.render();
      }
    } else if (e.key === "d" || e.key === "D") {
      if (frameManager.selected) {
        frameManager.duplicate(frameManager.selected);
      }
    } else if (e.key === "Escape") {
      if (picker.active) {
        picker.setActive(false);
        addBtn.classList.remove("active");
      }
      frameManager.select(null);
      panel.hideContextMenu();
    }
  });

  // -- Right-click context menu on a placed frame --
  const raycaster = new THREE.Raycaster();
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const rc = viewer.screenToRay(e.clientX, e.clientY);
    raycaster.set(rc.ray.origin, rc.ray.direction);
    raycaster.camera = viewer.camera;
    const hits = raycaster.intersectObject(viewer.framesRoot, true);
    if (hits.length === 0) {
      frameManager.select(null);
      panel.hideContextMenu();
      return;
    }

    let obj = hits[0].object;
    while (obj && obj.parent !== viewer.framesRoot) obj = obj.parent;
    if (!obj) return;
    const frame = frameManager.list().find((f) => f.group === obj);
    if (!frame) return;

    frameManager.select(frame);
    panel.showContextMenu(e.clientX, e.clientY, [
      { label: "Align X to drag direction", onClick: () => frameManager.alignAxis(frame, "x") },
      { label: "Align Y to drag direction", onClick: () => frameManager.alignAxis(frame, "y") },
      { label: "Align Z to drag direction", onClick: () => frameManager.alignAxis(frame, "z") },
      "-",
      { label: "Show gizmo", onClick: () => frameManager.showGizmo(frame) },
      {
        label: "Rename",
        onClick: () => {
          const next = window.prompt("New frame name", frame.name);
          if (next) frameManager.rename(frame, next.trim());
        },
      },
      { label: "Delete", onClick: () => frameManager.delete(frame) },
    ]);
  });
}

main().catch((err) => {
  console.error(err);
  document.getElementById("hint").textContent = `Startup error: ${err.message}`;
});
