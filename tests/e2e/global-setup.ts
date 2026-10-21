import type { FullConfig } from "@playwright/test";

export default async function prepareLocalPages(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error("Browser QA needs its local base URL.");
  const origin = new URL(baseURL);
  if (
    origin.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(origin.hostname)
  )
    throw new Error("Browser QA page preparation is restricted to localhost.");
  // Next development mode may reload open pages while compiling a new route.
  // Prepare every used route before browser contexts hold transient UI state.
  await Promise.all(
    ["/lane/lane-1", "/admin", "/crew", "/kitchen"].map(async (path) => {
      const response = await fetch(new URL(path, origin), {
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok)
        throw new Error(`Unable to prepare local page ${path}.`);
      await response.text();
    }),
  );
}
