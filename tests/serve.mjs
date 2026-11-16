import { startServer } from "./static-server.mjs";

const server = await startServer();
console.log("本地静态站点已在 127.0.0.1 上监听。按 Ctrl+C 结束。");
console.log(server.origin + "/pulse-whoop/");
console.log(server.origin + "/pulse-whoop/privacy/");
console.log(server.origin + "/pulse-whoop/callback/");
console.log(server.origin + "/tests/manual-initiator.html");
