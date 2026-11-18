import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createController } from "../client/controller";
import { defaults } from "../shared/settings";
import { deferred, fixture, settle } from "./dom";

let dom: ReturnType<typeof fixture>;
let controllers: ReturnType<typeof createController>[];
beforeEach(() => { dom = fixture(); controllers = []; });
afterEach(() => { controllers.forEach((c) => c.dispose()); dom.close(); });
function controller(rpc: (contract: any, input: any) => Promise<any>) {
  const c = createController({ rpc } as any);
  controllers.push(c);
  return c;
}
const ready = (revision = "r1", values = defaults()) => ({ status: "ready", revision, values });

test("saves with a revision and stable host profile, and does not overwrite a conflict", async () => {
  const writes: any[] = [];
  let conflict = false;
  const c = controller(async (contract, input) => {
    if (contract.name.endsWith(".read")) return ready();
    writes.push(input);
    return conflict ? { status: "conflict", error: "Settings changed elsewhere" } : { status: "saved", revision: "r2", values: input.values };
  });
  await settle(0);
  assert.equal(await c.save({ ...c.snapshot().values, enabled: true }, "r1"), true);
  assert.equal(writes[0].revision, "r1");
  assert.ok(writes[0].values.profileId);
  conflict = true;
  assert.equal(await c.save({ ...c.snapshot().values, imageOpacity: 0.3 }, "r1"), false);
  assert.equal(c.snapshot().values.imageOpacity, 0.65);
  assert.equal(c.snapshot().revision, "r2");
  assert.equal(c.snapshot().error, "Settings changed elsewhere");
});

test("invalid stored settings retain their revision so defaults can repair them", async () => {
  let sentRevision = "";
  const c = controller(async (contract, input) => {
    if (contract.name.endsWith(".read")) return { status: "invalid", revision: "corrupt-file", error: "Invalid configuration" };
    sentRevision = input.revision;
    return { status: "saved", revision: "repaired", values: input.values };
  });
  await settle(0);
  assert.equal(c.snapshot().loading, false);
  assert.equal(c.snapshot().revision, "corrupt-file");
  assert.equal(await c.save({ ...defaults(), enabled: true }, c.snapshot().revision), true);
  assert.equal(sentRevision, "corrupt-file");
});

test("a slow read cannot replace the result of a newer write", async () => {
  let reads = 0;
  const slow = deferred<any>();
  const c = controller(async (contract, input) => {
    if (contract.name.endsWith(".read")) return ++reads === 1 ? ready() : slow.promise;
    return { status: "saved", revision: "new", values: input.values };
  });
  await settle(0);
  const reading = c.refresh();
  await c.save({ ...defaults(), imageOpacity: 0.2 }, "r1");
  slow.resolve(ready("old"));
  await reading;
  assert.equal(c.snapshot().revision, "new");
  assert.equal(c.snapshot().values.imageOpacity, 0.2);
});

test("unmounting a preview restores saved settings and unrelated preview tokens cannot cancel it", async () => {
  const c = controller(async () => ready("r1", { ...defaults(), enabled: true, profileId: "test" }));
  await settle();
  const saved = dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src");
  const token = Symbol();
  c.preview(token, { ...c.snapshot().values, source: { kind: "preset", id: "night" } });
  await settle();
  c.cancelPreview(Symbol());
  assert.notEqual(dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src"), saved);
  c.cancelPreview(token);
  await settle();
  assert.equal(dom.document.querySelector("#paseo-background-layer img")!.getAttribute("src"), saved);
});

test("a write completing after plugin disposal cannot recreate DOM or subscriptions", async () => {
  const writing = deferred<any>();
  const c = controller(async (contract) => contract.name.endsWith(".read") ? ready() : writing.promise);
  await settle(0);
  const saving = c.save({ ...defaults(), enabled: true }, "r1");
  c.dispose();
  writing.resolve({ status: "saved", revision: "r2", values: { ...defaults(), enabled: true } });
  assert.equal(await saving, false);
  await settle();
  assert.equal(dom.document.getElementById("paseo-background-layer"), null);
});
