const LEADING_ASSISTANT_PHRASES = [
  /^(当然可以|当然|没问题)[，,。！!\s]+(?=(我来|我可以|以下|下面|为你|帮你))/,
  /^(我来|我可以|我会)?(帮你|为你)?(分析|解答|处理|说明|整理)(一下)?[：:，,。！!\s]*/,
  /^(好的|好)[，,]\s*(我来|我可以|我会)?(帮你|为你)?(分析|解答|处理|说明|整理)(一下)?[：:，,。！!\s]*/,
  /^作为[^，,。.!！]*?(AI|助手|模型)[，,。.!！\s]*/i,
];

const STANDALONE_ASSISTANT_LINES = [
  /^(以下|下面)(是|为).*(建议|回复|内容|分析)[:：。！!]?$/,
  /^我会尽量.*$/,
  /^我将.*$/,
];

const TRAILING_ASSISTANT_PHRASES = [
  /希望(这|以上|这些).{0,20}(有帮助|帮到你)[。.!！]?$/u,
  /如果.{0,18}(还有|需要|想).{0,24}(告诉我|跟我说|随时说)[。.!！]?$/u,
];

function dropAssistantWrapperLines(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !STANDALONE_ASSISTANT_LINES.some((re) => re.test(line)))
    .join("\n");
}

/** Final pass before WeChat send: remove common assistant-shaped wrappers. */
export function humanizeReplyText(text: string): string {
  let out = dropAssistantWrapperLines(text);

  let changed = true;
  while (changed) {
    const before = out;
    for (const re of LEADING_ASSISTANT_PHRASES) {
      out = out.replace(re, "");
    }
    changed = out !== before;
  }

  out = out.replace(/^\s*\d+[.)、]\s+/gm, "");
  out = out.replace(/^\s*[一二三四五六七八九十]+[、.)]\s+/gm, "");

  for (const re of TRAILING_ASSISTANT_PHRASES) {
    out = out.replace(re, "");
  }

  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
