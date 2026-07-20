import React, { useEffect, useMemo, useState } from "react";
import { auth, googleProvider, ALLOWED_EMAIL_DOMAIN } from "./firebase";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";

/* ============================================================
   TALAAN — Class Record & Learner Management Suite
   A DepEd-aligned class record, attendance, SF9, MPS,
   anecdotal record, and collections tool.

   DATA & SHARING NOTES
   - Data lives in a Turso (SQLite) database, reached only through
     the /api/data serverless function — the browser never talks to
     Turso directly, so the database credentials stay on the server.
   - Every request to /api/data must carry a valid Google sign-in
     token; the server checks it before reading or writing. That's
     what makes "share this class with a co-teacher" work: anyone
     signed in (optionally restricted to your school's email domain,
     see src/firebase.js) sees and edits the same records.
   - There's no per-teacher permission model yet — anyone who can
     sign in can edit any class. Treat it as a trusted staffroom
     tool unless you add finer-grained rules later.
   ============================================================ */

const INK = "#EDEAF7";
const PAPER = "#0d0a1f";
const PANEL = "#17102e";
const CARD_BG = "#1c1440";
const FOREST = "#7C6DF2";
const FOREST_DK = "#2a1a63";
const GARNET = "#FF6B81";
const GOLD = "#E3B341";
const LINE = "rgba(255,255,255,0.14)";
const MUTED = "rgba(237,234,247,0.58)";

const uid = () => Math.random().toString(36).slice(2, 10);

const WEIGHT_PRESETS = {
  language: { WW: 30, PT: 50, QA: 20, label: "Languages / AP / EsP (30-50-20)" },
  mathsci: { WW: 40, PT: 40, QA: 20, label: "Math / Science (40-40-20)" },
  mapeh: { WW: 20, PT: 60, QA: 20, label: "MAPEH / EPP-TLE / Arts (20-60-20)" },
  custom: { WW: 30, PT: 50, QA: 20, label: "Custom weights" },
};

const TERM_SETS = {
  quarter: ["Q1", "Q2", "Q3", "Q4"],
  trimester: ["T1", "T2", "T3"],
  semester: ["S1", "S2"],
};

const TAG_DEFS = [
  { key: "fourPs", label: "4Ps", color: "#7C2233" },
  { key: "ip", label: "Indigenous Peoples", color: "#5C3A21" },
  { key: "aral", label: "ARAL Program", color: "#20402C" },
  { key: "feeding", label: "Feeding Program", color: "#B8912E" },
  { key: "deworm", label: "Dewormed (current cycle)", color: "#2D5D7B" },
];

const DEFAULT_CORE_VALUES = [
  { key: "makadiyos", title: "Maka-Diyos", statements: ["Expresses spiritual beliefs while respecting the spiritual beliefs of others", "Shows adherence to ethical principles by upholding truth"] },
  { key: "makatao", title: "Makatao", statements: ["Is sensitive to individual, social, and cultural differences", "Demonstrates contributions toward solidarity"] },
  { key: "makakalikasan", title: "Makakalikasan", statements: ["Cares for the environment and utilizes resources wisely, judiciously, and economically"] },
  { key: "makabansa", title: "Makabansa", statements: ["Demonstrates pride in being a Filipino; exercises the rights and responsibilities of a Filipino citizen"] },
];
const RATING_SCALE = ["AO", "SO", "RO", "NO"]; // Always/Sometimes/Rarely/Never Observed

const DEFAULT_SCHOOL_INFO = { schoolName: "", schoolId: "", district: "", division: "", region: "", schoolYear: "" };

function transmute(ig) {
  const g = Math.max(0, Math.min(100, ig));
  const tg = g >= 60 ? 75 + (g - 60) * 0.625 : 60 + g * (14.99 / 59.99);
  return Math.round(tg);
}
function descriptor(tg) {
  if (tg >= 90) return "Outstanding";
  if (tg >= 85) return "Very Satisfactory";
  if (tg >= 80) return "Satisfactory";
  if (tg >= 75) return "Fairly Satisfactory";
  return "Did Not Meet Expectations";
}
function mpsLevel(mps) {
  if (mps >= 96) return "Mastery";
  if (mps >= 86) return "Closely Approximates Mastery";
  if (mps >= 66) return "Moving Towards Mastery";
  if (mps >= 35) return "Average Mastery";
  if (mps >= 15) return "Low Mastery";
  if (mps >= 5) return "Very Low Mastery";
  return "Absolute No Mastery";
}
const pct = (num, den) => (den > 0 ? (num / den) * 100 : 0);
const round1 = (n) => Math.round(n * 10) / 10;

