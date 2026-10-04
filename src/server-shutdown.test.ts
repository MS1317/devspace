import assert from "node:assert/strict";
import { shutdownHttpServer } from "./server-shutdown.js";

let finishHttpClose: (() => void) | undefined;
let applicationCloseStarted = false;

const drainingHttpServer = {
  close(callback: (error?: Error) => void) {
    finishHttpClose = () => callback();
  },
};

const drainingShutdown = shutdownHttpServer(drainingHttpServer, async () => {
  applicationCloseStarted = true;
  assert.ok(
    finishHttpClose,
    "HTTP draining must start before application cleanup",
  );
  finishHttpClose();
});

await Promise.resolve();
assert.equal(
  applicationCloseStarted,
  true,
  "application cleanup must start while the HTTP server is draining",
);
await drainingShutdown;

let idleCloseCalls = 0;
let finishIdleAwareHttpClose: (() => void) | undefined;
const idleAwareShutdown = shutdownHttpServer(
  {
    close(callback: (error?: Error) => void) {
      finishIdleAwareHttpClose = () => callback();
    },
    closeIdleConnections() {
      idleCloseCalls += 1;
    },
  },
  async () => {
    assert.equal(idleCloseCalls, 1, "idle connections close when draining starts");
    finishIdleAwareHttpClose?.();
  },
);
await idleAwareShutdown;
assert.equal(idleCloseCalls, 2, "idle connections close again after application cleanup");

let forcedCloseCalls = 0;
let finishForcedHttpClose: (() => void) | undefined;
await shutdownHttpServer(
  {
    close(callback: (error?: Error) => void) {
      finishForcedHttpClose = () => callback();
    },
    closeIdleConnections() {},
    closeAllConnections() {
      forcedCloseCalls += 1;
      finishForcedHttpClose?.();
    },
  },
  async () => {},
  { drainTimeoutMs: 10 },
);
assert.equal(forcedCloseCalls, 1, "a stuck active connection is forced closed only after the drain timeout");

let unnecessaryForceCloseCalls = 0;
await shutdownHttpServer(
  {
    close(callback: (error?: Error) => void) {
      callback();
    },
    closeIdleConnections() {},
    closeAllConnections() {
      unnecessaryForceCloseCalls += 1;
    },
  },
  async () => {},
  { drainTimeoutMs: 10 },
);
assert.equal(unnecessaryForceCloseCalls, 0, "normally drained connections are never force closed");

let finishApplicationClose: (() => void) | undefined;
let shutdownResolved = false;

const immediatelyClosedHttpServer = {
  close(callback: (error?: Error) => void) {
    callback();
  },
};

const delayedApplicationClose = () =>
  new Promise<void>((resolve) => {
    finishApplicationClose = resolve;
  });

const delayedShutdown = shutdownHttpServer(
  immediatelyClosedHttpServer,
  delayedApplicationClose,
);
void delayedShutdown.then(() => {
  shutdownResolved = true;
});

await Promise.resolve();
assert.equal(
  shutdownResolved,
  false,
  "shutdown must wait for asynchronous application cleanup",
);
finishApplicationClose?.();
await delayedShutdown;
assert.equal(shutdownResolved, true);

let finishDelayedHttpClose: (() => void) | undefined;
let httpDrainResolved = false;
const delayedHttpDrain = shutdownHttpServer(
  {
    close(callback: (error?: Error) => void) {
      finishDelayedHttpClose = () => callback();
    },
  },
  async () => {},
);
void delayedHttpDrain.then(() => {
  httpDrainResolved = true;
});

await Promise.resolve();
assert.equal(
  httpDrainResolved,
  false,
  "shutdown must wait for active HTTP responses to drain",
);
finishDelayedHttpClose?.();
await delayedHttpDrain;
assert.equal(httpDrainResolved, true);

const httpCloseError = new Error("http close failed");
await assert.rejects(
  shutdownHttpServer(
    {
      close(callback: (error?: Error) => void) {
        callback(httpCloseError);
      },
    },
    async () => {},
  ),
  httpCloseError,
);
