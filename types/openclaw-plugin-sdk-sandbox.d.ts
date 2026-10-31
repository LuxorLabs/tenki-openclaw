/**
 * Ambient typings for `openclaw/plugin-sdk/sandbox`.
 *
 * The published `openclaw` npm package ships `dist/plugin-sdk/sandbox.js` but no
 * matching `.d.ts` (verified on 2026.9.36, 2026.10.5 and 2026.10.9), so the
 * runtime exports exist while TypeScript sees an untyped module. This file
 * declares only the subset this plugin imports. Shapes are copied from the
 * openclaw source at tag v2026.10.9:
 *   - src/agents/sandbox/backend.types.ts
 *   - src/agents/sandbox/backend-handle.types.ts
 *   - src/agents/sandbox/fs-bridge.types.ts
 *   - src/agents/sandbox/remote-shell-command.ts
 *
 * Re-diff against upstream whenever the `openclaw` devDependency is bumped,
 * and delete this file once the package ships the declaration again.
 */
declare module "openclaw/plugin-sdk/sandbox" {
  import type { OpenClawConfig as HostOpenClawConfig } from "openclaw/plugin-sdk/core";

  export type OpenClawConfig = HostOpenClawConfig;

  // ---- fs-bridge.types.ts -------------------------------------------------

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

  // ---- backend-handle.types.ts --------------------------------------------

  export type SandboxBackendId = string;

  export type SandboxBackendExecSpec = {
    argv: string[];
    env: NodeJS.ProcessEnv;
    cwd?: string;
    stdinMode: "pipe-open" | "pipe-closed";
    assertCurrent?: () => void;
    finalizeToken?: unknown;
  };

