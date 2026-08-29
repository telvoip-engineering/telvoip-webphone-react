import { createServer } from "node:http";

const port = 4177;
const server = createServer((_request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Permissions-Policy": "microphone=(self)",
  });
  response.end("<!doctype html><html><body><main>WebRTC browser fixture</main></body></html>");
});

server.listen(port, "127.0.0.1");

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
