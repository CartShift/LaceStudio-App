import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type EnvOverrides = Record<string, string | undefined>;

function run(exe: string, args: string[], env: EnvOverrides = {}): Promise<void> {
  const quoted = exe.includes(" ") ? `"${exe}"` : exe;
  return new Promise((resolve, reject) => {
    const proc = spawn(quoted, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: true,
    });
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
  });
}

(async () => {
  const sourceDb = process.env.SOURCE_DB;
  if (!sourceDb) throw new Error("SOURCE_DB env required (e.g. SOURCE_DB=postgres or your previous DB name)");

  const url = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL or DIRECT_DATABASE_URL required");

  const u = new URL(url);
  const targetDb = u.pathname.slice(1) || "lacestudio";
  const host = u.hostname;
  const port = u.port || "5432";
  const user = u.username || "postgres";
  const password = u.password;

  const pgBin = process.env.PG_BIN ?? "C:\\Program Files\\PostgreSQL\\17\\bin";
  const pgDump = join(pgBin, "pg_dump.exe");
  const pgRestore = join(pgBin, "pg_restore.exe");

  const dir = await mkdtemp(join(tmpdir(), "pg-copy-"));
  const dumpPath = join(dir, "data.dump");

  try {
    console.log(`Dumping data from database "${sourceDb}"...`);
    await run(pgDump, [
      "-h", host, "-p", port, "-U", user, "-d", sourceDb,
      "--data-only", "-Fc", "-f", dumpPath,
    ], password ? { PGPASSWORD: password } : {});

    console.log(`Restoring data into "${targetDb}" (triggers disabled for FKs)...`);
    await run(pgRestore, [
      "-h", host, "-p", port, "-U", user, "-d", targetDb,
      "--data-only", "--disable-triggers", "--no-owner", "--no-privileges",
      dumpPath,
    ], password ? { PGPASSWORD: password } : {});

    console.log("Done. Data copied into", targetDb);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
})();
