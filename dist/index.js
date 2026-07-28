// index.ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerSandboxBackend } from "openclaw/plugin-sdk/sandbox";

// src/backend.ts
import { randomUUID } from "crypto";
import fs3 from "fs/promises";
import path4 from "path";
import { isTerminal, TenkiSandbox } from "@tenkicloud/sandbox";
import {
  buildValidatedExecRemoteCommand,
  createRemoteShellSandboxFsBridge,
  sanitizeEnvVars
} from "openclaw/plugin-sdk/sandbox";
import { normalizeLowercaseStringOrEmpty } from "openclaw/plugin-sdk/string-coerce-runtime";

// src/config.ts
import path from "path";
import { buildPluginConfigSchema } from "openclaw/plugin-sdk/core";
import {
  formatPluginConfigIssue,
  mapPluginConfigIssues
} from "openclaw/plugin-sdk/extension-shared";
import { z } from "openclaw/plugin-sdk/zod";
var DEFAULT_WORKSPACE_ROOT = "/tmp/openclaw-sandboxes";
var nonEmptyTrimmedString = (message) => z.string({ error: message }).trim().min(1, { error: message });
var positiveNumber = (field) => z.number({ error: `${field} must be a number >= 1` }).min(1, {
  error: `${field} must be a number >= 1`
});
var TenkiPluginConfigSchema = z.strictObject({
  authToken: nonEmptyTrimmedString("authToken must be a non-empty string").optional(),
  baseUrl: nonEmptyTrimmedString("baseUrl must be a non-empty string").optional(),
  workspaceId: nonEmptyTrimmedString("workspaceId must be a non-empty string").optional(),
  image: nonEmptyTrimmedString("image must be a non-empty string").optional(),
  workspaceRoot: nonEmptyTrimmedString("workspaceRoot must be a non-empty string").optional(),
  idleTimeoutMinutes: positiveNumber("idleTimeoutMinutes").optional(),
  cpuCores: positiveNumber("cpuCores").optional(),
  memoryMb: positiveNumber("memoryMb").optional(),
  diskSizeGb: positiveNumber("diskSizeGb").optional(),
  tags: z.array(
    z.string({ error: "tags must be an array of strings" }).trim().min(1, {
      error: "tags must be an array of strings"
    }),
    { error: "tags must be an array of strings" }
  ).optional()
});
function normalizeWorkspaceRoot(value) {
  const candidate = value ?? DEFAULT_WORKSPACE_ROOT;
  const normalized = path.posix.normalize(candidate.trim().replaceAll("\\", "/"));
  if (!normalized.startsWith("/")) {
    throw new Error(`Tenki workspaceRoot must be an absolute POSIX path: ${candidate}`);
  }
  return normalized === "/" ? normalized : normalized.replace(/\/+$/g, "");
}
function createTenkiPluginConfigSchema() {
  return buildPluginConfigSchema(TenkiPluginConfigSchema, {
    safeParse(value) {
      if (value === void 0) {
        return { success: true, data: void 0 };
      }
      const parsed = TenkiPluginConfigSchema.safeParse(value);
      if (parsed.success) {
        return { success: true, data: parsed.data };
      }
      return {
        success: false,
        error: {
          issues: mapPluginConfigIssues(parsed.error.issues)
        }
      };
    }
  });
}
function resolveTenkiPluginConfig(value) {
  if (value === void 0) {
    return {
      workspaceRoot: DEFAULT_WORKSPACE_ROOT,
      tags: []
    };
  }
  const parsed = TenkiPluginConfigSchema.safeParse(value);
  if (!parsed.success) {
    const message = formatPluginConfigIssue(parsed.error.issues[0]);
    throw new Error(`Invalid tenki plugin config: ${message}`);
  }
  const cfg = parsed.data;
  return {
    authToken: cfg.authToken,
    baseUrl: cfg.baseUrl,
    workspaceId: cfg.workspaceId,
    image: cfg.image,
    workspaceRoot: normalizeWorkspaceRoot(cfg.workspaceRoot),
    idleTimeoutMinutes: cfg.idleTimeoutMinutes,
    cpuCores: cfg.cpuCores,
    memoryMb: cfg.memoryMb,
    diskSizeGb: cfg.diskSizeGb,
    tags: cfg.tags ?? []
  };
}

