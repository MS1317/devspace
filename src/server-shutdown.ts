export interface ClosableHttpServer {
  close(callback: (error?: Error) => void): void;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
}

export const DEVSPACE_HTTP_DRAIN_TIMEOUT_MS = 30_000;

export interface ShutdownHttpServerOptions {
  drainTimeoutMs?: number;
}

export async function shutdownHttpServer(
  httpServer: ClosableHttpServer,
  closeApplication: () => Promise<void>,
  options: ShutdownHttpServerOptions = {},
): Promise<void> {
  const httpClosed = new Promise<void>((resolve, reject) => {
    httpServer.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  httpServer.closeIdleConnections?.();

  await closeApplication();
  httpServer.closeIdleConnections?.();

  const drainTimeoutMs = options.drainTimeoutMs ?? DEVSPACE_HTTP_DRAIN_TIMEOUT_MS;
  if (!httpServer.closeAllConnections || drainTimeoutMs < 0) {
    await httpClosed;
    return;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const drainTimedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), drainTimeoutMs);
  });

  try {
    const outcome = await Promise.race([
      httpClosed.then(() => "closed" as const),
      drainTimedOut,
    ]);
    if (outcome === "timeout") {
      httpServer.closeAllConnections();
      await httpClosed;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
