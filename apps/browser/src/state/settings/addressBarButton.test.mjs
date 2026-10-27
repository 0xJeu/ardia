import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS } from "./settings.ts";
import { SYNCED_SETTINGS } from "../sync/settingsAdapter.ts";

test("the address bar button defaults to Bookmark and syncs", () => {
  assert.equal(DEFAULT_SETTINGS.addressBarButton, "bookmark");
  assert.ok(SYNCED_SETTINGS.includes("addressBarButton"));
});