// src/shell.ts
import { shellEscape } from "openclaw/plugin-sdk/sandbox";
function buildPositionalArgsPrefix(args) {
  if (!args || args.length === 0) {
    return "";
  }
  return `set -- ${args.map((arg) => shellEscape(arg)).join(" ")}
`;
}

// src/ssh-transport.ts
import { spawn } from "child_process";
import fs from "fs/promises";
import net from "net";
import os from "os";
import path2 from "path";
var SSH_KEY_FILENAME = "id_ed25519";
var SSH_CERT_EXPIRY_SLACK_MS = 6e4;
function resolveTenkiStateDir() {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim() || path2.join(os.homedir(), ".openclaw");
  return path2.join(stateDir, "tenki");
}
async function ensureTenkiSshKeypair(stateDir = resolveTenkiStateDir()) {
  const privateKeyPath = path2.join(stateDir, SSH_KEY_FILENAME);
  const publicKeyPath = `${privateKeyPath}.pub`;
  try {
    const publicKey2 = (await fs.readFile(publicKeyPath, "utf8")).trim();
    if (publicKey2) {
      return { privateKeyPath, publicKey: publicKey2 };
    }
  } catch {
  }
  await fs.mkdir(stateDir, { recursive: true, mode: 448 });
  await new Promise((resolve, reject) => {
    const keygen = spawn(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-N", "", "-C", "openclaw-tenki-sandbox", "-f", privateKeyPath],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    const stderr = [];
    keygen.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    keygen.on("error", reject);
    keygen.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ssh-keygen failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      resolve();
    });
  });
  const publicKey = (await fs.readFile(publicKeyPath, "utf8")).trim();
  return { privateKeyPath, publicKey };
}
async function mintSessionSshCert(params) {
  const stateDir = params.stateDir ?? resolveTenkiStateDir();
  const cert = await params.client.issueSandboxSSHCert(params.sessionId, params.publicKey);
  const certificatePath = path2.join(stateDir, `${SSH_KEY_FILENAME}-${params.sessionId}-cert.pub`);
  await fs.mkdir(stateDir, { recursive: true, mode: 448 });
  await fs.writeFile(certificatePath, `${cert.sshCert.trim()}
`, { mode: 384 });
  return {
    certificatePath,
    expiresAt: cert.expiresAt,
    renewalAfterMs: cert.renewalAfterMs,
    mintedAtMs: Date.now()
  };
}
function shouldRenewSessionSshCert(cert, nowMs = Date.now()) {
  if (cert.expiresAt && cert.expiresAt.getTime() - nowMs <= SSH_CERT_EXPIRY_SLACK_MS) {
    return true;
  }
  if (cert.renewalAfterMs !== void 0 && nowMs - cert.mintedAtMs >= cert.renewalAfterMs) {
    return true;
  }
  return false;
}
async function startTenkiSshForwarder(getSession) {
  const server = net.createServer((socket) => {
    void forwardConnection(socket, getSession);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  server.unref();
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Tenki SSH forwarder failed to bind a loopback port.");
  }
  return {
    port: address.port,
    close: () => {
      server.close();
    }
  };
}
async function forwardConnection(socket, getSession) {
  let ssh;
  try {
    const session = await getSession();
    ssh = await session.ssh();
  } catch {
    socket.destroy();
    return;
  }
  socket.on("data", (chunk) => {
    void ssh.write(new Uint8Array(chunk)).catch(() => socket.destroy());
  });
  socket.on("close", () => ssh.close());
  socket.on("error", () => ssh.close());
  try {
    for (; ; ) {
      const chunk = await ssh.read();
      if (chunk === null) {
        break;
      }
      if (!socket.write(chunk)) {
        await new Promise((resolve) => {
          socket.once("drain", () => resolve());
        });
      }
    }
  } finally {
    socket.end();
    ssh.close();
  }
}
async function waitForSshAuth(params) {
  const timeoutMs = params.timeoutMs ?? 3e4;
  const sleep = params.sleep ?? ((ms) => new Promise((r) => {
    setTimeout(r, ms).unref();
  }));
  const deadline = Date.now() + timeoutMs;
  const argv = buildSshExecArgv({
    privateKeyPath: params.privateKeyPath,
    certificatePath: params.certificatePath,
    port: params.port,
    usePty: false,
    remoteCommand: "true"
  });
  for (let attempt = 0; ; attempt++) {
    const code = await new Promise((resolve) => {
      const child = spawn("ssh", [...argv.slice(1), "-o", "BatchMode=yes"], {
        stdio: ["ignore", "ignore", "ignore"]
      });
      child.on("error", () => resolve(-1));
      child.on("close", (c) => resolve(c ?? -1));
    });
    if (code === 0) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Tenki SSH transport not ready after ${timeoutMs}ms (last ssh exit ${code}).`
      );
    }
    await sleep(Math.min(2e3, 250 * (attempt + 1)));
  }
}
function buildSshExecArgv(params) {
  return [
    "ssh",
    "-i",
    params.privateKeyPath,
    "-o",
    `CertificateFile=${params.certificatePath}`,
    "-p",
    String(params.port),
    // The transport is authenticated end-to-end by the Tenki gateway session
    // credential; host keys are per-VM throwaways with no continuity to pin.
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "LogLevel=ERROR",
    params.usePty ? "-tt" : "-T",
    "tenki@127.0.0.1",
    params.remoteCommand
  ];
}

// src/upload.ts
import { spawn as spawn2 } from "child_process";
import fs2 from "fs/promises";
import path3 from "path";
async function createLocalTarball(localDir) {
  await assertSafeUploadSymlinks(localDir);
  return await new Promise((resolve, reject) => {
    const tar = spawn2("tar", ["-C", localDir, "-cf", "-", "."], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks = [];
    const stderr = [];
    tar.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    tar.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    tar.on("error", reject);
    tar.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`tar failed (${code}): ${Buffer.concat(stderr).toString("utf8")}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}
async function assertSafeUploadSymlinks(localDir) {
  const realRoot = await fs2.realpath(path3.resolve(localDir));
  await walkDirectory(realRoot);
  async function walkDirectory(currentDir) {
    const entries = await fs2.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path3.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        let resolved;
        try {
          resolved = await fs2.realpath(entryPath);
        } catch {
          const target = await fs2.readlink(entryPath);
          resolved = await canonicalizeViaExistingAncestor(path3.resolve(currentDir, target));
        }
        if (resolved !== realRoot && !resolved.startsWith(realRoot + path3.sep)) {
          const relativePath = path3.relative(realRoot, entryPath).split(path3.sep).join("/");
          throw new Error(
            `Tenki sandbox upload refuses symlink escaping the workspace: ${relativePath}`
          );
        }
        continue;
      }
      if (entry.isDirectory()) {
        await walkDirectory(entryPath);
      }
    }
  }
}
async function canonicalizeViaExistingAncestor(absolutePath) {
  let base = absolutePath;
  const suffix = [];
  while (true) {
    try {
      const real = await fs2.realpath(base);
      return suffix.length > 0 ? path3.join(real, ...suffix) : real;
    } catch {
      const parent = path3.dirname(base);
      if (parent === base) {
        return absolutePath;
      }
      suffix.unshift(path3.basename(base));
      base = parent;
    }
  }
}

