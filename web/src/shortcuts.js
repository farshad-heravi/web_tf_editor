const IDLE_ROWS = [{ key: "A", label: "Add frame" }];

const ADD_FRAME_ROWS = [
  { label: "Click a point, drag to set direction" },
  { key: "Esc", label: "Cancel" },
];

const SELECTED_ROWS = [
  { key: "G", label: "Show gizmo" },
  { key: "Esc", label: "Deselect" },
  { label: "Right-click frame for rename, delete…" },
];

function gizmoRows(mode, space) {
  return [
    { key: "T", label: "Translate", active: mode === "translate" },
    { key: "R", label: "Rotate", active: mode === "rotate" },
    { key: "Q", label: `Space: ${space === "local" ? "Local" : "World"}` },
    { key: "G", label: "Hide gizmo" },
    { key: "Esc", label: "Deselect" },
  ];
}

/**
 * Small semi-transparent shortcut-help panel (top-left of the viewport) that shows the
 * keybindings relevant to the current tool/selection state.
 */
export class ShortcutHelp {
  constructor({ el, picker, frameManager, viewer }) {
    this.el = el;
    this.picker = picker;
    this.frameManager = frameManager;
    this.viewer = viewer;
  }

  render() {
    let title;
    let rows;
    if (this.picker.active) {
      title = "Add frame";
      rows = ADD_FRAME_ROWS;
    } else if (this.frameManager.selected && this.frameManager.gizmoOn) {
      title = "Gizmo";
      rows = gizmoRows(this.viewer.transformControls.mode, this.viewer.transformControls.space);
    } else if (this.frameManager.selected) {
      title = "Frame selected";
      rows = SELECTED_ROWS;
    } else {
      title = "Shortcuts";
      rows = IDLE_ROWS;
    }

    this.el.innerHTML = "";
    const titleEl = document.createElement("div");
    titleEl.className = "shortcut-title";
    titleEl.textContent = title;
    this.el.appendChild(titleEl);

    for (const row of rows) {
      const rowEl = document.createElement("div");
      rowEl.className = "shortcut-row" + (row.active ? " active" : "");
      if (row.key) {
        const kbd = document.createElement("kbd");
        kbd.textContent = row.key;
        rowEl.appendChild(kbd);
      }
      const label = document.createElement("span");
      label.textContent = row.label;
      rowEl.appendChild(label);
      this.el.appendChild(rowEl);
    }
  }
}
