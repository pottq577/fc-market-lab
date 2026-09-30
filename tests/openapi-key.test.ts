import assert from "node:assert/strict";
import test from "node:test";

import { normalizeNexonOpenApiKey } from "../src/collect/openapi-key.ts";

test("normalizes surrounding whitespace in the Nexon Open API key", () => {
  assert.equal(normalizeNexonOpenApiKey("  test-key  "), "test-key");
});

test("rejects an empty Nexon Open API key", () => {
  assert.throws(
    () => normalizeNexonOpenApiKey("   "),
    /NEXON_OPEN_API_KEY environment variable is required/,
  );
});

test("rejects a Nexon Open API key that cannot be used as an HTTP header", () => {
  const invalidKey = `${String.fromCodePoint(45320)}placeholder`;

  assert.throws(
    () => normalizeNexonOpenApiKey(invalidKey),
    (error: unknown) => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /valid HTTP header value/);
      assert.match(error.message, /placeholder text or non-ASCII characters/);
      return true;
    },
  );
});
