import { Client } from "pg";

(async () => {
  try {
    const url = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL or DIRECT_DATABASE_URL required");
    const u = new URL(url);
    u.pathname = "/postgres";
    const client = new Client({ connectionString: u.toString() });
    const r = await client.query(
      "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
    );
    await client.end();
    console.log("Databases on this server:");
    r.rows.forEach((row) => console.log("  -", row.datname));
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
