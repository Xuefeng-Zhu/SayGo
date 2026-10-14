import { config as loadEnvironment } from "dotenv";
import { fileURLToPath, URL } from "node:url";
loadEnvironment({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
});
const qaPort = process.env.SAYGO_QA_WEB_PORT;
if (qaPort && (!/^\d+$/.test(qaPort) || +qaPort < 1024 || +qaPort > 65535))
  throw new Error("SAYGO_QA_WEB_PORT must be a valid non-privileged port.");
const config = {
  ...(qaPort ? { distDir: `.next-qa-${qaPort}` } : {}),
  transpilePackages: ["@saygo/contracts"],
  poweredByHeader: false,
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://127.0.0.1:${process.env.SAYGO_RUNTIME_PORT || 3101}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(self)",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
