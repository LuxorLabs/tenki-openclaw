import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLuxorEnv } from "./config.js";

const registered = vi.hoisted(() => [] as Array<{ id: string; registration: unknown }>);
vi.mock("openclaw/plugin-sdk/sandbox", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  registerSandboxBackend: (id: string, registration: unknown) => {
    registered.push({ id, registration });
    return () => {};
  },
}));

const ENV_NAMES = [
  "LUXOR_AUTH_TOKEN",
  "LUXOR_API_KEY",
  "LUXOR_API_ENDPOINT",
  "LUXOR_API_URL",
  "TENKI_AUTH_TOKEN",
  "TENKI_API_KEY",
  "TENKI_API_ENDPOINT",
  "TENKI_API_URL",
];

describe("readLuxorEnv", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of ENV_NAMES) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const readAuth = () => readLuxorEnv("AUTH_TOKEN", "API_KEY");

  it("resolves auth as LUXOR_AUTH_TOKEN, LUXOR_API_KEY, TENKI_AUTH_TOKEN, TENKI_API_KEY", () => {
    process.env.TENKI_API_KEY = "tenki-key";
    expect(readAuth()).toBe("tenki-key");
    process.env.TENKI_AUTH_TOKEN = "tenki-token";
    expect(readAuth()).toBe("tenki-token");
    process.env.LUXOR_API_KEY = "lx_key";
    expect(readAuth()).toBe("lx_key");
    process.env.LUXOR_AUTH_TOKEN = "luxor-token";
    expect(readAuth()).toBe("luxor-token");
  });

  it("prefers LUXOR_* over TENKI_* for the endpoint", () => {
    process.env.TENKI_API_ENDPOINT = "https://tenki.example";
    expect(readLuxorEnv("API_ENDPOINT", "API_URL")).toBe("https://tenki.example");
    process.env.LUXOR_API_URL = "https://luxor.example";
    expect(readLuxorEnv("API_ENDPOINT", "API_URL")).toBe("https://luxor.example");
  });

  it("treats blank values as unset", () => {
    process.env.LUXOR_AUTH_TOKEN = "  ";
    expect(readAuth()).toBeUndefined();
    process.env.TENKI_API_KEY = " tenki-key ";
    expect(readAuth()).toBe("tenki-key");
  });

  it("uses LUXOR_API_KEY when it starts with lx_", () => {
    process.env.TENKI_API_KEY = "tenki-key";
    process.env.LUXOR_API_KEY = " lx_key ";
    expect(readAuth()).toBe("lx_key");
  });

  it("uses LUXOR_API_KEY when it starts with tk_", () => {
    process.env.TENKI_API_KEY = "tenki-key";
    process.env.LUXOR_API_KEY = "tk_key";
    expect(readAuth()).toBe("tk_key");
  });

  it("ignores a LUXOR_API_KEY without the lx_ or tk_ prefix and falls back to TENKI_API_KEY", () => {
    process.env.LUXOR_API_KEY = "pool-key-123";
    process.env.TENKI_API_KEY = "tenki-key";
    expect(readAuth()).toBe("tenki-key");
  });

  it("is undefined when LUXOR_API_KEY is not prefixed and no TENKI_* is set", () => {
    process.env.LUXOR_API_KEY = "pool-key-123";
    expect(readAuth()).toBeUndefined();
  });

  it("does not apply the prefix guard to LUXOR_AUTH_TOKEN or TENKI_API_KEY", () => {
    process.env.TENKI_API_KEY = "pool-key-123";
    expect(readAuth()).toBe("pool-key-123");
    process.env.LUXOR_AUTH_TOKEN = "plain-token";
    expect(readAuth()).toBe("plain-token");
  });
});

describe("plugin entry", () => {
  it("registers the same backend under tenki and the luxor alias", async () => {
    const { default: entry } = await import("../index.js");
    entry.register({ registrationMode: "full", pluginConfig: {} } as never);
    expect(registered.map((r) => r.id)).toEqual(["tenki", "luxor"]);
    expect(registered[0]!.registration).toBe(registered[1]!.registration);
  });
});
