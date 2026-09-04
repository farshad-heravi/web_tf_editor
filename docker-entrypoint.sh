#!/bin/bash
set -e
source /opt/ros/jazzy/setup.bash
source /ws/install/setup.bash
exec ros2 launch web_tf_editor web_tf_editor.launch.py "$@"
