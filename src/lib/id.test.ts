import assert from "node:assert/strict";
import { test } from "node:test";
import { newId } from "./id";

test("creates unique version 4 operation IDs without the secure-context randomUUID API", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues: globalThis.crypto.getRandomValues.bind(
        globalThis.crypto,
      ),
    },
  });
  try {
    const ids = Array.from({ length: 100 }, () => newId());
    assert.equal(new Set(ids).size, 100);
    for (const id of ids)
      assert.match(
        id,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
  }
});
