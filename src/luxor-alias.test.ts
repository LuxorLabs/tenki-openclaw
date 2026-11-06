import { afterEach, describe, expect, it, vi } from "vitest";
import { readLuxorAiEnv } from "./config.js";

const registered = vi.hoisted(() => [] as Array<{ id: string; registration: unknown }>);
vi.mock("openclaw/plugin-sdk/sandbox", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  registerSandboxBackend: (id: string, registration: unknown) => {
    registered.push({ id, registration });
    return () => {};
  },
}));

describe("readLuxorAiEnv", () => {
  afterEach(() => {
    delete process.env.LUXORAI_AUTH_TOKEN;
    delete process.env.LUXORAI_API_KEY;
  });

  it("returns the first non-empty LUXORAI_* value in order", () => {
    process.env.LUXORAI_API_KEY = "lx_key";
    expect(readLuxorAiEnv("AUTH_TOKEN", "API_KEY")).toBe("lx_key");
    process.env.LUXORAI_AUTH_TOKEN = "lx_token";
    expect(readLuxorAiEnv("AUTH_TOKEN", "API_KEY")).toBe("lx_token");
  });

  it("is undefined when only blank values are set, leaving TENKI_* to the SDK", () => {
    process.env.LUXORAI_AUTH_TOKEN = "  ";
    expect(readLuxorAiEnv("AUTH_TOKEN", "API_KEY")).toBeUndefined();
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
