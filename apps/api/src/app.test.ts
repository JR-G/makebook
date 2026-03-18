import { describe, test, expect } from "bun:test";
import { createApp } from "./app.ts";

describe("createApp", () => {
  test("returns an Express application instance", () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
    expect(typeof app.use).toBe("function");
  });

  test("has json parsing middleware configured", () => {
    const app = createApp();
    expect(typeof app.get).toBe("function");
  });

  test("returns undefined for non-existent configuration", () => {
    const app = createApp();
    expect(app.get("nonExistentSetting")).toBeUndefined();
  });
});
