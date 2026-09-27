^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
Changelog for package web_tf_editor
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

0.2.0 (2026-09-27)
------------------
* Ship the pre-built, minified web bundle in the package so binary releases include the UI
* Add third-party license notices for the bundled JavaScript (three.js, roslib, urdf-loader, ...)
* Fix runtime dependencies (launch, launch_ros, rosbridge_server, tf2_ros_py,
  turtlebot3_manipulation_description)
* Add bind_address parameter / launch argument for the web server (default 0.0.0.0)
* Add ament linter tests and a path-traversal test for the web server
* Support multiple simultaneous robot/scene instances loaded from a topic, parameter or file
* Add an RViz-style Fixed Frame selector, grouped by the robot that owns each frame
* Anchor robots at their URDF root link TF pose
* Strip embedded lights/cameras from Collada meshes
* Contributors: farshad-heravi

0.1.1 (2026-09-04)
------------------
* Deselect frame on right-click in empty space
* Dim non-selected frames and highlight the selected frame's label in the 3D view
* Add D shortcut to duplicate the selected frame, offset along its X axis
* Add Onshape-style view cube for snapping the camera to standard/isometric views
* Default robot_description source to the /robot_description topic instead of the ROS parameter
* Restyle transform gizmo as a MoveIt/RViz-style interactive marker (arrows + rings shown together)
* Add multi-distro CI (Jazzy, Humble, Rolling) with private-repo clone auth and a web bundle build check
* Render TF axes with bold fat lines instead of 1px hairlines
* Initial commit: web_tf_editor, a browser-based rviz-like TF frame editor over rosbridge (ROS 2 Jazzy)
* Contributors: farshad-heravi
