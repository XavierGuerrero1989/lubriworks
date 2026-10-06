import { createServer } from "node:http";
import { createServer as viteServer, loadEnv } from "vite";
Object.assign(process.env, loadEnv("development", process.cwd(), ""));
const { default: rpc } = await import("../server/rpc");
const { default: reminders } = await import("../server/reminders");
const server = createServer((req, res) => {
  if (req.url === "/api/rpc") void rpc(req, res);
  else if (req.url === "/api/reminders") void reminders(req, res);
  else {
    res.statusCode = 404;
    res.end("Not found");
  }
});
server.listen(5181, "127.0.0.1");
const vite = await viteServer();
await vite.listen();
vite.printUrls();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    server.close();
    await vite.close();
    process.exit(0);
  });
