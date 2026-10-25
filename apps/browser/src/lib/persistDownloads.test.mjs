import assert from "node:assert/strict";
import { test } from "node:test";
import { docs, removedStagings } from "@ardia/shell";
import { loadSession } from "./persist.ts";

test("a download left paused at quit gets its staging folder removed, and the record forgets it", () => {
  docs.set("session.json", JSON.stringify({ version: 2, windows: [], tabs: [] }));
  docs.set(
    "downloads.json",
    JSON.stringify({
      version: 1,
      downloads: [
        { id: "wk-download-1", url: "https://a/x", filename: "x", path: "/d/.ardia-download-1/x", state: "failed", paused: true, received: 1, total: 2, speed: 0, mimeType: "", profile: "", staging: "/d/.ardia-download-1" },
        { id: "wk-download-2", url: "https://a/y", filename: "y", path: "/d/y", state: "finished", paused: false, received: 2, total: 2, speed: 0, mimeType: "", profile: "", staging: null },
      ],
    }),
  );
  const data = loadSession();
  assert.deepEqual(removedStagings, ["/d/.ardia-download-1"]);
  assert.ok(data.downloads.every((d) => !("staging" in d)));
});