async function apiFetch(path, options = {}) {
  const user = auth.currentUser;
  const token = user ? await user.getIdToken() : null;
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
// One round trip that returns every saved key as { key: rawJsonString }.
async function loadAllData() {
  try {
    return await apiFetch("/api/data");
  } catch (e) {
    console.error("load failed", e);
    return {};
  }
}
async function saveKey(key, value) {
  try {
    await apiFetch("/api/data", { method: "POST", body: JSON.stringify({ key, value }) });
  } catch (e) {
    console.error("save failed", key, e);
  }
}

/* ---------- small UI atoms ---------- */
function Card({ children, style }) {
  return (
    <div
      style={{
        background: CARD_BG,
        border: `1px solid ${LINE}`,
        borderRadius: 4,
        boxShadow: "0 1px 0 rgba(0,0,0,0.03)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
      <span style={{ color: "rgba(237,234,247,0.58)", fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase", fontSize: 10 }}>
        {label}
      </span>
      {children}
    </label>
  );
}
const inputStyle = {
  border: `1px solid ${LINE}`,
  borderRadius: 3,
  padding: "6px 8px",
  fontSize: 13,
  background: CARD_BG,
  color: INK,
  fontFamily: "inherit",
};
function TIn(props) {
  return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function TSel(props) {
  return <select {...props} style={{ ...inputStyle, ...(props.style || {}) }} />;
}
function Btn({ children, onClick, kind = "primary", style, disabled, title }) {
  const palette = {
    primary: { bg: FOREST, fg: "#fff", bd: FOREST },
    ghost: { bg: "transparent", fg: FOREST, bd: LINE },
    danger: { bg: "transparent", fg: GARNET, bd: GARNET },
    gold: { bg: GOLD, fg: "#26210a", bd: GOLD },
  }[kind];
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.bd}`,
        borderRadius: 3,
        padding: "6px 12px",
        fontSize: 12.5,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
function Empty({ text }) {
  return (
    <div style={{ padding: "28px 16px", textAlign: "center", color: "rgba(237,234,247,0.58)", fontSize: 13, fontStyle: "italic" }}>
      {text}
    </div>
  );
}
function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ fontFamily: "Georgia, serif", fontSize: 20, color: FOREST, margin: 0 }}>{children}</h2>
      {sub && <div style={{ fontSize: 12.5, color: "rgba(237,234,247,0.58)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ============================================================ */

function TalaanApp({ user }) {
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [learners, setLearners] = useState([]);
  const [classes, setClasses] = useState([]);
  const [grades, setGrades] = useState({}); // classId -> learnerId -> term -> {WW:[],PT:[],QA:[]}
  const [attendance, setAttendance] = useState({}); // classId -> "YYYY-MM" -> learnerId -> {day:status}
  const [behavior, setBehavior] = useState({}); // learnerId -> [entries]
  const [collections, setCollections] = useState({}); // classId -> {items:[],payments:{}}
  const [mps, setMps] = useState({}); // classId -> [assessments]
  const [teacherName, setTeacherName] = useState("");
  const [schoolInfo, setSchoolInfo] = useState(DEFAULT_SCHOOL_INFO);
  const [coreValues, setCoreValues] = useState({}); // learnerId -> { statementKey: rating }
  const [sf9Meta, setSf9Meta] = useState({}); // learnerId -> { homeroomClassId, remarks }
  const [printDoc, setPrintDoc] = useState(null); // { type: 'sf2'|'sf9', ...payload }

  useEffect(() => {
    (async () => {
      const raw = await loadAllData();
      const get = (key, fallback) => (raw[key] !== undefined ? JSON.parse(raw[key]) : fallback);
      setLearners(get("talaan:learners", []));
      setClasses(get("talaan:classes", []));
      setGrades(get("talaan:grades", {}));
      setAttendance(get("talaan:attendance", {}));
      setBehavior(get("talaan:behavior", {}));
      setCollections(get("talaan:collections", {}));
      setMps(get("talaan:mps", {}));
      setTeacherName(get("talaan:lastteacher", "") || user?.displayName || "");
      setSchoolInfo({ ...DEFAULT_SCHOOL_INFO, ...get("talaan:schoolinfo", DEFAULT_SCHOOL_INFO) });
      setCoreValues(get("talaan:corevalues", {}));
      setSf9Meta(get("talaan:sf9meta", {}));
      setLoaded(true);
    })();
  }, []);

  useEffect(() => { if (loaded) saveKey("talaan:learners", learners); }, [learners, loaded]);
  useEffect(() => { if (loaded) saveKey("talaan:classes", classes); }, [classes, loaded]);
  useEffect(() => { if (loaded) saveKey("talaan:grades", grades); }, [grades, loaded]);
  useEffect(() => { if (loaded) saveKey("talaan:attendance", attendance); }, [attendance, loaded]);
  useEffect(() => { if (loaded) saveKey("talaan:behavior", behavior); }, [behavior, loaded]);
  useEffect(() => { if (loaded) saveKey("talaan:collections", collections); }, [collections, loaded]);
  useEffect(() => { if (loaded) saveKey("talaan:mps", mps); }, [mps, loaded]);
  useEffect(() => { if (loaded) saveKey("talaan:lastteacher", teacherName); }, [teacherName, loaded]);
  useEffect(() => { if (loaded) saveKey("talaan:schoolinfo", schoolInfo); }, [schoolInfo, loaded]);
  useEffect(() => { if (loaded) saveKey("talaan:corevalues", coreValues); }, [coreValues, loaded]);
  useEffect(() => { if (loaded) saveKey("talaan:sf9meta", sf9Meta); }, [sf9Meta, loaded]);

  const TABS = [
    ["dashboard", "Dashboard"],
    ["learners", "Learners"],
    ["classes", "Classes"],
    ["grades", "Grade Sheet"],
    ["attendance", "Attendance / SF2"],
    ["sf9", "SF9 Report Card"],
    ["mps", "MPS & Results"],
    ["behavior", "Anecdotal Record"],
    ["collections", "Collections"],
  ];

  if (!loaded) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: PAPER, fontFamily: "Georgia, serif", color: FOREST }}>
        Opening Talaan…
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: PAPER, color: INK, fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      {/* header */}
      <div style={{ background: `linear-gradient(180deg, ${FOREST} 0%, ${FOREST_DK} 100%)`, color: "#EDEAF7", padding: "16px 20px", borderBottom: `3px solid ${GOLD}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "Georgia, serif", fontSize: 26, letterSpacing: 0.5 }}>Talaan</span>
            <span style={{ fontSize: 12, opacity: 0.75 }}>Class Record & Learner Management Suite</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, opacity: 0.8 }}>Display name</span>
              <TIn
                value={teacherName}
                onChange={(e) => setTeacherName(e.target.value)}
                placeholder="Your name"
                style={{ width: 150, background: "rgba(255,255,255,0.12)", border: "none", color: "#EDEAF7" }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, opacity: 0.85 }}>
              {user?.photoURL && (
                <img src={user.photoURL} alt="" style={{ width: 22, height: 22, borderRadius: "50%" }} />
              )}
              <span>{user?.email}</span>
              <button
                onClick={() => signOut(auth)}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.4)", color: "#EDEAF7", borderRadius: 3, padding: "3px 9px", fontSize: 11, cursor: "pointer" }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
        {/* tabs */}
        <div style={{ display: "flex", gap: 4, marginTop: 14, flexWrap: "wrap" }}>
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: "7px 13px",
                fontSize: 12.5,
                fontWeight: 600,
                borderRadius: "5px 5px 0 0",
                border: "none",
                cursor: "pointer",
                background: tab === key ? PAPER : "rgba(255,255,255,0.08)",
                color: tab === key ? "#fff" : "rgba(237,234,247,0.78)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: 20, maxWidth: 1180, margin: "0 auto" }}>
        {tab === "dashboard" && <Dashboard learners={learners} classes={classes} grades={grades} collections={collections} behavior={behavior} schoolInfo={schoolInfo} setSchoolInfo={setSchoolInfo} />}
        {tab === "learners" && <LearnersTab learners={learners} setLearners={setLearners} classes={classes} />}
        {tab === "classes" && <ClassesTab classes={classes} setClasses={setClasses} learners={learners} teacherName={teacherName} />}
        {tab === "grades" && <GradesTab classes={classes} learners={learners} grades={grades} setGrades={setGrades} />}
        {tab === "attendance" && <AttendanceTab classes={classes} learners={learners} attendance={attendance} setAttendance={setAttendance} schoolInfo={schoolInfo} teacherName={teacherName} onPrint={setPrintDoc} />}
        {tab === "sf9" && <SF9Tab classes={classes} learners={learners} grades={grades} attendance={attendance} behavior={behavior} schoolInfo={schoolInfo} coreValues={coreValues} setCoreValues={setCoreValues} sf9Meta={sf9Meta} setSf9Meta={setSf9Meta} onPrint={setPrintDoc} />}
        {tab === "mps" && <MPSTab classes={classes} learners={learners} mps={mps} setMps={setMps} />}
        {tab === "behavior" && <BehaviorTab learners={learners} behavior={behavior} setBehavior={setBehavior} teacherName={teacherName} />}
        {tab === "collections" && <CollectionsTab classes={classes} learners={learners} collections={collections} setCollections={setCollections} />}
      </div>

      {printDoc && (
        <PrintOverlay onClose={() => setPrintDoc(null)}>
          {printDoc.type === "sf2" && <SF2PrintView {...printDoc} />}
          {printDoc.type === "sf9" && <SF9PrintView {...printDoc} />}
        </PrintOverlay>
      )}
    </div>
  );
}

