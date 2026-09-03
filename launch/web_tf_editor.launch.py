"""Launch file for web_tf_editor.

Starts:
- robot_state_publisher + joint_state_publisher (GUI-less, publishing default joint states)
- rosbridge_websocket (port 9090)
- web_server_node (serves UI + expanded URDF + package:// meshes, port 8080)
- frame_bridge_node (browser-authored frames -> /tf)

Default robot: TurtleBot3 + OpenMANIPULATOR-X (turtlebot3_manipulation_description).
Override with: ros2 launch web_tf_editor web_tf_editor.launch.py urdf:=/path/to/robot.urdf.xacro
"""

import os

import xacro
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, OpaqueFunction
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def _default_urdf():
    # Prefer our own wrapper xacro (see urdf/default_robot.urdf.xacro for why) over the upstream
    # turtlebot3_manipulation_description one, if turtlebot3_manipulation_description is present.
    try:
        get_package_share_directory("turtlebot3_manipulation_description")
    except Exception:  # noqa: BLE001 - package may not be installed
        return ""
    try:
        own_share = get_package_share_directory("web_tf_editor")
    except Exception:  # noqa: BLE001
        return ""
    candidate = os.path.join(own_share, "urdf", "default_robot.urdf.xacro")
    return candidate if os.path.isfile(candidate) else ""


def _launch_setup(context, *args, **kwargs):
    urdf_path = LaunchConfiguration("urdf").perform(context)
    fixed_frame = LaunchConfiguration("fixed_frame").perform(context)
    http_port = int(LaunchConfiguration("http_port").perform(context))
    ros_bridge_port = int(LaunchConfiguration("ros_bridge_port").perform(context))
    web_root = LaunchConfiguration("web_root").perform(context)
    mesh_search_paths = LaunchConfiguration("mesh_search_paths").perform(context)
    # The URL the *browser* uses to reach rosbridge, which may differ from ros_bridge_port when
    # running under Docker with host-side port remapping (browser runs on the host, not in the
    # container's network namespace).
    ros_bridge_public_url = LaunchConfiguration("ros_bridge_public_url").perform(context)
    if not ros_bridge_public_url:
        ros_bridge_public_url = f"ws://localhost:{ros_bridge_port}"

    if not urdf_path:
        raise RuntimeError(
            "No URDF resolved: pass urdf:=/path/to/robot.urdf(.xacro), "
            "or install turtlebot3_manipulation_description for the default robot."
        )

    if urdf_path.endswith(".xacro"):
        robot_description = xacro.process_file(urdf_path).toxml()
    else:
        with open(urdf_path, "r") as f:
            robot_description = f.read()

    nodes = [
        Node(
            package="robot_state_publisher",
            executable="robot_state_publisher",
            name="robot_state_publisher",
            output="screen",
            parameters=[{"robot_description": robot_description}],
        ),
        Node(
            package="joint_state_publisher",
            executable="joint_state_publisher",
            name="joint_state_publisher",
            output="screen",
            parameters=[{"robot_description": robot_description}],
        ),
        Node(
            package="rosbridge_server",
            executable="rosbridge_websocket",
            name="rosbridge_websocket",
            output="screen",
            parameters=[{"port": ros_bridge_port}],
        ),
        Node(
            package="web_tf_editor",
            executable="web_server_node",
            name="web_server_node",
            output="screen",
            parameters=[
                {
                    "http_port": http_port,
                    "ros_bridge_url": ros_bridge_public_url,
                    "fixed_frame": fixed_frame,
                    "robot_description": robot_description,
                    "web_root": web_root,
                    "mesh_search_paths": mesh_search_paths,
                }
            ],
        ),
        Node(
            package="web_tf_editor",
            executable="frame_bridge_node",
            name="frame_bridge_node",
            output="screen",
        ),
    ]
    return nodes


def generate_launch_description():
    return LaunchDescription(
        [
            DeclareLaunchArgument("urdf", default_value=_default_urdf()),
            DeclareLaunchArgument("fixed_frame", default_value="odom"),
            DeclareLaunchArgument("http_port", default_value="8080"),
            DeclareLaunchArgument("ros_bridge_port", default_value="9090"),
            DeclareLaunchArgument("web_root", default_value=""),
            DeclareLaunchArgument("mesh_search_paths", default_value=""),
            DeclareLaunchArgument("ros_bridge_public_url", default_value=""),
            OpaqueFunction(function=_launch_setup),
        ]
    )
