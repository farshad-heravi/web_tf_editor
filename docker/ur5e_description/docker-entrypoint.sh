#!/bin/bash
set -e
source /opt/ros/jazzy/setup.bash
exec ros2 launch /launch/ur5e_description.launch.py "$@"
