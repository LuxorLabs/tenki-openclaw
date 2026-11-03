import { describe, expect, it } from "vitest";
import { resolveTenkiRuntimePaths } from "./backend.js";
import { buildPositionalArgsPrefix, buildStagedExecScript } from "./shell.js";

describe("buildPositionalArgsPrefix", () => {
  it("returns empty for no args", () => {
    expect(buildPositionalArgsPrefix(undefined)).toBe("");
    expect(buildPositionalArgsPrefix([])).toBe("");
  });

  it("preserves empty-string positionals via quoting", () => {
    expect(buildPositionalArgsPrefix(["read", "/mnt", "", "file.txt"])).toBe(
      "set -- 'read' '/mnt' '' 'file.txt'\n",
    );
  });

  it("escapes single quotes", () => {
    expect(buildPositionalArgsPrefix(["it's"])).toBe(`set -- 'it'"'"'s'\n`);
  });
});

describe("resolveTenkiRuntimePaths", () => {
  it("builds stable per-scope remote paths", () => {
    const paths = resolveTenkiRuntimePaths("/tmp/openclaw-sandboxes", "agent:main");
    expect(paths.runtimeId).toMatch(/^oc-tenki-agent-main-[0-9a-f]{1,8}$/);
    expect(paths.runtimeId.length).toBeLessThanOrEqual(32);
    expect(paths.runtimeRootDir).toBe(`/tmp/openclaw-sandboxes/${paths.runtimeId}`);
    expect(paths.remoteWorkspaceDir).toBe(`${paths.runtimeRootDir}/workspace`);
    expect(paths.remoteAgentWorkspaceDir).toBe(`${paths.runtimeRootDir}/agent`);
  });

  it("differs for different scope keys", () => {
    const a = resolveTenkiRuntimePaths("/tmp/openclaw-sandboxes", "agent:a");
    const b = resolveTenkiRuntimePaths("/tmp/openclaw-sandboxes", "agent:b");
    expect(a.runtimeId).not.toBe(b.runtimeId);
  });

  it("keeps the runtime id within Tenki's 32-char tag limit", () => {
    const paths = resolveTenkiRuntimePaths(
      "/tmp/openclaw-sandboxes",
      "agent:very-long-agent-name:session:with-many-segments",
    );
    expect(paths.runtimeId.length).toBeLessThanOrEqual(32);
  });

  it("falls back to a session id for empty scope keys", () => {
    const paths = resolveTenkiRuntimePaths("/tmp/openclaw-sandboxes", "  ");
    expect(paths.runtimeId).toMatch(/^oc-tenki-session-[0-9a-f]{1,8}$/);
  });
});

describe("buildStagedExecScript", () => {
  const scriptPath = "/home/tenki/.openclaw-exec-abc.sh";

  it("self-deletes, exports env with shell quoting, then execs the command", () => {
    const script = buildStagedExecScript({
      scriptPath,
      remoteCommand: "/bin/sh -c 'cd /w && echo hi'",
      env: { FOO: "it's", BAR: "plain" },
      tty: false,
    });
    expect(script.split("\n")).toEqual([
      "#!/bin/sh",
      "set -e",
      "rm -f -- '/home/tenki/.openclaw-exec-abc.sh'",
      "export FOO='it'\"'\"'s'",
      "export BAR='plain'",
      "exec /bin/sh -c 'cd /w && echo hi'",
      "",
    ]);
  });

  it("defaults TERM for tty execs without overriding an explicit value", () => {
    expect(buildStagedExecScript({ scriptPath, remoteCommand: "true", env: {}, tty: true })).toContain(
      "export TERM='xterm-256color'",
    );
    expect(
      buildStagedExecScript({ scriptPath, remoteCommand: "true", env: { TERM: "dumb" }, tty: true }),
    ).not.toContain("xterm-256color");
    expect(buildStagedExecScript({ scriptPath, remoteCommand: "true", env: {}, tty: false })).not.toContain(
      "TERM",
    );
  });

  it("rejects non-POSIX names and NUL bytes", () => {
    expect(() =>
      buildStagedExecScript({ scriptPath, remoteCommand: "true", env: { "BAD-NAME": "x" }, tty: false }),
    ).toThrow(/POSIX variable name/);
    expect(() =>
      buildStagedExecScript({ scriptPath, remoteCommand: "true", env: { OK: "a\0b" }, tty: false }),
    ).toThrow(/NUL bytes/);
  });
});
