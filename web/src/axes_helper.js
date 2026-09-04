import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

// Regular THREE.Line/AxesHelper materials ignore `linewidth` on most WebGL
// backends (ANGLE clamps it to 1px), so bold axes need the fat-line pipeline
// (LineSegments2/LineMaterial), which draws screen-space-width lines via a
// custom shader instead of relying on GL_LINE_WIDTH.
const _materials = new Set();

/** Colored X/Y/Z axes helper with a configurable on-screen pixel width. */
export function makeAxesHelper(size, linewidth = 3) {
  const positions = [
    0, 0, 0, size, 0, 0,
    0, 0, 0, 0, size, 0,
    0, 0, 0, 0, 0, size,
  ];
  const colors = [
    1, 0, 0, 1, 0, 0,
    0, 1, 0, 0, 1, 0,
    0, 0, 1, 0, 0, 1,
  ];

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.setColors(colors);

  const material = new LineMaterial({ linewidth, vertexColors: true, transparent: true });
  material.resolution.set(window.innerWidth, window.innerHeight);
  _materials.add(material);

  return new LineSegments2(geometry, material);
}

/** Call on renderer resize so line width stays correct (LineMaterial needs resolution in CSS px). */
export function setAxesResolution(width, height) {
  for (const material of _materials) material.resolution.set(width, height);
}
