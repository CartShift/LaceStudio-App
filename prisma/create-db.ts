import { Client } from "pg";

const url = process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("DATABASE_URL or DIRECT_DATABASE_URL required");

const u = new URL(url);
const dbName = u.pathname.slice(1) || "lacestudio";
u.pathname = "/postgres";

const client = new Client({ connectionString: u.toString() });
client.connect().then(() =>
  client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`).then(
    () => {
      console.log(`Database "${dbName}" created.`);
      return client.end();
    },
    (err: { code?: string }) => {
      if (err.code === "42P04") {
        console.log(`Database "${dbName}" already exists.`);
        return client.end();
      }
      return client.end().then(() => {
        throw err;
      });
    }
  )
);
