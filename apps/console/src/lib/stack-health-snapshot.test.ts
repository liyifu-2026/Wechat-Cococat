import { describe, expect, it } from "vitest"
import { mapRustHealthSnapshot } from "@/lib/stack-health-snapshot"

describe("mapRustHealthSnapshot", () => {
  it("maps camelCase Rust payload to store shape", () => {
    const mapped = mapRustHealthSnapshot({
      driver: "up",
      memory: "up",
      agent: "down",
      wechatLoggedIn: true,
      chatsReady: false,
      chatsReadyReason: "missing_db_keys",
      wechatAuthStatus: "logged_in",
      wechatLoggedInUser: "wxid_test",
      statusLines: {
        driver: "driver: up (http://127.0.0.1:6174)",
        memory: "memory: up",
        agent: "agent: down",
      },
    })

    expect(mapped.wechatLoggedIn).toBe(true)
    expect(mapped.chatsReady).toBe(false)
    expect(mapped.chatsReadyReason).toBe("missing_db_keys")
    expect(mapped.statusLines.agent).toBe("agent: down")
  })
})
