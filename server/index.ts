import { createApplication } from "./app";
const application = createApplication({
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(","),
  rewrittenOrigins: process.env.REWRITTEN_ORIGINS?.split(","),
});
const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 3001);
application.server.listen(port, host, () =>
  console.log(`Word Atlas API: http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(
    signal,
    () => void application.close().then(() => process.exit(0)),
  );
