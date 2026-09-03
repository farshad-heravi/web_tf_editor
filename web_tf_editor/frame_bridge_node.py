"""Bridge node: takes browser-authored frames and re-broadcasts them on /tf at a fixed rate."""

import json

import rclpy
from geometry_msgs.msg import TransformStamped
from rclpy.node import Node
from rclpy.qos import QoSDurabilityPolicy, QoSProfile
from std_msgs.msg import String
from tf2_ros import TransformBroadcaster


class FrameBridgeNode(Node):
    def __init__(self):
        super().__init__("frame_bridge_node")

        self.declare_parameter("publish_rate_hz", 30.0)

        self._frames: dict[str, TransformStamped] = {}
        self._broadcaster = TransformBroadcaster(self)

        self.create_subscription(TransformStamped, "/interactive_frame/set", self._on_set, 10)
        self.create_subscription(String, "/interactive_frame/delete", self._on_delete, 10)

        state_qos = QoSProfile(depth=1, durability=QoSDurabilityPolicy.TRANSIENT_LOCAL)
        self._state_pub = self.create_publisher(String, "/interactive_frames/state", state_qos)

        rate = self.get_parameter("publish_rate_hz").get_parameter_value().double_value
        self.create_timer(1.0 / rate, self._broadcast_all)

        self.get_logger().info("frame_bridge_node ready")

    def _on_set(self, msg: TransformStamped):
        if not msg.child_frame_id:
            self.get_logger().warn("Ignoring /interactive_frame/set with empty child_frame_id")
            return
        self._frames[msg.child_frame_id] = msg
        self._publish_state()

    def _on_delete(self, msg: String):
        name = msg.data
        if name in self._frames:
            del self._frames[name]
            self._publish_state()

    def _broadcast_all(self):
        if not self._frames:
            return
        now = self.get_clock().now().to_msg()
        stamped = []
        for tf in self._frames.values():
            tf.header.stamp = now
            stamped.append(tf)
        self._broadcaster.sendTransform(stamped)

    def _publish_state(self):
        state = [
            {
                "name": tf.child_frame_id,
                "parent": tf.header.frame_id,
                "translation": {
                    "x": tf.transform.translation.x,
                    "y": tf.transform.translation.y,
                    "z": tf.transform.translation.z,
                },
                "rotation": {
                    "x": tf.transform.rotation.x,
                    "y": tf.transform.rotation.y,
                    "z": tf.transform.rotation.z,
                    "w": tf.transform.rotation.w,
                },
            }
            for tf in self._frames.values()
        ]
        msg = String()
        msg.data = json.dumps(state)
        self._state_pub.publish(msg)


def main(args=None):
    rclpy.init(args=args)
    node = FrameBridgeNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
