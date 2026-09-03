"""HTTP server node: serves the web UI bundle, expanded URDF, config, and package:// mesh files.

package:// mesh URIs resolve first against this process's own ROS environment
(get_package_share_directory), then against `mesh_search_paths` (colon-separated directories,
each searched as `<dir>/<pkg_name>/...`) -- so meshes for a robot whose description package isn't
installed in this container/environment can be bind-mounted at runtime without a rebuild.
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

import rclpy
from ament_index_python.packages import PackageNotFoundError, get_package_share_directory
from rclpy.node import Node

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".wasm": "application/wasm",
    ".stl": "model/stl",
    ".dae": "model/vnd.collada+xml",
    ".obj": "text/plain",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
}


def _content_type(path: str) -> str:
    _, ext = os.path.splitext(path)
    return _CONTENT_TYPES.get(ext.lower(), "application/octet-stream")


class _Handler(BaseHTTPRequestHandler):
    server_version = "InteractiveFrameJS/0.1"

    # Injected by the node before serve_forever().
    web_root = None
    node = None
    mesh_search_paths = ()

    def log_message(self, fmt, *args):
        if self.node is not None:
            self.node.get_logger().debug("%s - %s" % (self.address_string(), fmt % args))

    def _send_bytes(self, status: int, body: bytes, content_type: str):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, status: int, obj):
        self._send_bytes(status, json.dumps(obj).encode("utf-8"), "application/json; charset=utf-8")

    def _send_file(self, path: str):
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            self._send_bytes(404, b"Not Found", "text/plain; charset=utf-8")
            return
        self._send_bytes(200, body, _content_type(path))

    def do_GET(self):  # noqa: N802 (BaseHTTPRequestHandler API)
        path = unquote(urlsplit(self.path).path)

        if path == "/api/robot_description":
            urdf = self.node.get_parameter("robot_description").get_parameter_value().string_value
            self._send_bytes(200, urdf.encode("utf-8"), "application/xml; charset=utf-8")
            return

        if path == "/api/config":
            self._send_json(
                200,
                {
                    "ros_bridge_url": self.node.get_parameter("ros_bridge_url")
                    .get_parameter_value()
                    .string_value,
                    "fixed_frame": self.node.get_parameter("fixed_frame").get_parameter_value().string_value,
                },
            )
            return

        if path.startswith("/package/"):
            self._serve_package_file(path[len("/package/"):])
            return

        self._serve_static(path)

    @staticmethod
    def _safe_join(root: str, rel_path: str):
        """Join `rel_path` under `root` and reject any escape (`..`, absolute paths), purely
        lexically. Deliberately does NOT resolve symlinks (unlike realpath-based containment
        checks): colcon's --symlink-install serves this package's own web/ as symlinks back into
        the source tree, and package share dirs can be symlinked too, so a realpath comparison
        would reject legitimate files. Traversal is still caught because it's blocked by the
        normalized-path prefix check before any symlink is ever followed by open()."""
        root_norm = os.path.normpath(root)
        candidate = os.path.normpath(os.path.join(root_norm, rel_path.lstrip("/")))
        if candidate != root_norm and not candidate.startswith(root_norm + os.sep):
            return None
        return candidate

    def _serve_package_file(self, rest: str):
        # rest = "<pkg_name>/<relative/path/to/mesh.stl>"
        if "/" not in rest:
            self._send_bytes(400, b"Bad Request", "text/plain; charset=utf-8")
            return
        pkg_name, rel_path = rest.split("/", 1)

        # Packages installed in this container's own ROS environment take priority; anything not
        # found there falls back to `mesh_search_paths`, so a robot's meshes can be bind-mounted
        # at runtime (e.g. `./mesh_packages/<pkg_name>/...`) without rebuilding the image.
        try:
            share_dir = get_package_share_directory(pkg_name)
        except PackageNotFoundError:
            share_dir = None
            for search_root in self.mesh_search_paths:
                candidate_dir = os.path.join(search_root, pkg_name)
                if os.path.isdir(candidate_dir):
                    share_dir = candidate_dir
                    break
            if share_dir is None:
                self._send_bytes(404, b"Package Not Found", "text/plain; charset=utf-8")
                return

        candidate = self._safe_join(share_dir, rel_path)
        if candidate is None:
            self._send_bytes(403, b"Forbidden", "text/plain; charset=utf-8")
            return
        if not os.path.isfile(candidate):
            self._send_bytes(404, b"Not Found", "text/plain; charset=utf-8")
            return
        self._send_file(candidate)

    def _serve_static(self, path: str):
        if path == "/":
            path = "/index.html"
        candidate = self._safe_join(self.web_root, path)
        if candidate is None:
            self._send_bytes(403, b"Forbidden", "text/plain; charset=utf-8")
            return
        if not os.path.isfile(candidate):
            self._send_bytes(404, b"Not Found", "text/plain; charset=utf-8")
            return
        self._send_file(candidate)


class WebServerNode(Node):
    def __init__(self):
        super().__init__("web_server_node")

        self.declare_parameter("http_port", 8080)
        self.declare_parameter("ros_bridge_url", "ws://localhost:9090")
        self.declare_parameter("fixed_frame", "odom")
        self.declare_parameter("robot_description", "")
        self.declare_parameter("web_root", "")
        self.declare_parameter("mesh_search_paths", "")

        mesh_search_paths = tuple(
            p
            for p in self.get_parameter("mesh_search_paths").get_parameter_value().string_value.split(":")
            if p
        )

        web_root = self.get_parameter("web_root").get_parameter_value().string_value
        if not web_root:
            web_root = os.environ.get("INTERACTIVE_FRAME_WEB_ROOT", "")
        if not web_root:
            web_root = os.path.join(get_package_share_directory("web_tf_editor"), "web")
        if not os.path.isdir(web_root):
            raise RuntimeError(f"web root does not exist: {web_root}")

        port = self.get_parameter("http_port").get_parameter_value().integer_value

        handler = type(
            "BoundHandler",
            (_Handler,),
            {"web_root": web_root, "node": self, "mesh_search_paths": mesh_search_paths},
        )
        self._httpd = ThreadingHTTPServer(("0.0.0.0", port), handler)

        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        self.get_logger().info(f"Serving {web_root} on http://0.0.0.0:{port}")

    def destroy_node(self):
        self._httpd.shutdown()
        self._httpd.server_close()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = WebServerNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.try_shutdown()


if __name__ == "__main__":
    main()
