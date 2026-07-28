import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["index.ts"],
  format: ["esm"],
  outDir: "dist",
  platform: "node",
  sourcemap: true,
  clean: true,
  // Host-provided plugin SDK and the plugin's own npm deps stay external;
  // OpenClaw installs declared dependencies alongside the plugin.
  external: [/^openclaw(\/.*)?$/, "@tenkicloud/sandbox"],
});
