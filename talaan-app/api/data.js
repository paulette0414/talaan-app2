// Ito ang tanging bahagi ng app na "nakikipag-usap" sa Turso.
// Tumatakbo ito sa server (Vercel), kaya hindi kailanman makikita ng
// sinuman sa browser ang TURSO_DATABASE_URL o TURSO_AUTH_TOKEN.
//
// Bago pumasok sa Turso, ineeksamin muna nito ang Google sign-in
// (Firebase ID token) na ipinadala ng app — kung walang valid na
// token, tatanggihan ang request.
//
// ACCESS CONTROL: ang mga "class-scoped" na key (talaan:classes,
// talaan:grades, talaan:attendance, talaan:mps, talaan:collections)
// ay sinasala DITO SA SERVER base sa ownerEmail / coTeacherEmails ng
// bawat klase — hindi lang sa itsura ng app. Ang talaan:learners,
// talaan:behavior, talaan:schoolinfo, talaan:corevalues, at
// talaan:sf9meta ay nananatiling shared sa lahat ng naka-login
// (karaniwang common roster/info ng buong paaralan).

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

const CLASS_ID_KEYED_KEYS = ["talaan:grades", "talaan:attendance", "talaan:mps", "talaan:collections"];
const CLASSES_KEY = "talaan:classes";

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

function canAccessClass(cls, email) {
  if (!cls) return false;
  if (cls.ownerEmail === email) return true;
  return Array.isArray(cls.coTeacherEmails) && cls.coTeacherEmails.includes(email);
}

async function getRow(key) {
  const result = await turso.execute({ sql: "SELECT value FROM talaan_data WHERE key = ?", args: [key] });
  return result.rows[0] ? result.rows[0].value : null;
}
async function putRow(key, value) {
  await turso.execute({
    sql: `INSERT INTO talaan_data (key, value, updated_at) VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, JSON.stringify(value)],
  });
}

export default async function handler(req, res) {
  let user;
  try {
    user = await verifyUser(req);
  } catch (e) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const email = user.email;

  try {
    await ensureTable();

    if (req.method === "GET") {
      const result = await turso.execute("SELECT key, value FROM talaan_data");
      const data = {};
      for (const row of result.rows) data[row.key] = row.value;

      const allClasses = data[CLASSES_KEY] ? JSON.parse(data[CLASSES_KEY]) : [];
      const visibleClasses = allClasses.filter((c) => canAccessClass(c, email));
      const visibleIds = new Set(visibleClasses.map((c) => c.id));
      data[CLASSES_KEY] = JSON.stringify(visibleClasses);

      for (const key of CLASS_ID_KEYED_KEYS) {
        if (!data[key]) continue;
        const obj = JSON.parse(data[key]);
        const filtered = {};
        for (const classId of Object.keys(obj)) {
          if (visibleIds.has(classId)) filtered[classId] = obj[classId];
        }
        data[key] = JSON.stringify(filtered);
      }

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

      if (key === CLASSES_KEY) {
        const existingRaw = await getRow(CLASSES_KEY);
        const existing = existingRaw ? JSON.parse(existingRaw) : [];
        const existingMap = new Map(existing.map((c) => [c.id, c]));

        // Classes this user has no rights over stay exactly as they are.
        const untouched = existing.filter((c) => !canAccessClass(c, email));

        // Only accept incoming classes the user is actually allowed to write.
        const incoming = Array.isArray(value) ? value : [];
        const mine = incoming
          .map((c) => {
            const prev = existingMap.get(c.id);
            if (prev) {
              if (!canAccessClass(prev, email)) return null; // can't hijack someone else's class
              return { ...c, ownerEmail: prev.ownerEmail }; // ownership can't change via edit
            }
            return { ...c, ownerEmail: email }; // brand-new class: requester becomes owner
          })
          .filter(Boolean);

        await putRow(CLASSES_KEY, [...untouched, ...mine]);
        res.status(200).json({ ok: true });
        return;
      }

      if (CLASS_ID_KEYED_KEYS.includes(key)) {
        const classesRaw = await getRow(CLASSES_KEY);
        const classes = classesRaw ? JSON.parse(classesRaw) : [];
        const classById = new Map(classes.map((c) => [c.id, c]));
        const authorized = (classId) => canAccessClass(classById.get(classId), email);

        const existingRaw = await getRow(key);
        const existingObj = existingRaw ? JSON.parse(existingRaw) : {};
        const incomingObj = value && typeof value === "object" ? value : {};

        const finalObj = {};
        for (const classId of Object.keys(existingObj)) {
          if (!authorized(classId)) finalObj[classId] = existingObj[classId]; // not yours, untouched
        }
        for (const classId of Object.keys(incomingObj)) {
          if (authorized(classId)) finalObj[classId] = incomingObj[classId]; // yours, take the new value
        }

        await putRow(key, finalObj);
        res.status(200).json({ ok: true });
        return;
      }

      // Shared/global keys (learners, behavior, schoolinfo, corevalues, sf9meta, lastteacher)
      await putRow(key, value);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
}
