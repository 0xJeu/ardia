import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "srvx";
import { staticMiddleware } from "srvx/static";
import start from "./dist/server/server.js";

const clientDir = fileURLToPath(new URL("./dist/client/", import.meta.url));
const shell = readFileSync(new URL("./dist/client/_shell.html", import.meta.url));

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow",
};

function withHeaders(response, extra) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries({ ...SECURITY_HEADERS, ...extra })) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const staticFiles = staticMiddleware({ dir: clientDir });

serve({
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
  middleware: [
    async (request, next) => {
      const { pathname } = new URL(request.url);
      if (pathname.startsWith("/_serverFn/")) return withHeaders(await start.fetch(request), {});
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: SECURITY_HEADERS });
      if (pathname === "/_shell.html") return next();
      const response = await staticFiles(request, next);
      if (pathname.startsWith("/assets/") && response.ok) return withHeaders(response, { "Cache-Control": "public, max-age=31536000, immutable" });
      return response.headers.get("Content-Type")?.startsWith("text/html") ? response : withHeaders(response, {});
    },
  ],
  fetch: () =>
    new Response(shell, {
      headers: { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
    }),
});
