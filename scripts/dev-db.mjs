// Local development Postgres without Docker. Data lives in .devdb/ (git-ignored).
// Usage: npm run db:dev   -> postgres://postgres:devpass@localhost:54329/nascon
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const dir = "./.devdb";
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "postgres",
  password: "devpass",
  port: 54329,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (!existsSync(dir)) await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("nascon");
} catch {
  // already exists
}
console.log("Dev Postgres running: postgres://postgres:devpass@localhost:54329/nascon");
const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
