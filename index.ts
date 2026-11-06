// Tenki plugin entrypoint registers the Tenki Cloud sandbox backend.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerSandboxBackend, type SandboxBackendRegistration } from "openclaw/plugin-sdk/sandbox";
import {
  createTenkiSandboxBackendFactory,
  createTenkiSandboxBackendManager,
  resolveTenkiRuntimePaths,
} from "./src/backend.js";
import { createTenkiPluginConfigSchema, resolveTenkiPluginConfig } from "./src/config.js";

export const SANDBOX_BACKEND_IDS = ["tenki", "luxor"] as const;

export default definePluginEntry({
  id: "tenki",
  name: "Tenki Cloud Sandbox",
  description: "Tenki Cloud microVM-backed sandbox runtime for agent exec and file tools.",
  configSchema: createTenkiPluginConfigSchema(),
  register(api) {
    if (api.registrationMode !== "full") {
      return;
    }
    const pluginConfig = resolveTenkiPluginConfig(api.pluginConfig);
    const registration: SandboxBackendRegistration = {
      factory: createTenkiSandboxBackendFactory({ pluginConfig }),
      manager: createTenkiSandboxBackendManager({ pluginConfig }),
      resolveWorkdir: ({ scopeKey }) =>
        resolveTenkiRuntimePaths(pluginConfig.workspaceRoot, scopeKey).remoteWorkspaceDir,
    };
    // "luxor" is an alias; handles keep reporting "tenki" so existing runtimes resolve.
    for (const id of SANDBOX_BACKEND_IDS) registerSandboxBackend(id, registration);
  },
});
