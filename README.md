# OpenClaw Tenki Cloud Sandbox

OpenClaw sandbox backend that runs agent tool execution in remote [Tenki Cloud](https://tenki.cloud) VM sessions via the [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) TypeScript SDK.

One Tenki session is created per sandbox scope (found-or-created by a runtime tag; paused sessions are resumed). The local workspace is mirrored into the session, shell and filesystem-bridge commands run over the SDK exec surface, and interactive exec runs over plain `ssh` through an in-process loopback forwarder backed by the SDK's gateway SSH stream.

Originally proposed as a bundled OpenClaw extension in [openclaw/openclaw#111792](https://github.com/openclaw/openclaw/pull/111792); this repo packages the same plugin standalone.

## Install

From ClawHub ([`@tenkicloud/openclaw`](https://clawhub.ai)):

```bash
openclaw plugins install clawhub:@tenkicloud/openclaw
```

Or from a local checkout:

```bash
git clone https://github.com/LuxorLabs/tenki-openclaw
openclaw plugins install ./tenki-openclaw
```

## Usage

```jsonc
{
  "plugins": {
    "entries": {
      "tenki": {
        "enabled": true,
        "config": {
          "image": "ubuntu-24",
          "memoryMb": 4096,
        },
      },
    },
  },
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "backend": "tenki",
      },
    },
  },
}
```

Authentication uses `TENKI_AUTH_TOKEN` / `TENKI_API_KEY` from the environment (preferred), or the `authToken` plugin config value.

### Config reference

| Key | Description |
| --- | --- |
| `authToken` | Tenki API token. Prefer the `TENKI_AUTH_TOKEN` / `TENKI_API_KEY` env vars over storing it in config. |
| `baseUrl` | Tenki API endpoint override. Defaults to the SDK's `TENKI_API_ENDPOINT` / `TENKI_API_URL` fallback. |
| `workspaceId` | Tenki workspace the sessions are created in. |
| `image` | Base image id for created sandbox sessions. Omit for the Tenki default image. |
| `workspaceRoot` | Absolute path inside the session used for per-scope workspaces. |
| `idleTimeoutMinutes` | Terminate the session after this many idle minutes. |
| `cpuCores` / `memoryMb` / `diskSizeGb` | Resources per session. |
| `tags` | Extra tags attached to created sessions. |

## How exec works

Interactive exec spawns plain `ssh` against a loopback forwarder whose upstream is the SDK's gateway SSH stream — no `tenki` CLI required anywhere, and `usePty` maps to real PTY allocation (`ssh -tt`). The gateway stream terminates at Tenki's edge SSH gateway, which only accepts certificate auth: a dedicated ed25519 keypair is generated once under the OpenClaw state dir, and a short-lived per-session user certificate is minted through the SDK and re-minted automatically near expiry.

## Development

```bash
npm install
npm run typecheck
npm test
```

## Known limitations

- The skills workspace is uploaded once at runtime bootstrap, not refreshed per exec.
- Workspace upload buffers a tarball in memory; large workspaces should stream.
- The SSH forwarder listener lives for the gateway process lifetime (one per sandbox scope; backend handles have no dispose hook).
