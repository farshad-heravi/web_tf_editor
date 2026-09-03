import * as THREE from "three";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

// three.js Euler order 'XYZ' = intrinsic rotations about the body's X, then Y, then Z axis,
// which is exactly ROS's roll/pitch/yaw (tf2 setRPY / getRPY) convention.
const RPY_ORDER = "XYZ";

function fmt(n) {
  return Number(n.toFixed(5));
}

function toYaml(frame) {
  const p = frame.local.position;
  const q = frame.local.quaternion;
  return (
    `parent_frame: ${frame.parentFrame}\n` +
    `child_frame: ${frame.name}\n` +
    `translation: {x: ${fmt(p.x)}, y: ${fmt(p.y)}, z: ${fmt(p.z)}}\n` +
    `rotation: {x: ${fmt(q.x)}, y: ${fmt(q.y)}, z: ${fmt(q.z)}, w: ${fmt(q.w)}}\n`
  );
}

function toStaticTfCommand(frame) {
  const p = frame.local.position;
  const q = frame.local.quaternion;
  return (
    `ros2 run tf2_ros static_transform_publisher ` +
    `--x ${fmt(p.x)} --y ${fmt(p.y)} --z ${fmt(p.z)} ` +
    `--qx ${fmt(q.x)} --qy ${fmt(q.y)} --qz ${fmt(q.z)} --qw ${fmt(q.w)} ` +
    `--frame-id ${frame.parentFrame} --child-frame-id ${frame.name}`
  );
}

export class Panel {
  constructor({ frameManager, tfTree, el, onLoadRobot, onSpaceToggle }) {
    this.frameManager = frameManager;
    this.tfTree = tfTree;
    this.el = el;
    this.onLoadRobot = onLoadRobot;
    this.onSpaceToggle = onSpaceToggle;
    this.listEl = el.querySelector("#frame-list");
    this.editorEl = el.querySelector("#frame-editor");
    this.contextMenuEl = document.querySelector("#context-menu");

    this._buildRobotSection(el.querySelector("#robot-section"));

    frameManager.onChange(() => this.render());
    tfTree.onChange(() => this.render());
    document.addEventListener("click", () => this.hideContextMenu());
    this.render();
  }

  _buildRobotSection(container) {
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Robot Model";

    const sourceRow = document.createElement("div");
    const sourceLabel = document.createElement("label");
    sourceLabel.textContent = "Source";
    const sourceSelect = document.createElement("select");
    for (const [value, label] of [
      ["parameter", "Parameter (robot_description)"],
      ["topic", "Topic"],
      ["file", "File"],
    ]) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      sourceSelect.appendChild(opt);
    }
    sourceRow.append(sourceLabel, sourceSelect);

    const topicRow = document.createElement("div");
    const topicLabel = document.createElement("label");
    topicLabel.textContent = "Topic name";
    const topicInput = document.createElement("input");
    topicInput.type = "text";
    topicInput.value = "/robot_description";
    topicRow.append(topicLabel, topicInput);

    // Namespaced robots (e.g. "/robot/robot_description") usually publish joint states under the
    // same namespace ("/robot/joint_states"), not the bare "/joint_states" this app defaults to.
    // Auto-derive that guess but let it be overridden, since there's no fixed convention.
    const jointStatesRow = document.createElement("div");
    const jointStatesLabel = document.createElement("label");
    jointStatesLabel.textContent = "Joint states topic";
    const jointStatesInput = document.createElement("input");
    jointStatesInput.type = "text";
    jointStatesInput.value = "/joint_states";
    jointStatesRow.append(jointStatesLabel, jointStatesInput);

    let jointStatesEdited = false;
    jointStatesInput.addEventListener("input", () => {
      jointStatesEdited = true;
    });
    topicInput.addEventListener("input", () => {
      if (jointStatesEdited) return;
      const guess = topicInput.value.trim().replace(/\/robot_description$/, "/joint_states");
      jointStatesInput.value = guess || "/joint_states";
    });

    const fileRow = document.createElement("div");
    const fileLabel = document.createElement("label");
    fileLabel.textContent = "URDF file";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".urdf,.xml";
    fileRow.append(fileLabel, fileInput);

    const updateVisibility = () => {
      topicRow.hidden = sourceSelect.value !== "topic";
      jointStatesRow.hidden = sourceSelect.value !== "topic";
      fileRow.hidden = sourceSelect.value !== "file";
    };
    sourceSelect.addEventListener("change", updateVisibility);
    updateVisibility();

    const loadBtn = document.createElement("button");
    loadBtn.textContent = "Load robot";
    loadBtn.className = "load-robot-btn";

