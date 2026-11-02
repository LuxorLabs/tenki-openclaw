import { shellEscape } from "openclaw/plugin-sdk/sandbox";

// Tenki's exec API rejects empty argv elements (protovalidate min_len: 1),
// but fs-bridge scripts legitimately pass "" positionals. Inline them with
// `set --` and shell quoting so empty strings survive as ''.
export function buildPositionalArgsPrefix(args: readonly string[] | undefined): string {
  if (!args || args.length === 0) {
    return "";
  }
  return `set -- ${args.map((arg) => shellEscape(arg)).join(" ")}\n`;
}

const POSIX_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Build the self-deleting `/bin/sh` script the backend stages into the session
 * for each exec. Since openclaw 2026.10.x the host's remote-command builder
 * refuses inline env (`buildExecRemoteCommand` throws when env is non-empty),
 * and expects SSH-style backends to stage env + command as a script instead
 * (the core `prepareSshSandboxExec` path). This mirrors that script shape.
 */
export function buildStagedExecScript(params: {
  scriptPath: string;
  remoteCommand: string;
  env: Record<string, string>;
  tty: boolean;
}): string {
  const env =
    params.tty && params.env.TERM === undefined
      ? { TERM: "xterm-256color", ...params.env }
      : params.env;
  for (const [key, value] of Object.entries(env)) {
    if (!POSIX_ENV_NAME.test(key)) {
      throw new Error(
        `Invalid sandbox environment variable name ${JSON.stringify(key)}; use a POSIX variable name.`,
      );
    }
    if (value.includes("\0")) {
      throw new Error(
        `Invalid sandbox environment variable ${JSON.stringify(key)}; values must not contain NUL bytes.`,
      );
    }
  }
  return [
    "#!/bin/sh",
    "set -e",
    `rm -f -- ${shellEscape(params.scriptPath)}`,
    ...Object.entries(env).map(([key, value]) => `export ${key}=${shellEscape(value)}`),
    `exec ${params.remoteCommand}`,
    "",
  ].join("\n");
}
