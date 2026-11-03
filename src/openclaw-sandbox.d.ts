// openclaw ships plugin-sdk/sandbox without types since 2026.8; these mirror the parts this plugin uses (checked against 2026.10.10).
declare module "openclaw/plugin-sdk/sandbox" {
  import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

  export type { OpenClawConfig };

  export type SandboxBackendCommandParams = {
    script: string;
    args?: string[];
    stdin?: Buffer | string;
    allowFailure?: boolean;
    signal?: AbortSignal;
  };

  export type SandboxBackendCommandResult = {
    stdout: Buffer;
    stderr: Buffer;
    code: number;
  };

  export type SandboxBackendExecSpec = {
    argv: string[];
    env: NodeJS.ProcessEnv;
    cwd?: string;
    stdinMode: "pipe-open" | "pipe-closed";
  };

  // Host-owned objects the plugin only passes through.
  export type SandboxFsBridgeContext = object;
  export type SandboxFsBridge = object;

  export type SandboxBackendHandle = {
    id: string;
    runtimeId: string;
    runtimeLabel: string;
    workdir: string;
    env?: Record<string, string>;
    configLabel?: string;
    configLabelKind?: string;
    workdirValidation?: "host" | "backend";
    validateWorkdir?: (workdir: string) => Promise<string | null>;
    workdirRoots?: readonly string[];
    buildExecSpec(params: {
      command: string;
      workdir?: string;
      env: Record<string, string>;
      usePty: boolean;
    }): Promise<SandboxBackendExecSpec>;
    runShellCommand(params: SandboxBackendCommandParams): Promise<SandboxBackendCommandResult>;
    createFsBridge?: (params: { sandbox: SandboxFsBridgeContext }) => SandboxFsBridge;
  };

  export type CreateSandboxBackendParams = {
    sessionKey: string;
    scopeKey: string;
    workspaceDir: string;
    agentWorkspaceDir: string;
    skillsWorkspaceDir?: string;
    cfg: {
      workspaceAccess: "none" | "ro" | "rw";
      docker: { binds?: string[]; env?: Record<string, string> };
    };
  };

  export type SandboxRegistryEntry = {
    sessionKey: string;
    image: string;
  };

  export type SandboxBackendFactory = (
    params: CreateSandboxBackendParams,
  ) => Promise<SandboxBackendHandle>;

  export type SandboxBackendManager = {
    describeRuntime(params: {
      entry: SandboxRegistryEntry;
      config: OpenClawConfig;
      agentId?: string;
    }): Promise<{ running: boolean; actualConfigLabel?: string; configLabelMatch: boolean }>;
    removeRuntime(params: {
      entry: SandboxRegistryEntry;
      config: OpenClawConfig;
      agentId?: string;
    }): Promise<void>;
  };

  export function registerSandboxBackend(
    id: string,
    registration: {
      factory: SandboxBackendFactory;
      manager?: SandboxBackendManager;
      resolveWorkdir?: (params: CreateSandboxBackendParams) => string;
    },
  ): () => void;

  export function buildValidatedExecRemoteCommand(params: {
    command: string;
    workdir?: string;
    env: Record<string, string>;
  }): string;

  export function createRemoteShellSandboxFsBridge(params: {
    sandbox: SandboxFsBridgeContext;
    runtime: {
      remoteWorkspaceDir: string;
      remoteAgentWorkspaceDir: string;
      runRemoteShellScript(params: SandboxBackendCommandParams): Promise<SandboxBackendCommandResult>;
    };
  }): SandboxFsBridge;

  export function sanitizeEnvVars(envVars: Record<string, string | undefined>): {
    allowed: Record<string, string>;
    blocked: string[];
    warnings: string[];
  };

  export function shellEscape(value: string): string;
}
