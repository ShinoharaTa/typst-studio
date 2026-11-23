import net from "node:net";

// ループバック以外への bind は TYPST_STUDIO_CONTAINER=1 のときだけ許す（spec 7.1 / 10.3）
export function isLoopbackHost(host: string): boolean {
  if (host === "localhost") return true;
  if (net.isIPv4(host)) return host.split(".")[0] === "127";
  if (net.isIPv6(host)) return host === "::1" || host === "0:0:0:0:0:0:0:1";
  return false;
}

export function assertBindAllowed(host: string, container: boolean): void {
  if (isLoopbackHost(host)) return;
  if (container) return;
  throw new Error(
    `server.bind = "${host}" is not a loopback address. ` +
      `Non-loopback bind is allowed only when TYPST_STUDIO_CONTAINER=1`,
  );
}
