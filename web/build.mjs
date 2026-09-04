import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: "dist/bundle.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: true,
  alias: {
    ws: "./src/shims/empty.js",
  },
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching for changes...");
} else {
  await esbuild.build(options);
}
