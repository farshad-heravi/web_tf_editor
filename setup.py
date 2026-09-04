import os
from glob import glob

from setuptools import find_packages, setup

package_name = "web_tf_editor"


def web_dist_files():
    # Mirrors web/dist/* under share/<pkg>/web/dist/* (not flattened into web/), so the install
    # layout matches the source layout exactly -- index.html references /dist/bundle.js either way.
    data = []
    dist_root = os.path.join("web", "dist")
    if not os.path.isdir(dist_root):
        return data
    for dirpath, _dirnames, filenames in os.walk(dist_root):
        if not filenames:
            continue
        rel = os.path.relpath(dirpath, "web")
        install_dir = os.path.join("share", package_name, "web", rel)
        data.append((install_dir, [os.path.join(dirpath, f) for f in filenames]))
    return data


setup(
    name=package_name,
    version="0.1.1",
    packages=find_packages(exclude=["test"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
        (os.path.join("share", package_name, "launch"), glob("launch/*.launch.py")),
        (os.path.join("share", package_name, "urdf"), glob("urdf/*.xacro")),
        (os.path.join("share", package_name, "web"), ["web/index.html", "web/style.css"]),
    ]
    + web_dist_files(),
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="Farshad Nozad Heravi",
    maintainer_email="f.n.heravi@gmail.com",
    description="Browser-based rviz-like viewer for authoring interactive TF frames over rosbridge.",
    license="Apache-2.0",
    tests_require=["pytest"],
    entry_points={
        "console_scripts": [
            "web_server_node = web_tf_editor.web_server_node:main",
            "frame_bridge_node = web_tf_editor.frame_bridge_node:main",
        ],
    },
)
