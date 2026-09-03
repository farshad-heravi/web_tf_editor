import * as THREE from "three";
import { Viewer } from "./viewer.js";
import { RosClient } from "./ros.js";
import { TfTree } from "./tf_tree.js";
import { loadRobot, unloadRobot, applyJointStates } from "./robot.js";
import { FrameManager } from "./frames.js";
import { Picker } from "./picker.js";
import { Panel } from "./panel.js";
import { ShortcutHelp } from "./shortcuts.js";

const BASE_FRAME_CANDIDATES = ["base_footprint", "base_link"];

// Namespaced robots often flatten their tf_prefix into frame ids instead of using a real "/"
// (e.g. "robot_base_link" for namespace "/robot"), so an exact match against "base_link" alone
// misses them. `prefixes` (derived from the topic the robot was loaded from, see
// loadRobotFrom()) is tried next -- deliberately NOT a global suffix scan across every known
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

async function main() {
  const config = await fetch("/api/config").then((r) => r.json());
  const urdfXml = await fetch("/api/robot_description").then((r) => r.text());

  const canvas = document.getElementById("viewport");
  const viewer = new Viewer(canvas);

  const tfTree = new TfTree(config.fixed_frame);
  const ros = new RosClient(config.ros_bridge_url);

  let robot = null;
  let baseFramePrefixes = [];

  // Reassignable so each loaded robot can listen on its own (possibly namespaced) joint states
  // topic instead of being stuck on the hardcoded default from startup.
  let jointStatesSub = null;
  function subscribeJointStates(topicName) {
    jointStatesSub?.unsubscribe();
    jointStatesSub = ros.subscribe(topicName, "sensor_msgs/JointState", (msg) => {
      if (robot) applyJointStates(robot, msg);
    });
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

  async function loadRobotFrom(descriptor) {
    panel.setRobotLoadStatus("Loading...");
    try {
      let xml;
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

      unloadRobot(viewer.robotRoot);
      robot = await loadRobot(xml, viewer.robotRoot);
      panel.setRobotInfo(robot.robotName || "robot", Object.keys(robot.joints || {}).length);
      panel.setRobotLoadStatus(`Loaded from ${descriptor.source}`, true);
      subscribeJointStates(descriptor.jointStatesTopic || "/joint_states");
      baseFramePrefixes = guessFramePrefixes(descriptor);
    } catch (err) {
      console.error("Failed to load robot URDF:", err);
      unloadRobot(viewer.robotRoot);
      robot = null;
      panel.setRobotInfo("(load failed)", 0);
      panel.setRobotLoadStatus(err.message || String(err), false);
    }
  }

  const frameManager = new FrameManager({ viewer, ros, tfTree, fixedFrame: config.fixed_frame });
  const panel = new Panel({
    frameManager,
    tfTree,
    el: document.getElementById("app"),
    onLoadRobot: (descriptor) => loadRobotFrom(descriptor),
    onSpaceToggle: () => shortcutHelp.render(),
  });
  const picker = new Picker({ viewer, frameManager, hintEl: document.getElementById("hint") });

  const shortcutHelp = new ShortcutHelp({
    el: document.getElementById("shortcut-help"),
    picker,
    frameManager,
    viewer,
  });
  frameManager.onChange(() => shortcutHelp.render());
  shortcutHelp.render();

  ros.onStatusChange((connected) => panel.setConnectionStatus(connected));

  if (urdfXml.trim()) {
    try {
      robot = await loadRobot(urdfXml, viewer.robotRoot);
      panel.setRobotInfo(robot.robotName || "robot", Object.keys(robot.joints || {}).length);
      panel.setRobotLoadStatus("Loaded from parameter", true);
    } catch (err) {
      console.error("Failed to load robot URDF:", err);
      panel.setRobotInfo("(load failed)", 0);
      panel.setRobotLoadStatus(err.message || String(err), false);
    }
  } else {
    panel.setRobotInfo("(none)", 0);
  }

  ros.subscribe("/tf", "tf2_msgs/TFMessage", (msg) => {
    tfTree.ingest(msg);
    const baseFrame = findBaseFrame(tfTree, config.fixed_frame, baseFramePrefixes);
    if (baseFrame) {
      const w = tfTree.getWorldTransform(baseFrame);
      viewer.robotRoot.position.copy(w.position);
      viewer.robotRoot.quaternion.copy(w.quaternion);
    }
    frameManager.syncAll();
  });
  ros.subscribe("/tf_static", "tf2_msgs/TFMessage", (msg) => tfTree.ingest(msg));

  subscribeJointStates("/joint_states");

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
    } else if (e.key === "t" || e.key === "T") {
      if (frameManager.selected) {
        viewer.transformControls.setMode("translate");
        shortcutHelp.render();
      }
    } else if (e.key === "r" || e.key === "R") {
      if (frameManager.selected) {
        viewer.transformControls.setMode("rotate");
        shortcutHelp.render();
      }
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
    if (hits.length === 0) return;

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
