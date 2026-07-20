// Ito ang tanging bahagi ng app na "nakikipag-usap" sa Turso.
// Tumatakbo ito sa server (Vercel), kaya hindi kailanman makikita ng
// sinuman sa browser ang TURSO_DATABASE_URL o TURSO_AUTH_TOKEN.
//
// Bago pumasok sa Turso, ineeksamin muna nito ang Google sign-in
// (Firebase ID token) na ipinadala ng app — kung walang valid na
// token, tatanggihan ang request.

import { createClient } from "@libsql/client";
import { jwtVerify, createRemoteJWKSet } from "jose";

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const ALLOWED_EMAIL_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "";

const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com")
);

const turso = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

let tableReady = null;
async function ensureTable() {
  if (!tableReady) {
    tableReady = turso.execute(`
      CREATE TABLE IF NOT EXISTS talaan_data (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
  }
  await tableReady;
}

async function verifyUser(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) throw new Error("Missing token");
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });
  if (ALLOWED_EMAIL_DOMAIN && !(payload.email || "").endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
    throw new Error("Email domain not allowed");
  }
  return payload;
}

export default async function handler(req, res) {
  let user;
  try {
    user = await verifyUser(req);
  } catch (e) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await ensureTable();

    if (req.method === "GET") {
      const result = await turso.execute("SELECT key, value FROM talaan_data");
      const data = {};
      for (const row of result.rows) data[row.key] = row.value;
      res.status(200).json(data);
      return;
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const { key, value } = body || {};
      if (!key) {
        res.status(400).json({ error: "Missing key" });
        return;
      }
      await turso.execute({
        sql: `INSERT INTO talaan_data (key, value, updated_at) VALUES (?, ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        args: [key, JSON.stringify(value)],
      });
      res.status(200).json({ ok: true, by: user.email });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
}
