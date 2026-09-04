^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
Changelog for package web_tf_editor
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

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
