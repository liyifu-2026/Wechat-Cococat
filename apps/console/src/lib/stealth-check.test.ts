import { describe, it, expect } from "vitest"
import { checkStealthText } from "./stealth-check"

describe("checkStealthText", () => {
  it("passes official客服文案", () => {
    const r = checkStealthText("您好，这边是 CocoCat 客服，请问有什么可以帮您？")
    expect(r.ok).toBe(true)
    expect(r.hits).toEqual([])
  })

  it("flags AI-related words", () => {
    const r = checkStealthText("我是 AI 客服")
    expect(r.ok).toBe(false)
    expect(r.hits.length).toBeGreaterThan(0)
  })
})
