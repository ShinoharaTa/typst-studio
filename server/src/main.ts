import { buildApp } from "./app.js";
import { assertBindAllowed } from "./bind.js";
import { loadHostConfig } from "./config.js";
import { selectDriver } from "./limits/index.js";

const host = loadHostConfig();
assertBindAllowed(host.server.bind, host.container);
const driver = await selectDriver(host.limits);
const { app, preview } = buildApp(host, driver);

const CAPABILITY_LABEL = { strict: "厳密", watchdog: "見張り", none: "無し" } as const;
app.log.info(
  `process limit driver: ${driver.name} (${CAPABILITY_LABEL[driver.capability]} / ${driver.capability})`,
);
if (driver.capability === "none") app.log.warn('limits.driver = "none": no process limits (development only)');
if (host.auth.mode === "none") app.log.warn('auth.mode = "none": no authentication (development only)');
else app.log.info({ allowUsers: host.auth.allowUsers.length, allowedOrigins: host.server.allowedOrigins }, "auth: tailscale");
app.log.info({ home: host.home, dist: host.dist, container: host.container }, "paths");

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  await preview.stop("shutdown");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: host.server.bind, port: host.server.port });
