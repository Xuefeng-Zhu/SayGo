/* global URL, fetch, console */
import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const directory = fileURLToPath(
  new URL("../.local/dynamodb/", import.meta.url),
);
const url =
  "https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.tar.gz";
const run = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
await mkdir(directory, { recursive: true });
try {
  await readFile(directory + "DynamoDBLocal.jar");
} catch {
  await run("curl", [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    url,
    "--output",
    directory + "download.tar.gz",
  ]);
  const checksum = await (await fetch(url + ".sha256")).text();
  const actual = createHash("sha256")
    .update(await readFile(directory + "download.tar.gz"))
    .digest("hex");
  if (!checksum.includes(actual))
    throw new Error("DynamoDB Local checksum mismatch");
  await run("tar", ["-xzf", directory + "download.tar.gz", "-C", directory]);
}
const child = spawn(
  "java",
  [
    "-Djava.library.path=" + directory + "DynamoDBLocal_lib",
    "-jar",
    directory + "DynamoDBLocal.jar",
    "-sharedDb",
    "-dbPath",
    directory,
    "-port",
    "8000",
    "-disableTelemetry",
  ],
  { stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
