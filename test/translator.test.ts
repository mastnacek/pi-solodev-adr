import test from "node:test";
import assert from "node:assert/strict";
import {
  LITERAL_TRANSLATION_SYSTEM_PROMPT,
  parseTranslationPayload,
} from "../src/translator.js";

test("parseTranslationPayload parses valid JSON string", () => {
  const jsonStr = JSON.stringify({
    title: "Publikovat na GitHub",
    context: "Potřeba reprodukovatelné distribuce.",
    decision: "Použít git package zdroj.",
    consequences: "Snadná instalace.",
  });

  const parsed = parseTranslationPayload(jsonStr);
  assert.ok(parsed);
  assert.equal(parsed?.title, "Publikovat na GitHub");
  assert.equal(parsed?.context, "Potřeba reprodukovatelné distribuce.");
  assert.equal(parsed?.decision, "Použít git package zdroj.");
  assert.equal(parsed?.consequences, "Snadná instalace.");
});

test("parseTranslationPayload handles markdown code blocks", () => {
  const mdJson = `\`\`\`json
{
  "title": "Publikovat na GitHub",
  "context": "Kontext bez změn.",
  "decision": "Rozhodnutí.",
  "consequences": "Důsledky."
}
\`\`\``;

  const parsed = parseTranslationPayload(mdJson);
  assert.ok(parsed);
  assert.equal(parsed?.title, "Publikovat na GitHub");
});

test("parseTranslationPayload rejects malformed data", () => {
  assert.equal(parseTranslationPayload("invalid json"), null);
  assert.equal(parseTranslationPayload("{}"), null);
});

test("LITERAL_TRANSLATION_SYSTEM_PROMPT enforces strict literal translation", () => {
  assert.ok(
    LITERAL_TRANSLATION_SYSTEM_PROMPT.includes(
      "strict, faithful, literal translator",
    ),
  );
  assert.ok(
    LITERAL_TRANSLATION_SYSTEM_PROMPT.includes(
      "Do not improve, embellish, explain, summarize",
    ),
  );
  assert.ok(LITERAL_TRANSLATION_SYSTEM_PROMPT.includes("Czech"));
});
