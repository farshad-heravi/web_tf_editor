# syntax=docker/dockerfile:1

FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package.json ./
RUN npm install
COPY web/build.mjs ./
COPY web/src ./src
RUN npm run build

FROM ros:jazzy AS runtime
SHELL ["/bin/bash", "-c"]

RUN apt-get update && apt-get install -y --no-install-recommends \
    ros-jazzy-rosbridge-suite \
    ros-jazzy-robot-state-publisher \
    ros-jazzy-joint-state-publisher \
    ros-jazzy-xacro \
    ros-jazzy-turtlebot3-manipulation-description \
    ros-jazzy-rmw-cyclonedds-cpp \
    python3-colcon-common-extensions \
    && rm -rf /var/lib/apt/lists/*

ENV ROS_WS=/ws
WORKDIR ${ROS_WS}/src/web_tf_editor

COPY package.xml setup.py setup.cfg ./
COPY resource ./resource
COPY web_tf_editor ./web_tf_editor
COPY launch ./launch
COPY urdf ./urdf
COPY web/index.html web/style.css ./web/
COPY --from=web-build /web/dist ./web/dist

WORKDIR ${ROS_WS}
RUN source /opt/ros/jazzy/setup.bash && \
    colcon build --symlink-install

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8080 9090
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD []
