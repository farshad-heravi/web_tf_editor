# Browser-based interactive frame tool (ROS 2 Jazzy)

## Context

`/home/mpt/projects/interactive_frame_js` is empty — this is a greenfield build. The goal is a ROS 2 Jazzy package that serves a web UI acting as a lightweight, rviz-like viewer in the browser: it renders a robot's URDF, lets you orbit/pan/zoom the scene, and lets you author 3D frames interactively (click a point — on the robot *or* in empty space — drag to set an axis direction, then refine with a 6-DoF gizmo). Authored frames are broadcast on `/tf` so rviz2, MoveIt and any other ROS node can consume them. Everything runs in a Docker image so it can be tested without touching the host ROS install (host has Humble; the package targets Jazzy).

Verified available: `ros-jazzy-rosbridge-suite`, `ros-jazzy-robot-state-publisher`, `ros-jazzy-joint-state-publisher`, `ros-jazzy-xacro`, `ros-jazzy-turtlebot3-manipulation-description` (mobile manipulator, 2.5 MB download) — all from packages.ros.org. npm: `three` 0.185, `urdf-loader` 0.13.1 (peer three ≥0.152), `roslib` 2.1.0. `ros:jazzy` and `node:22-alpine` images are already local; Docker runs without sudo; Playwright chromium is cached for verification.

## Architecture

```
browser (three.js + urdf-loader)
   │  HTTP :8080  ── index.html + bundle.js
   │              ── /api/robot_description   (expanded URDF XML)
   │              ── /package/<pkg>/<path>    (mesh files, package:// resolver)
   │  WS   :9090  ── rosbridge_websocket
   │                   ├─ sub /joint_states, /tf, /tf_static
   │                   └─ pub /interactive_frame/set, /interactive_frame/delete
   ▼
frame_bridge (rclpy) ──> /tf broadcast (30 Hz) + /interactive_frames/state (JSON)
```

Rendering is driven by the URDF + `/joint_states` (via `robot.setJointValue`), with the robot root placed from `/tf` when an odom→base transform exists. This is why the URDF is fetched over HTTP rather than the transient-local `/robot_description` topic — rosbridge's default QoS misses latched messages.

## Files

```
web_tf_editor/
├── package.xml, setup.py, setup.cfg, resource/web_tf_editor
├── web_tf_editor/
│   ├── web_server_node.py      # static files + URDF + package:// mesh resolver
│   └── frame_bridge_node.py    # browser frames -> /tf
├── launch/web_tf_editor.launch.py
├── web/
│   ├── package.json, build.mjs (esbuild), index.html, style.css
│   └── src/{main,viewer,robot,picker,frames,panel,ros,tf_tree}.js
├── Dockerfile, docker-compose.yml, README.md
```

### `web_server_node.py`
`ThreadingHTTPServer` inside a rclpy node. Routes:
- `/` → static bundle from `INTERACTIVE_FRAME_WEB_ROOT` (launch arg) else the package share dir.
- `/api/robot_description` → URDF XML (node parameter, set by the launch file from the xacro expansion).
- `/api/config` → `{ ros_bridge_url, fixed_frame }` so the page doesn't hardcode the host.
- `/package/<pkg>/<rest>` → resolves `<pkg>` via `ament_index_python.get_package_share_directory`, then serves the file. **Must** reject `..`/absolute escapes by resolving the real path and asserting it stays under the package share dir.

### `frame_bridge_node.py`
Subscribes `/interactive_frame/set` (`geometry_msgs/TransformStamped` — `header.frame_id` = parent, `child_frame_id` = frame name; no custom msg needed) and `/interactive_frame/delete` (`std_msgs/String`). Keeps a dict of frames, re-broadcasts all of them on `/tf` at 30 Hz via `TransformBroadcaster`, and republishes the set as JSON on `/interactive_frames/state` (transient-local) so a reloaded page restores its frames.

