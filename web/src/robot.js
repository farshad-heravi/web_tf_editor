import * as THREE from "three";
import URDFLoader from "urdf-loader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";

// urdf-loader only rewrites `package://` URIs (via `loader.packages`, see loadRobot() below) --
// a `file://` URI is passed through unchanged, and browsers can never fetch an absolute
// filesystem path. Some xacro authoring leaves these behind (e.g. `file://$(find pkg)/...`
// resolved to an absolute host path at xacro-processing time instead of staying `package://`).
// Since colcon always installs a package's share files under ".../share/<pkg_name>/...", any
// such URI can still be routed through our own `/package/<pkg>/<path>` route by pattern-matching
// that convention -- no server-side change needed, just a URL rewrite before fetching.
function resolveMeshPath(path) {
  const m = /^file:\/\/.*\/share\/([^/]+)\/(.+)$/.exec(path);
  return m ? `/package/${m[1]}/${m[2]}` : path;
}

function loadMeshCb(path, manager, material, onComplete) {
  path = resolveMeshPath(path);
  const ext = path.split(".").pop().toLowerCase();
  if (ext === "stl") {
    new STLLoader(manager).load(
      path,
      (geometry) => {
        const mesh = new THREE.Mesh(geometry, material || new THREE.MeshStandardMaterial({ color: 0x9aa0a8 }));
        onComplete(mesh);
      },
      undefined,
      (err) => onComplete(null, err)
    );
  } else if (ext === "dae") {
    new ColladaLoader(manager).load(
      path,
      (collada) => onComplete(collada.scene),
      undefined,
      (err) => onComplete(null, err)
    );
  } else if (ext === "obj") {
    new OBJLoader(manager).load(
      path,
      (obj) => onComplete(obj),
      undefined,
      (err) => onComplete(null, err)
    );
  } else {
    onComplete(null, new Error(`Unsupported mesh extension: ${ext}`));
  }
}

/**
 * Loads a URDF (already-expanded XML string) into `parentGroup`, resolving package:// URIs
 * against the server's /package/<pkg>/<path> route. Returns the URDFRobot instance.
 */
export function loadRobot(urdfXml, parentGroup) {
  return new Promise((resolve, reject) => {
    const loader = new URDFLoader();
    loader.packages = (pkg) => `/package/${pkg}`;
    loader.loadMeshCb = loadMeshCb;
    loader.parseCollision = false;

    let robot;
    try {
      robot = loader.parse(urdfXml);
    } catch (err) {
      reject(err);
      return;
    }

    robot.rotation.x = 0; // urdf-loader already uses Z-up convention matching ROS
    parentGroup.add(robot);
    resolve(robot);
  });
}

/** Removes and disposes whatever robot(s) are currently under `parentGroup`. */
export function unloadRobot(parentGroup) {
  for (const child of [...parentGroup.children]) {
    parentGroup.remove(child);
    child.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }
}

export function applyJointStates(robot, jointStateMsg) {
  if (!robot) return;
  const { name, position } = jointStateMsg;
  const values = {};
  for (let i = 0; i < name.length; i++) {
    values[name[i]] = position[i];
  }
  robot.setJointValues(values);
}