// src/backend.ts
var TENKI_SESSION_TAG = "openclaw";
var TENKI_SESSION_WORKDIR = "/home/tenki";
var ENSURE_REMOTE_REAL_DIRECTORY_SCRIPT = [
  "set -e",
  'target="$1"',
  'root="${2:-$1}"',
  'case "$target" in /*) ;; *) echo "remote directory must be absolute: $target" >&2; exit 1 ;; esac',
  'case "$root" in /*) ;; *) echo "remote root must be absolute: $root" >&2; exit 1 ;; esac',
  'target="${target%/}"',
  'root="${root%/}"',
  '[ -n "$target" ] || target="/"',
  '[ -n "$root" ] || root="/"',
  'case "$target/" in "$root"/*|"$root/") ;; *) echo "remote directory must stay under root: $target" >&2; exit 1 ;; esac',
  'for path_to_check in "$target" "$root"; do',
  '  relative="${path_to_check#/}"',
  '  while [ -n "$relative" ]; do',
  '    part="${relative%%/*}"',
  '    if [ "$part" = "$relative" ]; then relative=""; else relative="${relative#*/}"; fi',
  '    [ -n "$part" ] || continue',
  '    case "$part" in "."|"..") echo "unsafe remote directory component: $part" >&2; exit 1 ;; esac',
  "  done",
  "done",
  'if [ -L "$root" ]; then echo "unsafe remote root symlink: $root" >&2; exit 1; fi',
  'mkdir -p -- "$root"',
  'canonical_root="$(cd "$root" && pwd -P)"',
  'relative="${target#"$root"}"',
  'relative="${relative#/}"',
  'current="$canonical_root"',
  'while [ -n "$relative" ]; do',
  '  part="${relative%%/*}"',
  '  if [ "$part" = "$relative" ]; then relative=""; else relative="${relative#*/}"; fi',
  '  [ -n "$part" ] || continue',
  '  if [ "$current" = "/" ]; then next="/$part"; else next="$current/$part"; fi',
  '  if [ -L "$next" ]; then echo "unsafe remote directory symlink: $next" >&2; exit 1; fi',
  '  if [ -e "$next" ]; then',
  '    if [ ! -d "$next" ]; then echo "unsafe remote directory component: $next" >&2; exit 1; fi',
  "  else",
  '    mkdir -- "$next"',
  "  fi",
  '  current="$next"',
  "done"
].join("\n");
var VALIDATE_REMOTE_WORKDIR_SCRIPT = [
  "set -e",
  'target="$1"',
  'root="$2"',
  'case "$target" in /*) ;; *) echo "remote directory must be absolute: $target" >&2; exit 1 ;; esac',
  'case "$root" in /*) ;; *) echo "remote root must be absolute: $root" >&2; exit 1 ;; esac',
  'target="${target%/}"',
  'root="${root%/}"',
  '[ -n "$target" ] || target="/"',
  '[ -n "$root" ] || root="/"',
  'if [ "$root" != "/" ]; then',
  '  case "$target/" in "$root"/*|"$root/") ;; *) echo "remote directory must stay under root: $target" >&2; exit 1 ;; esac',
  "fi",
  'for path_to_check in "$target" "$root"; do',
  '  relative="${path_to_check#/}"',
  '  while [ -n "$relative" ]; do',
  '    part="${relative%%/*}"',
  '    if [ "$part" = "$relative" ]; then relative=""; else relative="${relative#*/}"; fi',
  '    [ -n "$part" ] || continue',
  '    case "$part" in "."|"..") echo "unsafe remote directory component: $part" >&2; exit 1 ;; esac',
  "  done",
  "done",
  'if [ -L "$root" ]; then echo "unsafe remote root symlink: $root" >&2; exit 1; fi',
  'if [ ! -d "$root" ]; then echo "remote root not found: $root" >&2; exit 1; fi',
  'canonical_root="$(cd "$root" && pwd -P)"',
  'relative="${target#"$root"}"',
  'relative="${relative#/}"',
  'current="$canonical_root"',
  'while [ -n "$relative" ]; do',
  '  part="${relative%%/*}"',
  '  if [ "$part" = "$relative" ]; then relative=""; else relative="${relative#*/}"; fi',
  '  [ -n "$part" ] || continue',
  '  if [ "$current" = "/" ]; then next="/$part"; else next="$current/$part"; fi',
  '  if [ -L "$next" ]; then echo "unsafe remote directory symlink: $next" >&2; exit 1; fi',
  '  if [ ! -d "$next" ]; then echo "remote directory not found: $next" >&2; exit 1; fi',
  '  current="$next"',
  "done",
  'printf "%s\\n" "$current"'
].join("\n");
function createTenkiClient(cfg) {
  return new TenkiSandbox({
    authToken: cfg.authToken,
    baseUrl: cfg.baseUrl
  });
}
async function findRuntimeSessions(cfg, runtimeId) {
  const client = createTenkiClient(cfg);
  const sessions = await client.list({ tags: [runtimeId] });
  return sessions.filter((session) => !isTerminal(session.state));
}
function tenkiConfigLabel(cfg) {
  return cfg.image ?? "tenki-default";
}
function resolveTenkiPluginConfigFromConfig(config, fallback) {
  const pluginConfig = config.plugins?.entries?.tenki?.config;
  if (!pluginConfig) {
    return fallback;
  }
  return resolveTenkiPluginConfig(pluginConfig);
}
function createTenkiSandboxBackendFactory(params) {
  return async (createParams) => await createTenkiSandboxBackend({
    pluginConfig: params.pluginConfig,
    createParams
  });
}
function createTenkiSandboxBackendManager(params) {
  return {
    async describeRuntime({ entry, config }) {
      const cfg = resolveTenkiPluginConfigFromConfig(config, params.pluginConfig);
      const runtimePaths = resolveTenkiRuntimePaths(cfg.workspaceRoot, entry.sessionKey);
      const sessions = await findRuntimeSessions(cfg, runtimePaths.runtimeId);
      return {
        running: sessions.length > 0,
        actualConfigLabel: tenkiConfigLabel(cfg),
        configLabelMatch: entry.image === tenkiConfigLabel(cfg)
      };
    },
    async removeRuntime({ entry, config }) {
      const cfg = resolveTenkiPluginConfigFromConfig(config, params.pluginConfig);
      const runtimePaths = resolveTenkiRuntimePaths(cfg.workspaceRoot, entry.sessionKey);
      const sessions = await findRuntimeSessions(cfg, runtimePaths.runtimeId);
      for (const session of sessions) {
        await session.closeIfOpen();
      }
    }
  };
}
async function createTenkiSandboxBackend(params) {
  if ((params.createParams.cfg.docker.binds?.length ?? 0) > 0) {
    throw new Error("Tenki sandbox backend does not support sandbox.docker.binds.");
  }
  const runtimePaths = resolveTenkiRuntimePaths(
    params.pluginConfig.workspaceRoot,
    params.createParams.scopeKey
  );
  const impl = new TenkiSandboxBackendImpl({
    pluginConfig: params.pluginConfig,
    createParams: params.createParams,
    runtimePaths
  });
  return impl.asHandle();
}
var TenkiSandboxBackendImpl = class {
  constructor(params) {
    this.params = params;
  }
  params;
  sessionPromise = null;
  ensurePromise = null;
  sshKeypairPromise = null;
  sshForwarderPromise = null;
  sshCert = null;
  sshCertSessionId = null;
  get cfg() {
    return this.params.pluginConfig;
  }
  asHandle() {
    return {
      id: "tenki",
      runtimeId: this.params.runtimePaths.runtimeId,
      runtimeLabel: this.params.runtimePaths.runtimeId,
      workdir: this.params.runtimePaths.remoteWorkspaceDir,
      env: this.params.createParams.cfg.docker.env,
      configLabel: tenkiConfigLabel(this.cfg),
      configLabelKind: "Image",
      workdirValidation: "backend",
      validateWorkdir: async (workdir) => await this.validateWorkdir(workdir),
      workdirRoots: [
        this.params.runtimePaths.remoteWorkspaceDir,
        this.params.runtimePaths.remoteAgentWorkspaceDir
      ],
      buildExecSpec: async ({ command, workdir, env, usePty }) => {
        const remoteCommand = buildValidatedExecRemoteCommand({
          command,
          workdir: workdir ?? this.params.runtimePaths.remoteWorkspaceDir,
          env
        });
        await this.ensureRuntime();
        const session = await this.getSession();
        const { keypair, cert, forwarder } = await this.ensureSshTransport(session);
        return {
          argv: buildSshExecArgv({
            privateKeyPath: keypair.privateKeyPath,
            certificatePath: cert.certificatePath,
            port: forwarder.port,
            usePty,
            remoteCommand
          }),
          env: sanitizeEnvVars(process.env).allowed,
          stdinMode: "pipe-open"
        };
      },
      runShellCommand: async (command) => await this.runRemoteShellScript(command),
      createFsBridge: ({ sandbox }) => createRemoteShellSandboxFsBridge({
        sandbox,
        runtime: {
          remoteWorkspaceDir: this.params.runtimePaths.remoteWorkspaceDir,
          remoteAgentWorkspaceDir: this.params.runtimePaths.remoteAgentWorkspaceDir,
          runRemoteShellScript: async (command) => await this.runRemoteShellScript(command)
        }
      })
    };
  }
  async getSession() {
    if (!this.sessionPromise) {
      this.sessionPromise = this.getSessionInner().catch((error) => {
        this.sessionPromise = null;
        throw error;
      });
    }
    return await this.sessionPromise;
  }
  /** Ensure keypair, a valid per-session edge certificate, and the loopback forwarder. */
  async ensureSshTransport(session) {
    this.sshKeypairPromise ??= ensureTenkiSshKeypair();
    const keypair = await this.sshKeypairPromise;
    this.sshForwarderPromise ??= startTenkiSshForwarder(async () => await this.getSession());
    const forwarder = await this.sshForwarderPromise;
    if (!this.sshCert || this.sshCertSessionId !== session.id || shouldRenewSessionSshCert(this.sshCert)) {
      const isNewSession = this.sshCertSessionId !== session.id;
      this.sshCert = await mintSessionSshCert({
        client: createTenkiClient(this.cfg),
        sessionId: session.id,
        publicKey: keypair.publicKey
      });
      this.sshCertSessionId = session.id;
      if (isNewSession) {
        await waitForSshAuth({
          privateKeyPath: keypair.privateKeyPath,
          certificatePath: this.sshCert.certificatePath,
          port: forwarder.port
        });
      }
    }
    return { keypair, cert: this.sshCert, forwarder };
  }
  async getSessionInner() {
    const client = createTenkiClient(this.cfg);
    const existing = await findRuntimeSessions(this.cfg, this.params.runtimePaths.runtimeId);
    const reusable = existing[0];
    if (reusable) {
      if (reusable.state === "PAUSED") {
        await reusable.resume();
      }
      await reusable.waitReady();
      return reusable;
    }
    return await client.create({
      name: this.params.runtimePaths.runtimeId,
      tags: [TENKI_SESSION_TAG, this.params.runtimePaths.runtimeId, ...this.cfg.tags],
      workspaceId: this.cfg.workspaceId,
      image: this.cfg.image,
      idleTimeoutMinutes: this.cfg.idleTimeoutMinutes,
      cpuCores: this.cfg.cpuCores,
      memoryMb: this.cfg.memoryMb,
      diskSizeGb: this.cfg.diskSizeGb,
      allowOutbound: true
    });
  }
  async ensureRuntime() {
    if (this.ensurePromise) {
      return await this.ensurePromise;
    }
    this.ensurePromise = this.ensureRuntimeInner();
    try {
      await this.ensurePromise;
    } catch (error) {
      this.ensurePromise = null;
      throw error;
    }
  }
  async ensureRuntimeInner() {
    const session = await this.getSession();
    const exists = await this.execShell(session, {
      script: 'if [ -d "$1" ]; then printf "1\\n"; else printf "0\\n"; fi',
      args: [this.params.runtimePaths.runtimeRootDir]
    });
    if (exists.stdout.toString("utf8").trim() === "1") {
      return;
    }
    await this.uploadDirectory(
      session,
      this.params.createParams.workspaceDir,
      this.params.runtimePaths.remoteWorkspaceDir
    );
    if (this.params.createParams.cfg.workspaceAccess !== "none" && path4.resolve(this.params.createParams.agentWorkspaceDir) !== path4.resolve(this.params.createParams.workspaceDir)) {
      await this.uploadDirectory(
        session,
        this.params.createParams.agentWorkspaceDir,
        this.params.runtimePaths.remoteAgentWorkspaceDir
      );
    }
    await this.refreshSkillsWorkspace(session);
  }
  // Draft limitation: the skills workspace is uploaded once when the runtime root
  // is first created; the SSH backend refreshes it before each exec.
  async refreshSkillsWorkspace(session) {
    if (this.params.createParams.cfg.workspaceAccess !== "rw" || !this.params.createParams.skillsWorkspaceDir || !await isExistingDirectory(this.params.createParams.skillsWorkspaceDir)) {
      return;
    }
    await this.uploadDirectory(
      session,
      this.params.createParams.skillsWorkspaceDir,
      this.params.runtimePaths.remoteSkillsWorkspaceDir
    );
  }
  async validateWorkdir(workdir) {
    await this.ensureRuntime();
    const session = await this.getSession();
    const result = await this.execShell(session, {
      script: VALIDATE_REMOTE_WORKDIR_SCRIPT,
      args: [workdir, this.resolveWorkdirValidationRoot(workdir)],
      allowFailure: true
    });
    const resolved = result.code === 0 ? result.stdout.toString("utf8").trim() : "";
    return resolved || null;
  }
  resolveWorkdirValidationRoot(workdir) {
    const roots = [
      this.params.runtimePaths.remoteAgentWorkspaceDir,
      this.params.runtimePaths.remoteWorkspaceDir
    ];
    return roots.find((root) => isRemotePathInsideRoot(root, workdir)) ?? this.params.runtimePaths.remoteWorkspaceDir;
  }
  async runRemoteShellScript(params) {
    await this.ensureRuntime();
    const session = await this.getSession();
    return await this.execShell(session, params);
  }
  async execShell(session, params) {
    let script = params.script;
    let env;
    if (params.stdin !== void 0) {
      const stdinFile = `${TENKI_SESSION_WORKDIR}/.openclaw-stdin-${randomUUID()}`;
      await session.writeFile(
        stdinFile,
        typeof params.stdin === "string" ? params.stdin : new Uint8Array(params.stdin)
      );
      env = { OPENCLAW_STDIN_FILE: stdinFile };
      script = `exec 0<"$OPENCLAW_STDIN_FILE" && rm -f -- "$OPENCLAW_STDIN_FILE"
${script}`;
    }
    script = `${buildPositionalArgsPrefix(params.args)}${script}`;
    const result = await session.exec("/bin/sh", {
      args: ["-c", script],
      env,
      signal: params.signal
    });
    const stdout = Buffer.from(result.stdout);
    const stderr = Buffer.from(result.stderr);
    if (result.status === "TIMED_OUT") {
      throw new Error(`Tenki sandbox command timed out: ${stderr.toString("utf8")}`);
    }
    if (!params.allowFailure && result.exitCode !== 0) {
      throw new Error(
        `Tenki sandbox command failed (${result.exitCode}): ${stderr.toString("utf8")}`
      );
    }
    return { stdout, stderr, code: result.exitCode };
  }
  async uploadDirectory(session, localDir, remoteDir) {
    const tarball = await createLocalTarball(localDir);
    const remoteTar = `${TENKI_SESSION_WORKDIR}/.openclaw-upload-${randomUUID()}.tar`;
    await session.writeFile(remoteTar, tarball);
    await this.execShell(session, {
      script: `${ENSURE_REMOTE_REAL_DIRECTORY_SCRIPT}
find "$1" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
tar -xf "$3" -C "$1"
rm -f -- "$3"`,
      args: [remoteDir, this.params.runtimePaths.runtimeRootDir, remoteTar]
    });
  }
};
async function isExistingDirectory(dir) {
  try {
    return (await fs3.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}
function normalizeRemotePath(input) {
  const normalized = path4.posix.normalize(input.replace(/\\/g, "/"));
  return normalized === "/" ? normalized : normalized.replace(/\/+$/g, "");
}
function isRemotePathInsideRoot(root, candidate) {
  const normalizedRoot = normalizeRemotePath(root);
  const normalizedCandidate = normalizeRemotePath(candidate);
  return normalizedCandidate === normalizedRoot || (normalizedRoot === "/" ? normalizedCandidate.startsWith("/") : normalizedCandidate.startsWith(`${normalizedRoot}/`));
}
function resolveTenkiRuntimePaths(workspaceRoot, scopeKey) {
  const runtimeId = buildTenkiSandboxRuntimeId(scopeKey);
  const runtimeRootDir = path4.posix.join(workspaceRoot, runtimeId);
  return {
    runtimeId,
    runtimeRootDir,
    remoteWorkspaceDir: path4.posix.join(runtimeRootDir, "workspace"),
    remoteAgentWorkspaceDir: path4.posix.join(runtimeRootDir, "agent"),
    remoteSkillsWorkspaceDir: path4.posix.join(
      runtimeRootDir,
      "workspace",
      ".openclaw",
      "sandbox-skills"
    )
  };
}
function buildTenkiSandboxRuntimeId(scopeKey) {
  const trimmed = scopeKey.trim() || "session";
  const safe = normalizeLowercaseStringOrEmpty(trimmed).replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 14);
  const hash = Array.from(trimmed).reduce(
    (acc, char) => (acc * 33 ^ char.charCodeAt(0)) >>> 0,
    5381
  );
  return `oc-tenki-${safe || "session"}-${hash.toString(16).slice(0, 8)}`;
}

// index.ts
var index_default = definePluginEntry({
  id: "tenki",
  name: "Tenki Cloud Sandbox",
  description: "Tenki Cloud microVM-backed sandbox runtime for agent exec and file tools.",
  configSchema: createTenkiPluginConfigSchema(),
  register(api) {
    if (api.registrationMode !== "full") {
      return;
    }
    const pluginConfig = resolveTenkiPluginConfig(api.pluginConfig);
    registerSandboxBackend("tenki", {
      factory: createTenkiSandboxBackendFactory({ pluginConfig }),
      manager: createTenkiSandboxBackendManager({ pluginConfig }),
      resolveWorkdir: ({ scopeKey }) => resolveTenkiRuntimePaths(pluginConfig.workspaceRoot, scopeKey).remoteWorkspaceDir
    });
  }
});
export {
  index_default as default
};
//# sourceMappingURL=index.js.map