## web_tf_editor (jazzy) - 0.1.1-1

The packages in the `web_tf_editor` repository were released into the `jazzy` distro by running `/usr/bin/bloom-release --rosdistro jazzy --track jazzy web_tf_editor` on `Fri, 04 Sep 2026 17:40:48 -0000`

The `web_tf_editor` package was released.

Version of package(s) in repository `web_tf_editor`:

- upstream repository: https://github.com/farshad-heravi/web_tf_editor.git
- release repository: unknown
- rosdistro version: `null`
- old version: `null`
- new version: `0.1.1-1`

Versions of tools used:

- bloom version: `0.14.3`
- catkin_pkg version: `1.1.0`
- rosdep version: `0.26.0`
- rosdistro version: `1.0.1`
- vcstools version: `0.1.42`


# web_tf_editor

Browser-based, rviz-like viewer for ROS 2 Jazzy: renders a robot's URDF, lets you orbit/pan/zoom,
and lets you author 3D TF frames interactively — click a point (on the robot or in empty space),
drag to set a direction, then refine with a 6-DoF gizmo. Authored frames are broadcast on `/tf` so
rviz2, MoveIt, or any other ROS node can consume them.

Everything runs in Docker (targets ROS 2 Jazzy) so it doesn't need a matching host ROS install.

## Quick start

```bash
docker compose build
docker compose up -d
```

Then open http://localhost:8180. rosbridge listens on ws://localhost:9190.

(`docker-compose.yml` maps the container's 8080/9090 to host 8180/9190 to avoid clashing with
other services on the host; change the host-side ports there if you'd rather use 8080/9090.)

Default robot is TurtleBot3 + OpenMANIPULATOR-X. To use a different robot:

```bash
docker exec -it web_tf_editor-interactive_frame-1 \
  ros2 launch web_tf_editor web_tf_editor.launch.py \
  urdf:=/path/to/robot.urdf.xacro
```

This also applies when loading a URDF from a ROS topic or the `robot_description` parameter via
the panel's "Load robot" controls, not just via `urdf:=`.

**Meshes.** Whatever serves `package://` URIs needs the actual mesh files on disk — this is true
for rviz too. If a robot's description package isn't installed in this image (the default image
only ships `turtlebot3_manipulation_description`), the loader will still say "Loaded" (the URDF
itself parsed fine) but the robot will render with no visible geometry — check the browser
console/network tab for 404s on `/package/<pkg>/...` to confirm this is what's happening.

Rather than rebuilding the image per robot, drop or symlink each needed package's share directory
under `./mesh_packages/<pkg_name>/` on the host — e.g., if the package lives in another running
container:

```bash
docker cp <other_container>:/opt/ros/<distro>/share/<pkg_name> ./mesh_packages/
```

`docker-compose.yml` bind-mounts `./mesh_packages` read-only and passes it as `mesh_search_paths`,
which `web_server_node.py`'s `/package/<pkg>/<path>` route falls back to when the package isn't in
this container's own ROS environment. No rebuild or restart needed — just refresh the page.

## Using the UI

1. Click **+ Frame** (or press `A`) to enter add-frame mode.
2. Click a point — on the robot mesh, or in empty space (falls back to the ground plane, then a
   camera-facing plane) — and drag to set a direction; release to place the frame. The frame's Z
   axis is aligned to the drag direction by default.
3. Right-click a frame for a context menu: align X/Y/Z to the drag direction, show the 6-DoF
   gizmo, rename, or delete.
4. With the gizmo shown, `T`/`R` switch translate/rotate, `Esc` deselects.
5. Use the side panel to rename, reparent (world pose is preserved across reparenting), edit
   position/RPY/quaternion, publish/unpublish to `/tf`, delete, or copy the frame out as YAML or
   as a `ros2 run tf2_ros static_transform_publisher …` command.

## Development

Front-end iteration without rebuilding the image:

```bash
cd web
npm install
npm run watch
```

`docker-compose.yml` bind-mounts `web/` into the container, so the running `web_server_node` picks
up the freshly built `dist/bundle.js` on the next page load.

## Architecture

See `PLAN.md` for the full design writeup (routes, message contracts, frontend module
responsibilities, verification steps).