    const status = document.createElement("div");
    status.className = "robot-load-status";

    loadBtn.addEventListener("click", () => {
      const source = sourceSelect.value;
      if (source === "file") {
        const file = fileInput.files?.[0];
        if (!file) {
          this.setRobotLoadStatus("Choose a file first", false);
          return;
        }
        if (file.name.toLowerCase().endsWith(".xacro")) {
          this.setRobotLoadStatus("xacro files aren't expanded in-browser — process with xacro first", false);
          return;
        }
        this.onLoadRobot?.({ source, file });
      } else if (source === "topic") {
        const topic = topicInput.value.trim() || "/robot_description";
        const jointStatesTopic = jointStatesInput.value.trim() || "/joint_states";
        this.onLoadRobot?.({ source, topic, jointStatesTopic });
      } else {
        this.onLoadRobot?.({ source });
      }
    });

    this.robotStatusEl = status;
    container.append(title, sourceRow, topicRow, jointStatesRow, fileRow, loadBtn, status);
  }

  setRobotLoadStatus(text, ok) {
    if (!this.robotStatusEl) return;
    this.robotStatusEl.textContent = text;
    this.robotStatusEl.className = "robot-load-status" + (ok === true ? " ok" : ok === false ? " bad" : "");
  }

  render() {
    this._renderList();
    this._renderEditor();
  }

  _renderList() {
    this.listEl.innerHTML = "";
    for (const frame of this.frameManager.list()) {
      const row = document.createElement("div");
      row.className = "frame-row" + (this.frameManager.selected === frame ? " selected" : "");
      row.addEventListener("click", () => this.frameManager.select(frame));

      const vis = document.createElement("button");
      vis.textContent = frame.visible ? "◉" : "○";
      vis.title = "Toggle visibility";
      vis.addEventListener("click", (e) => {
        e.stopPropagation();
        this.frameManager.setVisible(frame, !frame.visible);
      });

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = frame.name + (frame.published ? " • TF" : "");

      const del = document.createElement("button");
      del.textContent = "✕";
      del.title = "Delete";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        this.frameManager.delete(frame);
      });

      row.append(vis, name, del);
      this.listEl.appendChild(row);
    }
  }

  _renderEditor() {
    const frame = this.frameManager.selected;
    if (!frame) {
      this.editorEl.hidden = true;
      this.editorEl.innerHTML = "";
      return;
    }
    this.editorEl.hidden = false;
    this.editorEl.innerHTML = "";

    this.editorEl.appendChild(this._nameField(frame));
    this.editorEl.appendChild(this._referenceFrameField(frame));
    this.editorEl.appendChild(this._positionField(frame));
    this.editorEl.appendChild(this._rpyField(frame));
    this.editorEl.appendChild(this._quatField(frame));
    this.editorEl.appendChild(this._actionButtons(frame));
    this.editorEl.appendChild(this._exportSection(frame));
  }

  _nameField(frame) {
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = "Name";
    const input = document.createElement("input");
    input.type = "text";
    input.value = frame.name;
    input.addEventListener("change", () => {
      const ok = this.frameManager.rename(frame, input.value.trim());
      if (!ok) input.value = frame.name;
    });
    wrap.append(label, input);
    return wrap;
  }

  _referenceFrameField(frame) {
    const wrap = document.createElement("div");
    const label = document.createElement("label");
    label.textContent = "Reference frame";
    const select = document.createElement("select");
    for (const f of this.tfTree.list()) {
      if (f === frame.name) continue;
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      opt.selected = f === frame.parentFrame;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => this.frameManager.setParent(frame, select.value));
    wrap.append(label, select);
    return wrap;
  }

  _positionField(frame) {
    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Position (m)";
    const row = document.createElement("div");
    row.className = "vec3-row";
    const p = frame.local.position;
    const inputs = ["x", "y", "z"].map((axis) => {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.01";
      input.value = fmt(p[axis]);
      input.addEventListener("change", () => {
        const next = frame.local.position.clone();
        next[axis] = parseFloat(input.value) || 0;
        this.frameManager.setLocalPose(frame, next, frame.local.quaternion);
      });
      return input;
    });
    row.append(...inputs);
    wrap.append(title, row);
    return wrap;
  }

  _rpyField(frame) {
    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Roll / Pitch / Yaw (deg)";
    const row = document.createElement("div");
    row.className = "vec3-row";
    const euler = new THREE.Euler().setFromQuaternion(frame.local.quaternion, RPY_ORDER);
    const rpy = [euler.x, euler.y, euler.z];
    const inputs = rpy.map((val, i) => {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "1";
      input.value = fmt(val * RAD2DEG);
      input.addEventListener("change", () => {
        const cur = new THREE.Euler().setFromQuaternion(frame.local.quaternion, RPY_ORDER);
        const next = [cur.x, cur.y, cur.z];
        next[i] = (parseFloat(input.value) || 0) * DEG2RAD;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(next[0], next[1], next[2], RPY_ORDER));
        this.frameManager.setLocalPose(frame, frame.local.position, q);
      });
      return input;
    });
    row.append(...inputs);
    wrap.append(title, row);
    return wrap;
  }

  _quatField(frame) {
    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Quaternion (x, y, z, w)";
    const row = document.createElement("div");
    row.className = "vec3-row";
    row.style.gridTemplateColumns = "1fr 1fr 1fr 1fr";
    const q = frame.local.quaternion;
    const inputs = ["x", "y", "z", "w"].map((axis) => {
      const input = document.createElement("input");
      input.type = "number";
      input.step = "0.01";
      input.value = fmt(q[axis]);
      input.addEventListener("change", () => {
        const next = frame.local.quaternion.clone();
        next[axis] = parseFloat(input.value) || 0;
        next.normalize();
        this.frameManager.setLocalPose(frame, frame.local.position, next);
      });
      return input;
    });
    row.append(...inputs);
    wrap.append(title, row);
    return wrap;
  }

  _actionButtons(frame) {
    const wrap = document.createElement("div");
    wrap.className = "btn-row";

    const pub = document.createElement("button");
    pub.textContent = frame.published ? "Unpublish" : "Publish to TF";
    pub.addEventListener("click", () => this.frameManager.setPublished(frame, !frame.published));

    const gizmo = document.createElement("button");
    gizmo.textContent = this.frameManager.gizmoOn ? "Hide gizmo" : "Show gizmo";
    gizmo.addEventListener("click", () => {
      if (this.frameManager.gizmoOn) {
        this.frameManager.hideGizmo();
      } else {
        this.frameManager.showGizmo(frame);
      }
    });

    const transformControls = this.frameManager.viewer.transformControls;
    const space = document.createElement("button");
    space.textContent = `Space: ${transformControls.space === "local" ? "Local" : "World"}`;
    space.title = "Toggle whether the gizmo's translate/rotate handles follow world axes or the frame's own local axes (Q)";
    space.addEventListener("click", () => {
      transformControls.setSpace(transformControls.space === "local" ? "world" : "local");
      this.render();
      this.onSpaceToggle?.();
    });

    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "danger";
    del.addEventListener("click", () => this.frameManager.delete(frame));

    wrap.append(pub, gizmo, space, del);
    return wrap;
  }

  _exportSection(frame) {
    const wrap = document.createElement("div");
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Export";

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    const yamlBtn = document.createElement("button");
    yamlBtn.textContent = "Copy YAML";
    const cmdBtn = document.createElement("button");
    cmdBtn.textContent = "Copy TF command";
    btnRow.append(yamlBtn, cmdBtn);

    const out = document.createElement("textarea");
    out.className = "yaml-out";
    out.readOnly = true;
    out.value = toYaml(frame);

    yamlBtn.addEventListener("click", () => {
      out.value = toYaml(frame);
      navigator.clipboard?.writeText(out.value).catch(() => {});
    });
    cmdBtn.addEventListener("click", () => {
      out.value = toStaticTfCommand(frame);
      navigator.clipboard?.writeText(out.value).catch(() => {});
    });

    wrap.append(title, btnRow, out);
    return wrap;
  }

  showContextMenu(x, y, items) {
    const menu = this.contextMenuEl;
    menu.innerHTML = "";
    for (const item of items) {
      if (item === "-") {
        menu.appendChild(document.createElement("hr"));
        continue;
      }
      const btn = document.createElement("button");
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        item.onClick();
        this.hideContextMenu();
      });
      menu.appendChild(btn);
    }
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.hidden = false;
  }

  hideContextMenu() {
    if (this.contextMenuEl) this.contextMenuEl.hidden = true;
  }

  setConnectionStatus(connected) {
    const el = document.getElementById("conn-status");
    el.textContent = connected ? "connected" : "disconnected";
    el.className = "status " + (connected ? "status-connected" : "status-disconnected");
  }

  setRobotInfo(name, jointCount) {
    document.getElementById("robot-name").textContent = `robot: ${name}`;
    document.getElementById("joint-count").textContent = `joints: ${jointCount}`;
  }
}