### Frontend interaction (per your spec)
1. **Add frame mode** toggled from the side panel (or `A`). A hover preview dot plus a dashed drop-line to the ground plane shows where the point will land.
2. **Pick point** — raycast scene meshes first; on a miss, intersect the ground plane `z=0`; if that also misses (ray near-parallel), intersect a camera-facing plane through the orbit target. Empty-space placement is therefore always possible.
3. **Drag** — a live arrow from the origin toward the cursor (projected onto a camera-facing plane through the origin) defines a direction. On release the frame's **Z** axis is aligned to that direction by default (orthonormal basis completed from a world up-hint, falling back to world +X when the direction is near-vertical).
4. **Right-click a frame** → context menu: *Align X / Y / Z to drag direction* (recomputes from the stored direction vector), *Show gizmo*, *Rename*, *Delete*.
5. **Gizmo** — enabling it attaches `TransformControls` for full 6-DoF; `T`/`R` switch translate/rotate, `Esc` deselects. OrbitControls is disabled on the gizmo's `dragging-changed` event.
6. Each frame renders as RGB axis arrows plus a name sprite label.

### Side panel
Frame list (select / visibility / delete) and, for the selected frame:
- **Name** field (validated: no `/`, unique) → `child_frame_id`.
- **Reference frame** dropdown, populated from frames actually seen on `/tf` + `/tf_static` plus the fixed frame. Changing it **preserves the world pose** and recomputes the local transform.
- **Pose**: x/y/z, plus orientation shown simultaneously as RPY (ROS `ZYX` intrinsic) and quaternion `(x,y,z,w)` — all editable, two-way synced, live-updating the gizmo.
- Buttons: publish/unpublish to TF, delete, and copy-out as YAML or as a ready `ros2 run tf2_ros static_transform_publisher …` command.
- Header shows rosbridge connection status, robot name, joint count.

### Web build
`esbuild` bundles `src/main.js` → `web/dist/bundle.js` (IIFE, `--platform=browser`). Mesh loaders (`STLLoader`, `ColladaLoader`, `OBJLoader`) registered via `urdf-loader`'s `loadMeshCb`; `loader.packages = pkg => '/package/' + pkg` maps `package://` URIs onto the server route. Known risk: `roslib` 2.1.0's only export pulls the node-side `ws` dependency — if esbuild trips on node builtins, alias `ws` to an empty shim (`--alias:ws=./src/shims/empty.js`).

## Docker

Multi-stage: `node:22-alpine` builds the bundle → `ros:jazzy` installs `ros-jazzy-rosbridge-suite`, `robot-state-publisher`, `joint-state-publisher`, `xacro`, `turtlebot3-manipulation-description`, copies the package + prebuilt `web/dist`, `colcon build`s into `/ws`, and the entrypoint launches everything. Exposes **8080** (UI) and **9090** (rosbridge). `docker-compose.yml` handles port mapping, plus a bind-mount of `web/` for fast front-end iteration.

Default robot: **TurtleBot3 + OpenMANIPULATOR-X** (`turtlebot3_manipulation_description`). Note it hard-depends on `rviz2`, which inflates the image a few hundred MB; if that matters, `moveit_resources_pr2_description` is a dependency-free alternative. Any other robot: `ros2 launch web_tf_editor web_tf_editor.launch.py urdf:=/path/to/robot.urdf.xacro`.

## Verification

1. `docker compose build && docker compose up -d`.
2. `curl -sf localhost:8080/api/robot_description | head` → URDF XML; spot-check one mesh URL returns 200 and a `..` traversal returns 403.
3. `docker exec … ros2 topic list` / `ros2 topic echo /joint_states --once`.
4. Playwright (cached chromium, `--enable-unsafe-swiftshader` for WebGL): load the page, wait for the "robot loaded" status, screenshot; then script Add-frame mode → mousedown/mousemove/mouseup on the canvas in empty space → screenshot; assert the panel lists the new frame.
5. End-to-end proof from ROS's side: `docker exec … ros2 run tf2_ros tf2_echo base_link <frame_name>` returns the pose authored in the browser.
6. Send the screenshots over so you can see the result.

## Notes

First step after approval: copy this plan to `/home/mpt/projects/interactive_frame_js/PLAN.md` so it sits alongside the code.

`/home/mpt/projects/interactive_frame_js` is not a git repository — say the word and I'll `git init` before starting.