  export type SandboxBackendWorkdirValidation = "host" | "backend";
  export type SandboxBackendWorkdirValidator = (workdir: string) => Promise<string | null>;
  export type SandboxBackendPreparedWorkdirDiscarder = (workdir: string) => void;

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
    readOnlyResourceMounts?: Array<{ hostPath: string; containerPath: string }>;
    workspaceAccess: "none" | "ro" | "rw";
    containerName: string;
    containerWorkdir: string;
    docker: {
      binds?: string[];
    };
    backend?: {
      runShellCommand(params: SandboxBackendCommandParams): Promise<SandboxBackendCommandResult>;
    };
  };

  export type SandboxBackendHandle = {
    id: SandboxBackendId;
    runtimeId: string;
    runtimeLabel: string;
    workdir: string;
    env?: Record<string, string>;
    configLabel?: string;
    configLabelKind?: string;
    workdirValidation?: SandboxBackendWorkdirValidation;
    validateWorkdir?: SandboxBackendWorkdirValidator;
    discardPreparedWorkdir?: SandboxBackendPreparedWorkdirDiscarder;
    workdirRoots?: readonly string[];
    capabilities?: {
      browser?: boolean;
      readOnlyResourceMounts?: boolean;
    };
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
    prepareProcessCleanup?: (env: Record<string, string>) => {
      env: Record<string, string>;
      terminate: () => Promise<void>;
      interrupt: (timeoutMs: number) => Promise<boolean>;
    };
    runShellCommand(params: SandboxBackendCommandParams): Promise<SandboxBackendCommandResult>;
    createFsBridge?: (params: { sandbox: SandboxFsBridgeContext }) => SandboxFsBridge;
  };

  // ---- sandbox config / registry (subset) ---------------------------------

  export type SandboxWorkspaceAccess = "none" | "ro" | "rw";
  export type SandboxScope = "session" | "agent" | "shared";

  /**
   * Resolved sandbox config passed to backend factories. Only the keys this
   * plugin reads are typed precisely; the rest are kept loose on purpose.
   */
  export type SandboxConfig = {
    mode: "off" | "non-main" | "all";
    backend: SandboxBackendId;
    scope: SandboxScope;
    workspaceAccess: SandboxWorkspaceAccess;
    workspaceRoot: string;
    docker: {
      image: string;
      containerPrefix: string;
      workdir: string;
      binds?: string[];
      env?: Record<string, string>;
      [key: string]: unknown;
    };
    ssh: Record<string, unknown>;
    browser: Record<string, unknown>;
    tools: { allow?: string[]; deny?: string[] };
    prune: { idleHours: number; maxAgeDays: number };
  };

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

  // ---- backend.types.ts ---------------------------------------------------

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

  export type CreateSandboxBackendParams = {
    sessionKey: string;
    scopeKey: string;
    registeredRuntimeIds?: readonly string[];
    runtimeId?: string;
    assertRuntimeCurrent?: () => void;
    workspaceDir: string;
    workspaceSource?: "managed-worktree";
    agentWorkspaceDir: string;
    skillsWorkspaceDir?: string;
    readOnlyResourceMounts?: Array<{ hostPath: string; containerPath: string }>;
    cfg: SandboxConfig;
    requireCurrentConfig?: boolean;
  };

  export type SandboxBackendFactory = (
    params: CreateSandboxBackendParams,
  ) => Promise<SandboxBackendHandle>;

  export type CreateReservedSandboxBackendParamsV1 = CreateSandboxBackendParams & {
    runtimeId: string;
    assertRuntimeCurrent: () => void;
  };

  export type ReservedSandboxBackendFactoryV1 = (
    params: CreateReservedSandboxBackendParamsV1,
  ) => Promise<SandboxBackendHandle>;

  export type SandboxBackendWorkdirResolver = (params: CreateSandboxBackendParams) => string;

  export type RegisteredSandboxBackend = {
    manager?: SandboxBackendManager;
    resolveWorkdir?: SandboxBackendWorkdirResolver;
    capabilities?: {
      readOnlyResourceMounts?: boolean;
    };
  } & (
    | { factory: SandboxBackendFactory; reserveRuntimeId?: undefined }
    | {
        factory: ReservedSandboxBackendFactoryV1;
        reserveRuntimeId: (params: CreateSandboxBackendParams) => string;
      }
  );

  export type SandboxBackendRegistration = SandboxBackendFactory | RegisteredSandboxBackend;

  /** Register or replace a sandbox backend and return a restore callback. */
  export function registerSandboxBackend(
    id: string,
    registration: SandboxBackendRegistration,
  ): () => void;

  // ---- remote-shell helpers ---------------------------------------------

  /** Single-quote a value for POSIX shell argv construction. */
  export function shellEscape(value: string): string;

  /** Validate and build a remote exec command for untrusted model input. */
  export function buildValidatedExecRemoteCommand(params: {
    command: string;
    workdir?: string;
    env: Record<string, string>;
  }): string;

  export type RemoteShellSandboxHandle = {
    remoteWorkspaceDir: string;
    remoteAgentWorkspaceDir: string;
    runRemoteShellScript(params: SandboxBackendCommandParams): Promise<SandboxBackendCommandResult>;
  };

  /** Create the filesystem bridge for remote shell-backed sandbox runtimes. */
  export function createRemoteShellSandboxFsBridge(params: {
    sandbox: SandboxFsBridgeContext;
    runtime: RemoteShellSandboxHandle;
  }): SandboxFsBridge;

  export type EnvVarSanitizationResult = {
    allowed: Record<string, string>;
    blocked: string[];
    warnings: string[];
  };

  export type EnvSanitizationOptions = {
    strictMode?: boolean;
    customBlockedPatterns?: ReadonlyArray<RegExp>;
    customAllowedPatterns?: ReadonlyArray<RegExp>;
  };

  /** Sanitizes inherited environment variables for automatic sandbox propagation. */
  export function sanitizeEnvVars(
    envVars: Record<string, string | undefined>,
    options?: EnvSanitizationOptions,
  ): EnvVarSanitizationResult;
}
