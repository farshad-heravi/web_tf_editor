import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";

const watch = process.argv.includes("--watch");

// Release builds (the committed web/dist/) are minified with no sourcemap: the ROS buildfarm
// builds offline without npm, so web/dist/ is checked in and installed as-is. `--watch` is for
// local development and keeps the sourcemap.
const options = {
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: "dist/bundle.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: !watch,
  sourcemap: watch,
  legalComments: "none",
  metafile: !watch,
  alias: {
    ws: "./src/shims/empty.js",
  },
  logLevel: "info",
};

// Writes dist/THIRD_PARTY_NOTICES.txt with the license text of every npm package that actually
// ended up in the bundle (taken from esbuild's metafile, so transitive deps are included).
function writeThirdPartyNotices(metafile) {
  const packages = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (m) packages.add(m[1]);
  }

  const sections = [];
  for (const name of [...packages].sort()) {
    const dir = path.join("node_modules", name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const licenseFile = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
    const text = licenseFile
      ? fs.readFileSync(path.join(dir, licenseFile), "utf8").trim()
      : `Licensed under ${pkg.license}. No license file is shipped with the npm package; ` +
        "see the package repository for the full text.";
    sections.push(`${name} ${pkg.version} (${pkg.license})\n${"-".repeat(72)}\n${text}\n`);
  }

  const header =
    "Third-party software bundled into web/dist/bundle.js\n" +
    "=".repeat(72) +
    "\n\nweb/src/vendor/TransformControls.js is a modified copy of three.js " +
    "examples/jsm/controls/TransformControls.js and is covered by the three.js MIT license " +
    "below.\n\n";
  fs.writeFileSync("dist/THIRD_PARTY_NOTICES.txt", header + sections.join("\n"));
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching for changes...");
} else {
  const result = await esbuild.build(options);
  writeThirdPartyNotices(result.metafile);
}
