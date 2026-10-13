import { createServer } from "node:http";
import { app } from "./app.js";
import { attachVoice } from "./voice.js";
import { config, store } from "@saygo/db";
const server = createServer(app),
  voices = attachVoice(server);
server.listen(config.SAYGO_RUNTIME_PORT, "127.0.0.1", () =>
  console.log(
    `SayGo runtime: http://localhost:${config.SAYGO_RUNTIME_PORT} (POS sandbox; voice ${config.SAYGO_VOICE_ENABLED})`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const ws of voices.clients) ws.close();
    voices.close();
    server.close(() => {
      void store.close();
    });
  });
