/**
 * Local declarations for `openclaw/plugin-sdk/sandbox`.
 *
 * OpenClaw 2026.10.x ships the sandbox subpath as a JavaScript-only facade —
 * its declarations are excluded from the typed public SDK. This file mirrors
 * the slice this plugin uses, taken from the last typed host (2026.7.34).
 * Drop it once the host exports sandbox types again.
 */
declare module "openclaw/plugin-sdk/sandbox" {
  import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

  export type { OpenClawConfig };

  export type SandboxResolvedPath = {
    hostPath?: string;
    relativePath: string;
    containerPath: string;
  };

  export type SandboxFsStat = {
    type: "file" | "directory" | "other";
    size: number;
    mtimeMs: number;
  };

  export type SandboxFsBridge = {
    resolvePath(params: { filePath: string; cwd?: string }): SandboxResolvedPath;
    readFile(params: { filePath: string; cwd?: string; signal?: AbortSignal }): Promise<Buffer>;
    writeFile(params: {
      filePath: string;
      cwd?: string;
      data: Buffer | string;
      encoding?: BufferEncoding;
      mkdir?: boolean;
      signal?: AbortSignal;
    }): Promise<void>;
    mkdirp(params: { filePath: string; cwd?: string; signal?: AbortSignal }): Promise<void>;
    remove(params: {
      filePath: string;
      cwd?: string;
      recursive?: boolean;
      force?: boolean;
      signal?: AbortSignal;
    }): Promise<void>;
    rename(params: { from: string; to: string; cwd?: string; signal?: AbortSignal }): Promise<void>;
    stat(params: {
      filePath: string;
      cwd?: string;
      signal?: AbortSignal;
    }): Promise<SandboxFsStat | null>;
  };

  export type SandboxBackendExecSpec = {
    argv: string[];
    env: NodeJS.ProcessEnv;
    stdinMode: "pipe-open" | "pipe-closed";
    finalizeToken?: unknown;
  };

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

  export type SandboxFsBridgeContext = {
    workspaceDir: string;
    agentWorkspaceDir: string;
    skillsWorkspaceDir?: string;
    workspaceAccess: "none" | "ro" | "rw";
    containerName: string;
    containerWorkdir: string;
    docker: { binds?: string[] };
    backend?: {
      runShellCommand(params: SandboxBackendCommandParams): Promise<SandboxBackendCommandResult>;
    };
  };

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
    discardPreparedWorkdir?: (workdir: string) => void;
    workdirRoots?: readonly string[];
    capabilities?: { browser?: boolean };
    buildExecSpec(params: {
      command: string;
      workdir?: string;
      env: Record<string, string>;
      usePty: boolean;
    }): Promise<SandboxBackendExecSpec>;
    finalizeExec?: (params: {
      status: "completed" | "failed";
      exitCode: number | null;
      timedOut: boolean;
      token?: unknown;
    }) => Promise<void>;
    runShellCommand(params: SandboxBackendCommandParams): Promise<SandboxBackendCommandResult>;
    createFsBridge?: (params: { sandbox: SandboxFsBridgeContext }) => SandboxFsBridge;
  };

  /** Narrowed to the fields this backend reads; the host object carries more. */
  export type SandboxConfig = {
    mode: "off" | "non-main" | "all";
    backend: string;
    scope: "session" | "agent" | "shared";
    workspaceAccess: "none" | "ro" | "rw";
    workspaceRoot: string;
    docker: { binds?: string[]; env?: Record<string, string> };
  };

  export type CreateSandboxBackendParams = {
    sessionKey: string;
    scopeKey: string;
    workspaceDir: string;
    agentWorkspaceDir: string;
    skillsWorkspaceDir?: string;
    cfg: SandboxConfig;
  };

  export type SandboxBackendFactory = (
    params: CreateSandboxBackendParams,
  ) => Promise<SandboxBackendHandle>;

  export type SandboxBackendWorkdirResolver = (params: CreateSandboxBackendParams) => string;

  export type SandboxRegistryEntry = {
    containerName: string;
    backendId?: string;
    runtimeLabel?: string;
    sessionKey: string;
    createdAtMs: number;
    lastUsedAtMs: number;
    image: string;
    configLabelKind?: string;
    configHash?: string;
  };

  export type SandboxBackendRuntimeInfo = {
    running: boolean;
    actualConfigLabel?: string;
    configLabelMatch: boolean;
  };

  export type SandboxBackendManager = {
    describeRuntime(params: {
      entry: SandboxRegistryEntry;
      config: OpenClawConfig;
      agentId?: string;
    }): Promise<SandboxBackendRuntimeInfo>;
    removeRuntime(params: {
      entry: SandboxRegistryEntry;
      config: OpenClawConfig;
      agentId?: string;
    }): Promise<void>;
  };

  export type SandboxBackendRegistration =
    | SandboxBackendFactory
    | {
        factory: SandboxBackendFactory;
        manager?: SandboxBackendManager;
        resolveWorkdir?: SandboxBackendWorkdirResolver;
      };

  export function registerSandboxBackend(
    id: string,
    registration: SandboxBackendRegistration,
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

  export function sanitizeEnvVars(
    envVars: Record<string, string | undefined>,
    options?: {
      strictMode?: boolean;
      customBlockedPatterns?: ReadonlyArray<RegExp>;
      customAllowedPatterns?: ReadonlyArray<RegExp>;
    },
  ): { allowed: Record<string, string>; blocked: string[]; warnings: string[] };

  export function shellEscape(value: string): string;
}