/* ============================== PRINT OVERLAY ============================== */
function PrintOverlay({ children, onClose }) {
  return (
    <div className="talaan-print-overlay" style={{
      position: "fixed", inset: 0, background: "rgba(20,20,15,0.55)", zIndex: 50,
      display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 12px", overflow: "auto",
    }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .talaan-print-area, .talaan-print-area * { visibility: visible; }
          .talaan-print-area { position: absolute; left: 0; top: 0; width: 100%; }
          .talaan-no-print { display: none !important; }
        }
      `}</style>
      <div className="talaan-no-print" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Btn onClick={() => window.print()}>🖨 Print / Save as PDF</Btn>
        <Btn kind="ghost" onClick={onClose} style={{ background: "#fff" }}>Close</Btn>
      </div>
      <div className="talaan-print-area" style={{ background: "#fff", width: "100%", maxWidth: 820, padding: 28, boxShadow: "0 4px 24px rgba(0,0,0,0.25)" }}>
        {children}
      </div>
    </div>
  );
}

/* ============================== DASHBOARD ============================== */
function Dashboard({ learners, classes, grades, collections, behavior, schoolInfo, setSchoolInfo }) {
  const totalCollected = Object.values(collections).reduce((sum, c) => {
    const paid = Object.values(c.payments || {}).reduce((s2, learnerPays) => s2 + Object.values(learnerPays).reduce((s3, v) => s3 + (Number(v) || 0), 0), 0);
    return sum + paid;
  }, 0);
  const recentBehavior = Object.entries(behavior)
    .flatMap(([lid, entries]) => entries.map((e) => ({ ...e, lid })))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .slice(0, 5);

  return (
    <div>
      <SectionTitle sub="Snapshot of your roster, classes, and records.">Dashboard</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 20 }}>
        {[
          ["Learners enrolled", learners.length],
          ["Active classes", classes.length],
          ["Collections received", `₱${totalCollected.toLocaleString()}`],
          ["4Ps / IP / ARAL tagged", learners.filter((l) => l.tags?.fourPs || l.tags?.ip || l.tags?.aral).length],
        ].map(([label, val]) => (
          <Card key={label} style={{ padding: 16 }}>
            <div style={{ fontSize: 11, color: "rgba(237,234,247,0.58)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 26, color: FOREST, marginTop: 4 }}>{val}</div>
          </Card>
        ))}
      </div>

      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: FOREST }}>School details <span style={{ fontWeight: 400, color: "rgba(237,234,247,0.58)", fontSize: 12 }}>(printed on SF2 / SF9)</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <Field label="School name"><TIn value={schoolInfo.schoolName} onChange={(e) => setSchoolInfo({ ...schoolInfo, schoolName: e.target.value })} /></Field>
          <Field label="School ID"><TIn value={schoolInfo.schoolId} onChange={(e) => setSchoolInfo({ ...schoolInfo, schoolId: e.target.value })} /></Field>
          <Field label="District"><TIn value={schoolInfo.district} onChange={(e) => setSchoolInfo({ ...schoolInfo, district: e.target.value })} /></Field>
          <Field label="Division"><TIn value={schoolInfo.division} onChange={(e) => setSchoolInfo({ ...schoolInfo, division: e.target.value })} /></Field>
          <Field label="Region"><TIn value={schoolInfo.region} onChange={(e) => setSchoolInfo({ ...schoolInfo, region: e.target.value })} /></Field>
          <Field label="School year"><TIn value={schoolInfo.schoolYear} onChange={(e) => setSchoolInfo({ ...schoolInfo, schoolYear: e.target.value })} placeholder="2026-2027" /></Field>
        </div>
      </Card>

      <Card style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: FOREST }}>Your classes</div>
        {classes.length === 0 ? (
          <Empty text="No classes yet — add one in the Classes tab." />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 10 }}>
            {classes.map((c) => (
              <div key={c.id} style={{ border: `1px solid ${LINE}`, borderRadius: 4, padding: 10, background: PANEL }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.subject}</div>
                <div style={{ fontSize: 12, color: "rgba(237,234,247,0.65)" }}>{c.gradeLevel} — {c.section}</div>
                <div style={{ fontSize: 11.5, color: "rgba(237,234,247,0.58)", marginTop: 4 }}>{c.learnerIds.length} learners · {c.termType}</div>
                {c.coTeachers?.length > 0 && (
                  <div style={{ fontSize: 11, color: FOREST, marginTop: 4 }}>Shared with: {c.coTeachers.join(", ")}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: FOREST }}>Recent behavior notes</div>
        {recentBehavior.length === 0 ? (
          <Empty text="No anecdotal entries logged yet." />
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {recentBehavior.map((e, i) => {
              const l = learners.find((x) => x.id === e.lid);
              return (
                <li key={i} style={{ marginBottom: 4 }}>
                  <strong>{l ? l.name : "Unknown learner"}</strong> — {e.date}: {e.observation?.slice(0, 90)}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ============================== LEARNERS ============================== */
function LearnersTab({ learners, setLearners, classes }) {
  const [form, setForm] = useState({ name: "", lrn: "", sex: "M" });
  const [filterTag, setFilterTag] = useState("all");

  const addLearner = () => {
    if (!form.name.trim()) return;
    setLearners([...learners, { id: uid(), name: form.name.trim(), lrn: form.lrn.trim(), sex: form.sex, tags: {} }]);
    setForm({ name: "", lrn: "", sex: "M" });
  };
  const removeLearner = (id) => setLearners(learners.filter((l) => l.id !== id));
  const toggleTag = (id, key) =>
    setLearners(learners.map((l) => (l.id === id ? { ...l, tags: { ...l.tags, [key]: !l.tags?.[key] } } : l)));

  const shown = filterTag === "all" ? learners : learners.filter((l) => l.tags?.[filterTag]);

  return (
    <div>
      <SectionTitle sub="Your master roster. Tag learners for 4Ps, IP, ARAL, feeding, and deworming status — tags carry through to reports.">
        Learners
      </SectionTitle>

      <Card style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Full name">
            <TIn value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dela Cruz, Juan" style={{ width: 220 }} />
          </Field>
          <Field label="LRN">
            <TIn value={form.lrn} onChange={(e) => setForm({ ...form, lrn: e.target.value })} placeholder="12-digit LRN" style={{ width: 140 }} />
          </Field>
          <Field label="Sex">
            <TSel value={form.sex} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </TSel>
          </Field>
          <Btn onClick={addLearner}>+ Add learner</Btn>
        </div>
      </Card>

      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        <Btn kind={filterTag === "all" ? "primary" : "ghost"} onClick={() => setFilterTag("all")}>All ({learners.length})</Btn>
        {TAG_DEFS.map((t) => (
          <Btn key={t.key} kind={filterTag === t.key ? "primary" : "ghost"} onClick={() => setFilterTag(t.key)}>
            {t.label} ({learners.filter((l) => l.tags?.[t.key]).length})
          </Btn>
        ))}
      </div>

      <Card style={{ overflow: "auto" }}>
        {shown.length === 0 ? (
          <Empty text="No learners match this filter yet." />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: PANEL, textAlign: "left" }}>
                <th style={th}>Name</th>
                <th style={th}>LRN</th>
                <th style={th}>Sex</th>
                {TAG_DEFS.map((t) => (
                  <th key={t.key} style={{ ...th, textAlign: "center" }}>{t.label}</th>
                ))}
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={td}>{l.name}</td>
                  <td style={td}>{l.lrn || "—"}</td>
                  <td style={td}>{l.sex}</td>
                  {TAG_DEFS.map((t) => (
                    <td key={t.key} style={{ ...td, textAlign: "center" }}>
                      <input type="checkbox" checked={!!l.tags?.[t.key]} onChange={() => toggleTag(l.id, t.key)} />
                    </td>
                  ))}
                  <td style={td}><Btn kind="danger" onClick={() => removeLearner(l.id)}>Remove</Btn></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
const th = { padding: "8px 10px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.3, color: "rgba(237,234,247,0.58)" };
const td = { padding: "7px 10px" };

/* ============================== CLASSES ============================== */
function ClassesTab({ classes, setClasses, learners, teacherName }) {
  const [form, setForm] = useState({ subject: "", gradeLevel: "", section: "", termType: "quarter", weightPreset: "language" });
  const [coTeacherInput, setCoTeacherInput] = useState({});
  const [openRoster, setOpenRoster] = useState(null);

  const addClass = () => {
    if (!form.subject.trim()) return;
    setClasses([
      ...classes,
      {
        id: uid(),
        subject: form.subject.trim(),
        gradeLevel: form.gradeLevel.trim(),
        section: form.section.trim(),
        termType: form.termType,
        weights: WEIGHT_PRESETS[form.weightPreset],
        weightPreset: form.weightPreset,
        owner: teacherName || "Unnamed teacher",
        coTeachers: [],
        learnerIds: [],
      },
    ]);
    setForm({ subject: "", gradeLevel: "", section: "", termType: "quarter", weightPreset: "language" });
  };
  const removeClass = (id) => setClasses(classes.filter((c) => c.id !== id));
  const updateClass = (id, patch) => setClasses(classes.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const toggleEnroll = (classId, learnerId) => {
    const c = classes.find((x) => x.id === classId);
    const has = c.learnerIds.includes(learnerId);
    updateClass(classId, { learnerIds: has ? c.learnerIds.filter((x) => x !== learnerId) : [...c.learnerIds, learnerId] });
  };

  const addCoTeacher = (classId) => {
    const name = (coTeacherInput[classId] || "").trim();
    if (!name) return;
    const c = classes.find((x) => x.id === classId);
    if (!c.coTeachers.includes(name)) updateClass(classId, { coTeachers: [...c.coTeachers, name] });
    setCoTeacherInput({ ...coTeacherInput, [classId]: "" });
  };
  const removeCoTeacher = (classId, name) => {
    const c = classes.find((x) => x.id === classId);
    updateClass(classId, { coTeachers: c.coTeachers.filter((n) => n !== name) });
  };

  return (
    <div>
      <SectionTitle sub="Create a subject class, set its grading weights and term structure, and share it with co-teachers by name — any teacher using this same app can then open and edit it.">
        Classes
      </SectionTitle>

      <Card style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Subject / learning area">
            <TIn value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Science 7" style={{ width: 160 }} />
          </Field>
          <Field label="Grade level">
            <TIn value={form.gradeLevel} onChange={(e) => setForm({ ...form, gradeLevel: e.target.value })} placeholder="Grade 7" style={{ width: 110 }} />
          </Field>
          <Field label="Section">
            <TIn value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="Narra" style={{ width: 110 }} />
          </Field>
          <Field label="Term structure">
            <TSel value={form.termType} onChange={(e) => setForm({ ...form, termType: e.target.value })}>
              <option value="quarter">Quarterly (4)</option>
              <option value="trimester">Trimestral (3)</option>
              <option value="semester">Semestral (2)</option>
            </TSel>
          </Field>
          <Field label="Grading weights">
            <TSel value={form.weightPreset} onChange={(e) => setForm({ ...form, weightPreset: e.target.value })}>
              {Object.entries(WEIGHT_PRESETS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </TSel>
          </Field>
          <Btn onClick={addClass}>+ Create class</Btn>
        </div>
      </Card>

      {classes.length === 0 ? (
        <Empty text="No classes yet." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {classes.map((c) => (
            <Card key={c.id} style={{ padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: FOREST }}>{c.subject} <span style={{ fontWeight: 400, color: "rgba(237,234,247,0.58)", fontSize: 12 }}>· {c.gradeLevel} {c.section}</span></div>
                  <div style={{ fontSize: 11.5, color: "rgba(237,234,247,0.58)" }}>{c.termType} · WW {c.weights.WW} / PT {c.weights.PT} / QA {c.weights.QA} · owner: {c.owner}</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Btn kind="ghost" onClick={() => setOpenRoster(openRoster === c.id ? null : c.id)}>
                    {openRoster === c.id ? "Hide roster" : `Roster (${c.learnerIds.length})`}
                  </Btn>
                  <Btn kind="danger" onClick={() => removeClass(c.id)}>Delete</Btn>
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: "rgba(237,234,247,0.58)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase" }}>Shared with (co-teachers)</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {c.coTeachers.map((n) => (
                    <span key={n} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "3px 10px", fontSize: 12 }}>
                      {n} <span style={{ cursor: "pointer", color: GARNET, marginLeft: 4 }} onClick={() => removeCoTeacher(c.id, n)}>×</span>
                    </span>
                  ))}
                  <TIn
                    placeholder="Co-teacher's name"
                    value={coTeacherInput[c.id] || ""}
                    onChange={(e) => setCoTeacherInput({ ...coTeacherInput, [c.id]: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && addCoTeacher(c.id)}
                    style={{ width: 150 }}
                  />
                  <Btn kind="ghost" onClick={() => addCoTeacher(c.id)}>Add</Btn>
                </div>
                <div style={{ fontSize: 11, color: "rgba(237,234,247,0.58)", marginTop: 4 }}>
                  Any teacher who opens this app can already edit any class. Listing names here is just a visible record of who's teaching it together — it does not lock anyone out.
                </div>
              </div>

              {openRoster === c.id && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 6 }}>
                    {learners.length === 0 && <Empty text="Add learners in the Learners tab first." />}
                    {learners.map((l) => (
                      <label key={l.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
                        <input type="checkbox" checked={c.learnerIds.includes(l.id)} onChange={() => toggleEnroll(c.id, l.id)} />
                        {l.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================== GRADES ============================== */
function GradesTab({ classes, learners, grades, setGrades }) {
  const [classId, setClassId] = useState(classes[0]?.id || "");
  useEffect(() => { if (!classId && classes.length) setClassId(classes[0].id); }, [classes]);
  const cls = classes.find((c) => c.id === classId);
  const terms = cls ? TERM_SETS[cls.termType] : [];
  const [term, setTerm] = useState(terms[0] || "");
  useEffect(() => { setTerm((TERM_SETS[cls?.termType] || [])[0] || ""); }, [classId]);

  if (!cls) return <div><SectionTitle>Grade Sheet</SectionTitle><Empty text="Create a class first." /></div>;

  const classGrades = grades[classId] || {};

  const getTermData = (learnerId) => classGrades[learnerId]?.[term] || { WW: [], PT: [], QA: [] };

  const updateEntries = (learnerId, comp, entries) => {
    setGrades({
      ...grades,
      [classId]: {
        ...classGrades,
        [learnerId]: {
          ...(classGrades[learnerId] || {}),
          [term]: { ...getTermData(learnerId), [comp]: entries },
        },
      },
    });
  };
  const addItem = (learnerId, comp) => {
    const entries = getTermData(learnerId)[comp];
    updateEntries(learnerId, comp, [...entries, { id: uid(), score: 0, hps: 10 }]);
  };
  const editItem = (learnerId, comp, itemId, field, value) => {
    const entries = getTermData(learnerId)[comp].map((it) => (it.id === itemId ? { ...it, [field]: Number(value) || 0 } : it));
    updateEntries(learnerId, comp, entries);
  };
  const removeItem = (learnerId, comp, itemId) => {
    updateEntries(learnerId, comp, getTermData(learnerId)[comp].filter((it) => it.id !== itemId));
  };

  const compute = (learnerId) => {
    const t = getTermData(learnerId);
    const sums = {};
    ["WW", "PT", "QA"].forEach((c) => {
      const raw = t[c].reduce((s, it) => s + it.score, 0);
      const hps = t[c].reduce((s, it) => s + it.hps, 0);
      sums[c] = pct(raw, hps);
    });
    const ig =
      (isFinite(sums.WW) ? sums.WW : 0) * (cls.weights.WW / 100) +
      (isFinite(sums.PT) ? sums.PT : 0) * (cls.weights.PT / 100) +
      (isFinite(sums.QA) ? sums.QA : 0) * (cls.weights.QA / 100);
    const tg = transmute(ig);
    return { sums, ig, tg };
  };

  const roster = learners.filter((l) => cls.learnerIds.includes(l.id));

  return (
    <div>
      <SectionTitle sub="Enter raw Written Work, Performance Task, and Quarterly Assessment scores. Percentages, the Initial Grade, and the DepEd-transmuted grade are computed automatically.">
        Grade Sheet
      </SectionTitle>

      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Field label="Class">
          <TSel value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.subject} — {c.gradeLevel} {c.section}</option>)}
          </TSel>
        </Field>
        <Field label="Term">
          <TSel value={term} onChange={(e) => setTerm(e.target.value)}>
            {terms.map((t) => <option key={t} value={t}>{t}</option>)}
          </TSel>
        </Field>
        <Field label="Weights"><div style={{ padding: "6px 0", fontSize: 12 }}>WW {cls.weights.WW} / PT {cls.weights.PT} / QA {cls.weights.QA}</div></Field>
      </div>

      {roster.length === 0 ? (
        <Empty text="No learners enrolled in this class yet — add them from the Classes tab." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {roster.map((l) => {
            const { sums, ig, tg } = compute(l.id);
            const t = getTermData(l.id);
            return (
              <Card key={l.id} style={{ padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 700 }}>{l.name}</div>
                  <div style={{ display: "flex", gap: 14, fontSize: 12.5, alignItems: "center" }}>
                    <span>Initial Grade: <strong>{round1(ig)}</strong></span>
                    <span style={{ background: FOREST, color: "#fff", padding: "3px 10px", borderRadius: 12 }}>
                      Transmuted: {tg}
                    </span>
                    <span style={{ color: "rgba(237,234,247,0.65)" }}>{descriptor(tg)}</span>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                  {["WW", "PT", "QA"].map((comp) => (
                    <div key={comp}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: FOREST, marginBottom: 4 }}>
                        {comp === "WW" ? "Written Work" : comp === "PT" ? "Performance Task" : "Quarterly Assessment"} ({round1(sums[comp] || 0)}%)
                      </div>
                      {t[comp].map((it) => (
                        <div key={it.id} style={{ display: "flex", gap: 4, marginBottom: 3, alignItems: "center" }}>
                          <TIn type="number" value={it.score} onChange={(e) => editItem(l.id, comp, it.id, "score", e.target.value)} style={{ width: 50 }} />
                          <span style={{ fontSize: 11 }}>/</span>
                          <TIn type="number" value={it.hps} onChange={(e) => editItem(l.id, comp, it.id, "hps", e.target.value)} style={{ width: 50 }} />
                          <span style={{ cursor: "pointer", color: GARNET, fontSize: 13 }} onClick={() => removeItem(l.id, comp, it.id)}>×</span>
                        </div>
                      ))}
                      <Btn kind="ghost" style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => addItem(l.id, comp)}>+ item</Btn>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================== ATTENDANCE ============================== */
function daysInMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
function AttendanceTab({ classes, learners, attendance, setAttendance, schoolInfo, teacherName, onPrint }) {
  const [classId, setClassId] = useState(classes[0]?.id || "");
  useEffect(() => { if (!classId && classes.length) setClassId(classes[0].id); }, [classes]);
  const now = new Date();
  const defaultYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [ym, setYm] = useState(defaultYM);
  const cls = classes.find((c) => c.id === classId);

  if (!cls) return <div><SectionTitle>Attendance / SF2</SectionTitle><Empty text="Create a class first." /></div>;

  const roster = learners.filter((l) => cls.learnerIds.includes(l.id));
  const monthData = attendance[classId]?.[ym] || {};
  const nDays = daysInMonth(ym);
  const schoolDays = Array.from({ length: nDays }, (_, i) => i + 1);

  const setStatus = (learnerId, day, status) => {
    const learnerData = monthData[learnerId] || {};
    const nextStatus = learnerData[day] === status ? undefined : status;
    const nextLearner = { ...learnerData, [day]: nextStatus };
    if (nextStatus === undefined) delete nextLearner[day];
    setAttendance({
      ...attendance,
      [classId]: { ...(attendance[classId] || {}), [ym]: { ...monthData, [learnerId]: nextLearner } },
    });
  };

  const statusOf = (learnerId, day) => (monthData[learnerId] || {})[day];

  // SF2 style summary
  const summary = roster.map((l) => {
    const days = monthData[l.id] || {};
    const present = Object.values(days).filter((s) => s === "P").length;
    const absent = Object.values(days).filter((s) => s === "A").length;
    const late = Object.values(days).filter((s) => s === "L").length;
    const marked = Object.keys(days).length;
    return { l, present, absent, late, marked, pctPresent: marked ? round1(pct(present, marked)) : 0 };
  });

  const cycle = ["P", "A", "L", "E"];
  const cellColor = { P: "#e4efe1", A: "#f4dede", L: "#faf0d6", E: "#e2ecf5" };

  return (
    <div>
      <SectionTitle sub="Mark daily status (P/A/L/E). The monthly summary below mirrors the DepEd SF2 register — total days present/absent and attendance rate per learner.">
        Attendance / SF2
      </SectionTitle>
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Field label="Class">
          <TSel value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.subject} — {c.gradeLevel} {c.section}</option>)}
          </TSel>
        </Field>
        <Field label="Month">
          <TIn type="month" value={ym} onChange={(e) => setYm(e.target.value)} />
        </Field>
        <Field label="Legend">
          <div style={{ display: "flex", gap: 8, padding: "6px 0", fontSize: 11 }}>
            <span>P=Present</span><span>A=Absent</span><span>L=Late</span><span>E=Excused</span>
          </div>
        </Field>
        <Field label=" ">
          <Btn
            kind="gold"
            onClick={() => onPrint({ type: "sf2", cls, ym, roster, monthData, schoolInfo, teacherName })}
            disabled={roster.length === 0}
          >
            🖨 Print SF2
          </Btn>
        </Field>
      </div>

      <Card style={{ overflow: "auto", marginBottom: 16 }}>
        {roster.length === 0 ? (
          <Empty text="No learners enrolled in this class yet." />
        ) : (
          <table style={{ borderCollapse: "collapse", fontSize: 11 }}>
            <thead>
              <tr style={{ background: PANEL }}>
                <th style={{ ...th, position: "sticky", left: 0, background: PANEL }}>Learner</th>
                {schoolDays.map((d) => <th key={d} style={{ ...th, textAlign: "center", padding: "6px 4px" }}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {roster.map((l) => (
                <tr key={l.id} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={{ ...td, position: "sticky", left: 0, background: CARD_BG, whiteSpace: "nowrap" }}>{l.name}</td>
                  {schoolDays.map((d) => {
                    const s = statusOf(l.id, d);
                    return (
                      <td key={d} style={{ padding: 2, textAlign: "center" }}>
                        <button
                          onClick={() => {
                            const idx = cycle.indexOf(s);
                            const next = idx === -1 ? cycle[0] : cycle[(idx + 1) % cycle.length];
                            setStatus(l.id, d, s ? (idx === cycle.length - 1 ? undefined : next) : next);
                          }}
                          style={{
                            width: 22, height: 22, fontSize: 10, fontWeight: 700, border: `1px solid ${LINE}`, borderRadius: 3,
                            background: s ? cellColor[s] : "rgba(255,255,255,0.05)", cursor: "pointer",
                            color: s ? "#1b1235" : INK,
                          }}
                        >
                          {s || ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card style={{ padding: 14 }}>
        <div style={{ fontWeight: 700, marginBottom: 8, color: FOREST }}>SF2 monthly summary — {ym}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ background: PANEL }}>
              <th style={th}>Learner</th><th style={th}>Days present</th><th style={th}>Days absent</th><th style={th}>Days late</th><th style={th}>% attendance</th>
            </tr>
          </thead>
          <tbody>
            {summary.map(({ l, present, absent, late, pctPresent }) => (
              <tr key={l.id} style={{ borderTop: `1px solid ${LINE}` }}>
                <td style={td}>{l.name}</td><td style={td}>{present}</td><td style={td}>{absent}</td><td style={td}>{late}</td><td style={td}>{pctPresent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: "rgba(237,234,247,0.58)", marginTop: 8 }}>
          This table has the same fields your SF2 form needs — copy the counts across, or use it as your working register before transcribing to the official DepEd form.
        </div>
      </Card>
    </div>
  );
}

/* ============================== SF9 ============================== */
function SF9Tab({ classes, learners, grades, attendance, behavior, schoolInfo, coreValues, setCoreValues, sf9Meta, setSf9Meta, onPrint }) {
  const [learnerId, setLearnerId] = useState(learners[0]?.id || "");
  useEffect(() => { if (!learnerId && learners.length) setLearnerId(learners[0].id); }, [learners]);
  const learner = learners.find((l) => l.id === learnerId);
  if (!learner) return <div><SectionTitle>SF9 Report Card</SectionTitle><Empty text="Add a learner first." /></div>;

  const enrolledClasses = classes.filter((c) => c.learnerIds.includes(learnerId));
  const meta = sf9Meta[learnerId] || { homeroomClassId: enrolledClasses[0]?.id || "", remarks: "" };
  const updateMeta = (patch) => setSf9Meta({ ...sf9Meta, [learnerId]: { ...meta, ...patch } });
  const ratings = coreValues[learnerId] || {};
  const setRating = (stKey, val) => setCoreValues({ ...coreValues, [learnerId]: { ...ratings, [stKey]: val } });

  const rows = enrolledClasses.map((c) => {
    const terms = TERM_SETS[c.termType];
    const classGrades = grades[c.id]?.[learnerId] || {};
    const termGrades = terms.map((t) => {
      const td = classGrades[t];
      if (!td) return null;
      const sums = {};
      ["WW", "PT", "QA"].forEach((comp) => {
        const raw = (td[comp] || []).reduce((s, it) => s + it.score, 0);
        const hps = (td[comp] || []).reduce((s, it) => s + it.hps, 0);
        sums[comp] = pct(raw, hps);
      });
      const ig = (sums.WW || 0) * (c.weights.WW / 100) + (sums.PT || 0) * (c.weights.PT / 100) + (sums.QA || 0) * (c.weights.QA / 100);
      return transmute(ig);
    });
    const valid = termGrades.filter((g) => g !== null);
    const finalGrade = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    return { c, terms, termGrades, finalGrade };
  });

  const validFinals = rows.map((r) => r.finalGrade).filter((g) => g !== null);
  const generalAverage = validFinals.length ? round1(validFinals.reduce((a, b) => a + b, 0) / validFinals.length) : null;

  // attendance summary sourced from the learner's homeroom/advisory class only
  const homeroomAttendance = attendance[meta.homeroomClassId] || {};
  let totalPresent = 0, totalMarked = 0;
  const monthlyBreakdown = Object.entries(homeroomAttendance)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ym, monthData]) => {
      const days = monthData[learnerId] || {};
      const marked = Object.keys(days).length;
      const present = Object.values(days).filter((s) => s === "P").length;
      const absent = Object.values(days).filter((s) => s === "A").length;
      totalMarked += marked; totalPresent += present;
      return { ym, marked, present, absent };
    });

  const behaviorEntries = behavior[learnerId] || [];

  return (
    <div>
      <SectionTitle sub="A term-based report card view pulling directly from the grade sheet, attendance register, and anecdotal log for this learner.">
        SF9 Report Card
      </SectionTitle>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <Field label="Learner">
          <TSel value={learnerId} onChange={(e) => setLearnerId(e.target.value)} style={{ width: 220 }}>
            {learners.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </TSel>
        </Field>
        <Field label="Attendance source (homeroom class)">
          <TSel value={meta.homeroomClassId} onChange={(e) => updateMeta({ homeroomClassId: e.target.value })} style={{ width: 220 }}>
            <option value="">— none —</option>
            {enrolledClasses.map((c) => <option key={c.id} value={c.id}>{c.subject} — {c.gradeLevel} {c.section}</option>)}
          </TSel>
        </Field>
        <Btn
          kind="gold"
          onClick={() => onPrint({ type: "sf9", learner, rows, generalAverage, monthlyBreakdown, totalPresent, totalMarked, coreValueRatings: ratings, remarks: meta.remarks, schoolInfo })}
          disabled={rows.length === 0}
        >
          🖨 Print SF9
        </Btn>
      </div>

      <Card style={{ padding: 18 }}>
        <div style={{ textAlign: "center", marginBottom: 14, borderBottom: `2px solid ${GOLD}`, paddingBottom: 10 }}>
          <div style={{ fontSize: 11, letterSpacing: 1, color: "rgba(237,234,247,0.58)" }}>REPORT ON LEARNING PROGRESS AND ACHIEVEMENT (SF9)</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 20, color: FOREST, marginTop: 4 }}>{learner.name}</div>
          <div style={{ fontSize: 12, color: "rgba(237,234,247,0.65)" }}>LRN: {learner.lrn || "—"}</div>
        </div>

        {rows.length === 0 ? (
          <Empty text="This learner isn't enrolled in any class yet." />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginBottom: 14 }}>
            <thead>
              <tr style={{ background: PANEL }}>
                <th style={th}>Learning Area</th>
                {rows[0].terms.map((t) => <th key={t} style={{ ...th, textAlign: "center" }}>{t}</th>)}
                <th style={{ ...th, textAlign: "center" }}>Final</th>
                <th style={{ ...th, textAlign: "center" }}>Descriptor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, termGrades, finalGrade }) => (
                <tr key={c.id} style={{ borderTop: `1px solid ${LINE}` }}>
                  <td style={td}>{c.subject}</td>
                  {termGrades.map((g, i) => <td key={i} style={{ ...td, textAlign: "center" }}>{g ?? "—"}</td>)}
                  <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{finalGrade ?? "—"}</td>
                  <td style={{ ...td, textAlign: "center" }}>{finalGrade ? descriptor(finalGrade) : "—"}</td>
                </tr>
              ))}
              <tr style={{ borderTop: `2px solid ${FOREST}`, fontWeight: 700 }}>
                <td style={td} colSpan={rows[0].terms.length + 1}>General Average</td>
                <td style={{ ...td, textAlign: "center" }}>{generalAverage ?? "—"}</td>
                <td style={{ ...td, textAlign: "center" }}>{generalAverage ? descriptor(generalAverage) : "—"}</td>
              </tr>
            </tbody>
          </table>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: FOREST, marginBottom: 4 }}>Attendance</div>
            <div style={{ fontSize: 12.5 }}>
              Days marked: {totalMarked} · Days present: {totalPresent} · Rate: {totalMarked ? round1(pct(totalPresent, totalMarked)) : 0}%
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: FOREST, marginBottom: 4 }}>Learner tags</div>
            <div style={{ fontSize: 12.5 }}>
              {TAG_DEFS.filter((t) => learner.tags?.[t.key]).map((t) => t.label).join(", ") || "None recorded"}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: FOREST, marginBottom: 4 }}>Observed behavior / anecdotal remarks</div>
          {behaviorEntries.length === 0 ? (
            <div style={{ fontSize: 12, color: "rgba(237,234,247,0.58)" }}>No entries logged.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {behaviorEntries.slice(-3).map((e, i) => <li key={i}>{e.date}: {e.observation}</li>)}
            </ul>
          )}
        </div>

        <div style={{ marginTop: 16, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, color: FOREST, marginBottom: 6 }}>
            Core values rating <span style={{ fontWeight: 400, color: "rgba(237,234,247,0.58)" }}>(AO/SO/RO/NO — used on the printed SF9)</span>
          </div>
          <div style={{ fontSize: 11, color: "rgba(237,234,247,0.58)", marginBottom: 8 }}>
            Statements follow the standard four core values. Wording can vary by DepEd memorandum — treat these as a starting point and adjust to your division's exact template if needed.
          </div>
          {DEFAULT_CORE_VALUES.map((cv) => (
            <div key={cv.key} style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: FOREST }}>{cv.title}</div>
              {cv.statements.map((st, i) => {
                const stKey = `${cv.key}:${i}`;
                return (
                  <div key={stKey} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}>
                    <span style={{ flex: 1 }}>{st}</span>
                    <TSel value={ratings[stKey] || ""} onChange={(e) => setRating(stKey, e.target.value)} style={{ width: 90 }}>
                      <option value="">—</option>
                      {RATING_SCALE.map((r) => <option key={r} value={r}>{r}</option>)}
                    </TSel>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12 }}>
          <Field label="General remarks (promoted / retained / etc.)">
            <TIn value={meta.remarks} onChange={(e) => updateMeta({ remarks: e.target.value })} style={{ width: "100%" }} />
          </Field>
        </div>
      </Card>
    </div>
  );
}

/* ============================== MPS ============================== */
function MPSTab({ classes, learners, mps, setMps }) {
  const [classId, setClassId] = useState(classes[0]?.id || "");
  useEffect(() => { if (!classId && classes.length) setClassId(classes[0].id); }, [classes]);
  const cls = classes.find((c) => c.id === classId);
  const roster = cls ? learners.filter((l) => cls.learnerIds.includes(l.id)) : [];
  const [form, setForm] = useState({ name: "", hps: 50 });

  if (!cls) return <div><SectionTitle>MPS & Assessment Results</SectionTitle><Empty text="Create a class first." /></div>;

  const assessments = mps[classId] || [];

  const addAssessment = () => {
    if (!form.name.trim()) return;
    const scores = {};
    roster.forEach((l) => (scores[l.id] = 0));
    setMps({ ...mps, [classId]: [...assessments, { id: uid(), name: form.name.trim(), hps: Number(form.hps) || 1, scores }] });
    setForm({ name: "", hps: 50 });
  };
  const updateScore = (aid, learnerId, value) => {
    setMps({
      ...mps,
      [classId]: assessments.map((a) => (a.id === aid ? { ...a, scores: { ...a.scores, [learnerId]: Number(value) || 0 } } : a)),
    });
  };
  const removeAssessment = (aid) => setMps({ ...mps, [classId]: assessments.filter((a) => a.id !== aid) });

  return (
    <div>
      <SectionTitle sub="Record a test's highest possible score and each learner's raw score. The Mean Percentage Score and mastery level are computed automatically.">
        MPS & Assessment Results
      </SectionTitle>
      <Field label="Class">
        <TSel value={classId} onChange={(e) => setClassId(e.target.value)} style={{ width: 260, marginBottom: 14 }}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.subject} — {c.gradeLevel} {c.section}</option>)}
        </TSel>
      </Field>

      <Card style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Assessment name"><TIn value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Q1 Written Exam" style={{ width: 220 }} /></Field>
          <Field label="Highest possible score"><TIn type="number" value={form.hps} onChange={(e) => setForm({ ...form, hps: e.target.value })} style={{ width: 100 }} /></Field>
          <Btn onClick={addAssessment} disabled={roster.length === 0}>+ Add assessment</Btn>
        </div>
        {roster.length === 0 && <div style={{ fontSize: 11.5, color: "rgba(237,234,247,0.58)", marginTop: 6 }}>Enroll learners into this class first.</div>}
      </Card>

      {assessments.map((a) => {
        const scoreVals = roster.map((l) => a.scores[l.id] || 0);
        const total = scoreVals.reduce((s, v) => s + v, 0);
        const meanScore = roster.length ? total / roster.length : 0;
        const mpsVal = round1(pct(meanScore, a.hps));
        const level = mpsLevel(mpsVal);
        return (
          <Card key={a.id} style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
              <div style={{ fontWeight: 700 }}>{a.name} <span style={{ fontWeight: 400, color: "rgba(237,234,247,0.58)", fontSize: 12 }}>(HPS {a.hps})</span></div>
              <div style={{ display: "flex", gap: 12, fontSize: 12.5, alignItems: "center" }}>
                <span>Mean score: <strong>{round1(meanScore)}</strong></span>
                <span style={{ background: FOREST, color: "#fff", padding: "3px 10px", borderRadius: 12 }}>MPS: {mpsVal}%</span>
                <span style={{ color: "rgba(237,234,247,0.65)" }}>{level}</span>
                <Btn kind="danger" onClick={() => removeAssessment(a.id)}>Delete</Btn>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))", gap: 6 }}>
              {roster.map((l) => (
                <label key={l.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                  <span style={{ flex: 1 }}>{l.name}</span>
                  <TIn type="number" value={a.scores[l.id] || 0} onChange={(e) => updateScore(a.id, l.id, e.target.value)} style={{ width: 55 }} />
                </label>
              ))}
            </div>
          </Card>
        );
      })}
      {assessments.length === 0 && <Empty text="No assessments recorded for this class yet." />}
    </div>
  );
}

/* ============================== BEHAVIOR ============================== */
function BehaviorTab({ learners, behavior, setBehavior, teacherName }) {
  const [learnerId, setLearnerId] = useState(learners[0]?.id || "");
  useEffect(() => { if (!learnerId && learners.length) setLearnerId(learners[0].id); }, [learners]);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), observation: "", context: "", action: "" });

  const entries = behavior[learnerId] || [];

  const addEntry = () => {
    if (!form.observation.trim()) return;
    const entry = { ...form, recordedBy: teacherName || "Teacher" };
    setBehavior({ ...behavior, [learnerId]: [...entries, entry].sort((a, b) => a.date.localeCompare(b.date)) });
    setForm({ date: new Date().toISOString().slice(0, 10), observation: "", context: "", action: "" });
  };
  const removeEntry = (idx) => setBehavior({ ...behavior, [learnerId]: entries.filter((_, i) => i !== idx) });

  if (learners.length === 0) return <div><SectionTitle>Anecdotal Record</SectionTitle><Empty text="Add a learner first." /></div>;

  return (
    <div>
      <SectionTitle sub="Log what you observed, the context, and any action taken. Entries are organized chronologically into a ready-to-print anecdotal record per learner.">
        Anecdotal Record
      </SectionTitle>
      <Field label="Learner">
        <TSel value={learnerId} onChange={(e) => setLearnerId(e.target.value)} style={{ width: 260, marginBottom: 14 }}>
          {learners.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </TSel>
      </Field>

      <Card style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10 }}>
          <Field label="Date"><TIn type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="What was observed">
            <TIn value={form.observation} onChange={(e) => setForm({ ...form, observation: e.target.value })} placeholder="e.g. Shared materials with a classmate without being asked" />
          </Field>
          <Field label="Context / setting"><TIn value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} placeholder="Group activity, recess, etc." /></Field>
          <Field label="Action taken / follow-up"><TIn value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} placeholder="Praised in class, parent informed, etc." /></Field>
        </div>
        <div style={{ marginTop: 10 }}><Btn onClick={addEntry}>+ Log entry</Btn></div>
      </Card>

      <Card style={{ padding: 16 }}>
        <div style={{ fontFamily: "Georgia, serif", fontSize: 16, color: FOREST, marginBottom: 10 }}>
          Anecdotal record — {learners.find((l) => l.id === learnerId)?.name}
        </div>
        {entries.length === 0 ? (
          <Empty text="No entries logged yet." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {entries.map((e, i) => (
              <div key={i} style={{ borderLeft: `3px solid ${GOLD}`, paddingLeft: 10 }}>
                <div style={{ fontSize: 11.5, color: "rgba(237,234,247,0.58)" }}>{e.date} · recorded by {e.recordedBy}</div>
                <div style={{ fontSize: 13 }}>{e.observation}</div>
                {e.context && <div style={{ fontSize: 12, color: "rgba(237,234,247,0.65)" }}>Context: {e.context}</div>}
                {e.action && <div style={{ fontSize: 12, color: "rgba(237,234,247,0.65)" }}>Action: {e.action}</div>}
                <span style={{ fontSize: 11, color: GARNET, cursor: "pointer" }} onClick={() => removeEntry(i)}>Remove entry</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ============================== COLLECTIONS ============================== */
function CollectionsTab({ classes, learners, collections, setCollections }) {
  const [classId, setClassId] = useState(classes[0]?.id || "");
  useEffect(() => { if (!classId && classes.length) setClassId(classes[0].id); }, [classes]);
  const cls = classes.find((c) => c.id === classId);
  const roster = cls ? learners.filter((l) => cls.learnerIds.includes(l.id)) : [];
  const data = collections[classId] || { items: [], payments: {} };
  const [itemForm, setItemForm] = useState({ name: "", amount: "" });

  if (!cls) return <div><SectionTitle>Collections</SectionTitle><Empty text="Create a class first." /></div>;

  const setData = (patch) => setCollections({ ...collections, [classId]: { ...data, ...patch } });

  const addItem = () => {
    if (!itemForm.name.trim() || !itemForm.amount) return;
    setData({ items: [...data.items, { id: uid(), name: itemForm.name.trim(), amount: Number(itemForm.amount) }] });
    setItemForm({ name: "", amount: "" });
  };
  const removeItem = (id) => setData({ items: data.items.filter((i) => i.id !== id) });

  const setPaid = (learnerId, itemId, value) => {
    const learnerPays = { ...(data.payments[learnerId] || {}), [itemId]: Number(value) || 0 };
    setData({ payments: { ...data.payments, [learnerId]: learnerPays } });
  };

  return (
    <div>
      <SectionTitle sub="Track class fees and contributions. Balances are computed per learner and per item.">Collections</SectionTitle>
      <Field label="Class">
        <TSel value={classId} onChange={(e) => setClassId(e.target.value)} style={{ width: 260, marginBottom: 14 }}>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.subject} — {c.gradeLevel} {c.section}</option>)}
        </TSel>
      </Field>

      <Card style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Item / fee name"><TIn value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder="Field trip fee" style={{ width: 200 }} /></Field>
          <Field label="Amount (₱)"><TIn type="number" value={itemForm.amount} onChange={(e) => setItemForm({ ...itemForm, amount: e.target.value })} style={{ width: 110 }} /></Field>
          <Btn onClick={addItem}>+ Add item</Btn>
        </div>
      </Card>

      {data.items.length === 0 ? (
        <Empty text="Add a fee item to start tracking payments." />
      ) : roster.length === 0 ? (
        <Empty text="Enroll learners into this class first." />
      ) : (
        <Card style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ background: PANEL }}>
                <th style={th}>Learner</th>
                {data.items.map((i) => (
                  <th key={i.id} style={{ ...th, textAlign: "center" }}>
                    {i.name} (₱{i.amount})<br /><span style={{ cursor: "pointer", color: GARNET, fontWeight: 400 }} onClick={() => removeItem(i.id)}>remove</span>
                  </th>
                ))}
                <th style={th}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((l) => {
                const paidTotal = data.items.reduce((s, i) => s + ((data.payments[l.id] || {})[i.id] || 0), 0);
                const dueTotal = data.items.reduce((s, i) => s + i.amount, 0);
                return (
                  <tr key={l.id} style={{ borderTop: `1px solid ${LINE}` }}>
                    <td style={td}>{l.name}</td>
                    {data.items.map((i) => (
                      <td key={i.id} style={{ ...td, textAlign: "center" }}>
                        <TIn type="number" value={(data.payments[l.id] || {})[i.id] || 0} onChange={(e) => setPaid(l.id, i.id, e.target.value)} style={{ width: 70 }} />
                      </td>
                    ))}
                    <td style={{ ...td, fontWeight: 700, color: paidTotal >= dueTotal ? FOREST : GARNET }}>₱{dueTotal - paidTotal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/* ============================== SF2 PRINT VIEW ============================== */
function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function isWeekend(ym, day) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1, day).getDay();
  return d === 0 || d === 6;
}
const printTh = { border: "1px solid #999", padding: "3px 4px", fontSize: 9, background: "#eee" };
const printTd = { border: "1px solid #bbb", padding: "3px 4px", fontSize: 10 };

function SF2PrintView({ cls, ym, roster, monthData, schoolInfo, teacherName }) {
  const nDays = daysInMonth(ym);
  const days = Array.from({ length: nDays }, (_, i) => i + 1);
  const male = roster.filter((l) => l.sex === "M");
  const female = roster.filter((l) => l.sex === "F");

  const dailyPresentCount = (list, day) =>
    list.filter((l) => (monthData[l.id] || {})[day] === "P").length;

  const learnerRow = (l) => {
    const days2 = monthData[l.id] || {};
    const present = Object.values(days2).filter((s) => s === "P").length;
    const absent = Object.values(days2).filter((s) => s === "A").length;
    return (
      <tr key={l.id}>
        <td style={{ ...printTd, textAlign: "left", whiteSpace: "nowrap" }}>{l.name}</td>
        {days.map((d) => {
          const s = days2[d];
          const weekend = isWeekend(ym, d);
          return (
            <td key={d} style={{ ...printTd, textAlign: "center", background: weekend ? "#f2f2f2" : "#fff" }}>
              {s || ""}
            </td>
          );
        })}
        <td style={{ ...printTd, textAlign: "center", fontWeight: 700 }}>{present}</td>
        <td style={{ ...printTd, textAlign: "center", fontWeight: 700 }}>{absent}</td>
      </tr>
    );
  };

  return (
    <div style={{ fontFamily: "Georgia, serif", color: "#111" }}>
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: 1 }}>School Form 2 (SF2) — Daily Attendance Report of Learners</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>Monthly Learners' Attendance Report</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8, fontSize: 10.5 }}>
        <tbody>
          <tr>
            <td style={ffld}>School ID: <b>{schoolInfo?.schoolId || "___________"}</b></td>
            <td style={ffld}>School Name: <b>{schoolInfo?.schoolName || "___________"}</b></td>
            <td style={ffld}>School Year: <b>{schoolInfo?.schoolYear || "___________"}</b></td>
          </tr>
          <tr>
            <td style={ffld}>District: <b>{schoolInfo?.district || "___________"}</b></td>
            <td style={ffld}>Division: <b>{schoolInfo?.division || "___________"}</b></td>
            <td style={ffld}>Region: <b>{schoolInfo?.region || "___________"}</b></td>
          </tr>
          <tr>
            <td style={ffld}>Grade & Section: <b>{cls.gradeLevel} — {cls.section}</b></td>
            <td style={ffld}>Subject: <b>{cls.subject}</b></td>
            <td style={ffld}>Month: <b>{monthLabel(ym)}</b></td>
          </tr>
          <tr>
            <td style={ffld} colSpan={3}>Teacher: <b>{teacherName || "___________"}</b></td>
          </tr>
        </tbody>
      </table>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 9 }}>
          <thead>
            <tr>
              <th style={{ ...printTh, textAlign: "left" }}>Learner's Name</th>
              {days.map((d) => <th key={d} style={printTh}>{d}</th>)}
              <th style={printTh}>Present</th>
              <th style={printTh}>Absent</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={{ ...printTd, fontWeight: 700, background: "#f7f4e8" }} colSpan={days.length + 3}>MALE</td></tr>
            {male.map(learnerRow)}
            <tr><td style={{ ...printTd, fontWeight: 700, background: "#f7f4e8" }} colSpan={days.length + 3}>FEMALE</td></tr>
            {female.map(learnerRow)}
            <tr>
              <td style={{ ...printTd, fontWeight: 700 }}>Total present per day</td>
              {days.map((d) => (
                <td key={d} style={{ ...printTd, textAlign: "center", fontWeight: 700 }}>{dailyPresentCount(roster, d)}</td>
              ))}
              <td style={printTd}></td><td style={printTd}></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 10.5 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            <tr>
              <td style={ffld}>Enrolment as of {monthLabel(ym)}: <b>{roster.length}</b> ({male.length} male, {female.length} female)</td>
              <td style={ffld}>Average daily attendance: <b>
                {round1(pct(days.reduce((s, d) => s + dailyPresentCount(roster, d), 0), days.filter((d) => !isWeekend(ym, d)).length * (roster.length || 1)))}%
              </b></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 9, color: "#555" }}>
        Legend: P = Present, A = Absent, L = Late, E = Excused. Shaded columns are weekends.
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 36, fontSize: 10.5 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #333", width: 180, paddingTop: 4 }}>{teacherName || "Teacher"}</div>
          <div style={{ fontSize: 9, color: "#555" }}>Teacher</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #333", width: 180, paddingTop: 4 }}>&nbsp;</div>
          <div style={{ fontSize: 9, color: "#555" }}>School Head</div>
        </div>
      </div>
    </div>
  );
}
const ffld = { padding: "2px 6px", fontSize: 10.5 };

/* ============================== SF9 PRINT VIEW ============================== */
function SF9PrintView({ learner, rows, generalAverage, monthlyBreakdown, totalPresent, totalMarked, coreValueRatings, remarks, schoolInfo }) {
  return (
    <div style={{ fontFamily: "Georgia, serif", color: "#111" }}>
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: 1 }}>School Form 9 (SF9) — Report on Learning Progress and Achievement</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{schoolInfo?.schoolName || "School Name"}</div>
        <div style={{ fontSize: 10 }}>{schoolInfo?.district}{schoolInfo?.district ? " · " : ""}{schoolInfo?.division}{schoolInfo?.division ? " · " : ""}{schoolInfo?.region}</div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 10, fontSize: 10.5 }}>
        <tbody>
          <tr>
            <td style={ffld}>Learner's Name: <b>{learner.name}</b></td>
            <td style={ffld}>LRN: <b>{learner.lrn || "—"}</b></td>
          </tr>
          <tr>
            <td style={ffld}>School Year: <b>{schoolInfo?.schoolYear || "—"}</b></td>
            <td style={ffld}>Sex: <b>{learner.sex}</b></td>
          </tr>
        </tbody>
      </table>

      <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Learning Progress</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11 }}>No grades recorded.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginBottom: 12 }}>
          <thead>
            <tr>
              <th style={printTh}>Learning Area</th>
              {rows[0].terms.map((t) => <th key={t} style={printTh}>{t}</th>)}
              <th style={printTh}>Final</th>
              <th style={printTh}>Descriptor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, termGrades, finalGrade }) => (
              <tr key={c.id}>
                <td style={{ ...printTd, textAlign: "left" }}>{c.subject}</td>
                {termGrades.map((g, i) => <td key={i} style={{ ...printTd, textAlign: "center" }}>{g ?? "—"}</td>)}
                <td style={{ ...printTd, textAlign: "center", fontWeight: 700 }}>{finalGrade ?? "—"}</td>
                <td style={{ ...printTd, textAlign: "center" }}>{finalGrade ? descriptor(finalGrade) : "—"}</td>
              </tr>
            ))}
            <tr>
              <td style={{ ...printTd, fontWeight: 700 }} colSpan={rows[0].terms.length + 1}>General Average</td>
              <td style={{ ...printTd, textAlign: "center", fontWeight: 700 }}>{generalAverage ?? "—"}</td>
              <td style={{ ...printTd, textAlign: "center", fontWeight: 700 }}>{generalAverage ? descriptor(generalAverage) : "—"}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Attendance Record</div>
      {monthlyBreakdown.length === 0 ? (
        <div style={{ fontSize: 11, marginBottom: 12 }}>No homeroom attendance selected or recorded.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginBottom: 12 }}>
          <thead>
            <tr><th style={printTh}>Month</th><th style={printTh}>School Days</th><th style={printTh}>Present</th><th style={printTh}>Absent</th></tr>
          </thead>
          <tbody>
            {monthlyBreakdown.map((m) => (
              <tr key={m.ym}>
                <td style={printTd}>{monthLabel(m.ym)}</td>
                <td style={{ ...printTd, textAlign: "center" }}>{m.marked}</td>
                <td style={{ ...printTd, textAlign: "center" }}>{m.present}</td>
                <td style={{ ...printTd, textAlign: "center" }}>{m.absent}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td style={printTd}>Total</td>
              <td style={{ ...printTd, textAlign: "center" }}>{totalMarked}</td>
              <td style={{ ...printTd, textAlign: "center" }}>{totalPresent}</td>
              <td style={{ ...printTd, textAlign: "center" }}>{totalMarked - totalPresent}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Core Values</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginBottom: 12 }}>
        <thead>
          <tr><th style={{ ...printTh, textAlign: "left" }}>Behavior Statement</th><th style={printTh}>Rating</th></tr>
        </thead>
        <tbody>
          {DEFAULT_CORE_VALUES.map((cv) => (
            <React.Fragment key={cv.key}>
              <tr><td style={{ ...printTd, fontWeight: 700, background: "#f7f4e8" }} colSpan={2}>{cv.title}</td></tr>
              {cv.statements.map((st, i) => {
                const stKey = `${cv.key}:${i}`;
                return (
                  <tr key={stKey}>
                    <td style={{ ...printTd, textAlign: "left" }}>{st}</td>
                    <td style={{ ...printTd, textAlign: "center" }}>{coreValueRatings?.[stKey] || "—"}</td>
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 9, color: "#555", marginBottom: 12 }}>AO = Always Observed · SO = Sometimes Observed · RO = Rarely Observed · NO = Not Observed</div>

      <div style={{ fontSize: 10.5, marginBottom: 24 }}>General Remarks: <b>{remarks || "—"}</b></div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 30, fontSize: 10.5 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #333", width: 180, paddingTop: 4 }}>&nbsp;</div>
          <div style={{ fontSize: 9, color: "#555" }}>Adviser</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #333", width: 180, paddingTop: 4 }}>&nbsp;</div>
          <div style={{ fontSize: 9, color: "#555" }}>Parent / Guardian</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #333", width: 180, paddingTop: 4 }}>&nbsp;</div>
          <div style={{ fontSize: 9, color: "#555" }}>School Head</div>
        </div>
      </div>
    </div>
  );
}

/* ============================== LOGIN / AUTH GATE ============================== */
function LoginScreen({ onSignIn, error, busy }) {
  return (
    <div className="talaan-login">
      <style>{`
        .talaan-login { min-height: 100vh; display: flex; background: #0d0a1f; font-family: 'Segoe UI', system-ui, sans-serif; }
        .talaan-login-hero {
          flex: 1.1; position: relative; overflow: hidden; display: flex; flex-direction: column;
          justify-content: center; padding: 64px; color: #fff;
          background: radial-gradient(1200px 600px at 20% 10%, rgba(124,109,242,0.25), transparent 60%),
                      linear-gradient(135deg, #150e30 0%, #2a1a63 50%, #4630a0 100%);
        }
        .talaan-login-form { flex: 1; display: flex; align-items: center; justify-content: center; padding: 40px 24px; background: #120c28; }
        .talaan-shape { position: absolute; border-radius: 26px; background: linear-gradient(160deg, rgba(150,133,255,0.55), rgba(76,40,137,0.08)); }
        @media (max-width: 860px) { .talaan-login-hero { display: none; } }
      `}</style>

      <div className="talaan-login-hero">
        <div className="talaan-shape" style={{ width: 240, height: 300, top: "6%", right: "10%", transform: "rotate(18deg)" }} />
        <div className="talaan-shape" style={{ width: 170, height: 210, bottom: "8%", right: "26%", transform: "rotate(-14deg)", opacity: 0.55 }} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 400 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 48 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Georgia, serif", fontWeight: 700 }}>T</div>
            <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: 0.3 }}>Talaan</span>
          </div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 36, lineHeight: 1.25, marginBottom: 18 }}>
            Class records,<br />organized and<br />shared.
          </div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.62)", lineHeight: 1.7 }}>
            Grades, attendance, SF9, MPS, at anecdotal records ng iyong mga klase — lahat
            magkasama, madaling ibahagi sa kapwa guro.
          </div>
        </div>
      </div>

      <div className="talaan-login-form">
        <div style={{ width: "100%", maxWidth: 360 }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 27, color: "#fff", marginBottom: 6 }}>Welcome back</div>
          <div style={{ fontSize: 13.5, color: "rgba(255,255,255,0.55)", marginBottom: 34 }}>
            Mag-sign in gamit ang Google account ng paaralan para magpatuloy.
          </div>

          <button
            onClick={onSignIn}
            disabled={busy}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%",
              padding: "13px 16px", borderRadius: 999, border: "none",
              background: busy ? "rgba(255,255,255,0.5)" : "#fff",
              fontSize: 14.5, fontWeight: 600, color: "#1b1235", cursor: busy ? "not-allowed" : "pointer",
              boxShadow: "0 10px 26px rgba(76,40,137,0.45)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.1 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.1 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.6 35.4 26.9 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.6 5.1C9.6 39.6 16.3 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.6 5.6C41.9 35.9 44 30.4 44 24c0-1.3-.1-2.7-.4-3.5z" />
            </svg>
            {busy ? "Signing in…" : "Sign in with Google"}
          </button>

          {error && <div style={{ marginTop: 16, fontSize: 12.5, color: "#ff8fa3" }}>{error}</div>}

          <div style={{ marginTop: 30, fontSize: 11.5, color: "rgba(255,255,255,0.4)", lineHeight: 1.7 }}>
            Ang mga guro na gagamit ng parehong account type ay awtomatikong makakakita at
            makakapag-edit ng shared class records.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [authLoaded, setAuthLoaded] = useState(false);
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u && ALLOWED_EMAIL_DOMAIN && !u.email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
        setAuthError(`Gamitin ang iyong ${ALLOWED_EMAIL_DOMAIN} email para makapag-login.`);
        signOut(auth);
        setUser(null);
      } else {
        setUser(u);
        if (u) setAuthError("");
      }
      setAuthLoaded(true);
    });
    return () => unsub();
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError("");
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      setAuthError("Hindi na-sign in. Subukan ulit.");
      console.error(e);
    } finally {
      setSigningIn(false);
    }
  };

  if (!authLoaded) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: PAPER, fontFamily: "Georgia, serif", color: FOREST }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onSignIn={handleSignIn} error={authError} busy={signingIn} />;
  }

  return <TalaanApp user={user} />;
}
