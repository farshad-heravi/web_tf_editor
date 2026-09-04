"""Standalone UR arm description publisher.

Publishes the xacro'd URDF on `<topic_namespace>/robot_description` (latched) and joint states on
`<topic_namespace>/joint_states`, so web_tf_editor can point at it via the panel's "Load
robot from topic" controls. /tf and /tf_static are left unnamespaced/global, since TF is shared
across robots.

Default: ur_type=ur5e, topic_namespace=ur5e -> /ur5e/robot_description, /ur5e/joint_states.
Note: this host already runs a robot (renee_simulation) publishing on /robot/robot_description and
/robot/joint_states -- don't set topic_namespace:=robot or you'll collide with it.
"""

import os

import xacro
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, OpaqueFunction
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node


def _launch_setup(context, *args, **kwargs):
    ur_type = LaunchConfiguration("ur_type").perform(context)
    tf_prefix = LaunchConfiguration("tf_prefix").perform(context)
    safety_limits = LaunchConfiguration("safety_limits").perform(context)
    topic_namespace = LaunchConfiguration("topic_namespace").perform(context).strip("/")

    xacro_path = os.path.join(
        get_package_share_directory("ur_description"), "urdf", "ur.urdf.xacro"
    )
    robot_description = xacro.process_file(
        xacro_path,
        mappings={
            "name": "ur",
            "ur_type": ur_type,
            "tf_prefix": tf_prefix,
            "safety_limits": safety_limits,
        },
    ).toxml()

    robot_description_topic = f"/{topic_namespace}/robot_description"
    joint_states_topic = f"/{topic_namespace}/joint_states"

    nodes = [
        Node(
            package="robot_state_publisher",
            executable="robot_state_publisher",
            name="robot_state_publisher",
            output="screen",
            parameters=[{"robot_description": robot_description}],
            remappings=[
                ("robot_description", robot_description_topic),
                ("joint_states", joint_states_topic),
            ],
        ),
        Node(
            package="joint_state_publisher",
            executable="joint_state_publisher",
            name="joint_state_publisher",
            output="screen",
            parameters=[{"robot_description": robot_description}],
            remappings=[
                # joint_state_publisher also *subscribes* to robot_description (to react to live
                # updates), not just reads it as a param -- without this remap it falls back to
                # the global, unnamespaced /robot_description topic and silently adopts whatever
                # robot is latched there instead of ours.
                ("robot_description", robot_description_topic),
                ("joint_states", joint_states_topic),
            ],
        ),
    ]
    return nodes


def generate_launch_description():
    return LaunchDescription(
        [
            DeclareLaunchArgument("ur_type", default_value="ur5e"),
            DeclareLaunchArgument("tf_prefix", default_value=""),
            DeclareLaunchArgument("safety_limits", default_value="true"),
            DeclareLaunchArgument("topic_namespace", default_value="ur5e"),
            OpaqueFunction(function=_launch_setup),
        ]
    )
