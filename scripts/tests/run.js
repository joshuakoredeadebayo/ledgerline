/*
 * Ledgerline regression tests. Run with:  npm test
 *
 * They check the logic that must never silently break: money arithmetic, dates, imports, and the daily job's
 * behaviour at scale (many organizations, overlapping runs, a cut-off run resuming). No database or network is
 * needed; the job is exercised against an in-memory stand-in.
 *
 * Add a test here whenever you fix a bug, so it can't come back.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const Module = require("module");

const root = path.resolve(__dirname, "../..");
const out = path.join(os.tmpdir(), "ledgerline-tests");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// ── compile the pure TypeScript modules with the compiler that ships with the project ──
const sucrase = require(path.join(root, "node_modules/sucrase"));
const compiled = {};
for (const f of ["recurring", "recurring-engine", "fetch-all", "vat", "journal-math", "balance-rec", "statement-import", "csv", "cron/maintenance"]) {
  const src = fs.readFileSync(path.join(root, "lib", `${f}.ts`), "utf8");
  const file = path.join(out, f.replace("/", "__") + ".js");
  fs.writeFileSync(file, sucrase.transform(src, { transforms: ["typescript", "imports"] }).code);
  compiled[f] = file;
}
const stubNotify = path.join(out, "notify-stub.js");
const notes = [];
fs.writeFileSync(stubNotify, "module.exports={notify:async(_s,i)=>{global.__notes.push(i)}}");
global.__notes = notes;
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const map = { "@/lib/recurring": "recurring", "@/lib/fetch-all": "fetch-all", "@/lib/vat": "vat" };
  if (map[request]) return compiled[map[request]];
  if (request === "@/lib/notifications") return stubNotify;
  return original.call(this, request, ...rest);
};
const L = (name) => require(compiled[name]);

// ── a tiny test runner ──
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ═══ Schedules ═══
const S = (o) => ({ frequency: "monthly", intervalCount: 1, dayOfMonth: null, weekday: null, startDate: "2026-01-01", endDate: null, ...o });

test("recurring: month-end days fall on the last day of shorter months", () => {
  const r = L("recurring");
  assert.deepStrictEqual(r.upcomingDates(S({ dayOfMonth: 31, startDate: "2026-01-15" }), "2026-01-15", 4), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepStrictEqual(r.upcomingDates(S({ dayOfMonth: 30, startDate: "2027-01-01" }), "2027-01-01", 3), ["2027-01-30", "2027-02-28", "2027-03-30"]);
});
test("recurring: leap years", () => {
  const r = L("recurring");
  assert.deepStrictEqual(r.upcomingDates(S({ dayOfMonth: 29, startDate: "2028-01-01" }), "2028-01-01", 3), ["2028-01-29", "2028-02-29", "2028-03-29"]);
  assert.deepStrictEqual(r.upcomingDates(S({ frequency: "yearly", dayOfMonth: 29, startDate: "2028-02-29" }), "2028-02-29", 3), ["2028-02-29", "2029-02-28", "2030-02-28"]);
});
test("recurring: quarterly, every N months, weekly and fortnightly", () => {
  const r = L("recurring");
  assert.deepStrictEqual(r.upcomingDates(S({ frequency: "quarterly", dayOfMonth: 15, startDate: "2026-02-01" }), "2026-02-01", 3), ["2026-02-15", "2026-05-15", "2026-08-15"]);
  assert.deepStrictEqual(r.upcomingDates(S({ intervalCount: 2, dayOfMonth: 1 }), "2026-01-01", 3), ["2026-01-01", "2026-03-01", "2026-05-01"]);
  assert.deepStrictEqual(r.upcomingDates(S({ frequency: "weekly", weekday: 5, startDate: "2026-11-05" }), "2026-11-05", 3), ["2026-11-06", "2026-11-13", "2026-11-20"]);
  assert.deepStrictEqual(r.upcomingDates(S({ frequency: "weekly", intervalCount: 2, weekday: 1, startDate: "2026-11-05" }), "2026-11-05", 3), ["2026-11-09", "2026-11-23", "2026-12-07"]);
});
test("recurring: end dates stop the schedule", () => {
  const r = L("recurring");
  const s = S({ dayOfMonth: 1, endDate: "2026-03-15" });
  assert.deepStrictEqual(r.upcomingDates(s, "2026-01-01", 10), ["2026-01-01", "2026-02-01", "2026-03-01"]);
  assert.strictEqual(r.nextRunDate(s, "2026-03-01"), null);
});
test("recurring: 'what's next' agrees with an independent day-by-day check on 600 random schedules, and stays fast on old ones", () => {
  const r = L("recurring");
  let seed = 98765;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const add = (d, n) => { const p = new Date(d + "T00:00:00Z"); p.setUTCDate(p.getUTCDate() + n); return p.toISOString().slice(0, 10); };
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const isOcc = (s, d) => {
    if (d < s.startDate || (s.endDate && d > s.endDate)) return false;
    const [y, m, day] = d.split("-").map(Number), [sy, sm, sd] = s.startDate.split("-").map(Number);
    if (s.frequency === "weekly") {
      const dt = new Date(d + "T00:00:00Z"), st = new Date(s.startDate + "T00:00:00Z");
      const first = new Date(st); first.setUTCDate(first.getUTCDate() + ((s.weekday - st.getUTCDay() + 7) % 7));
      if (dt < first || dt.getUTCDay() !== s.weekday) return false;
      return Math.round((dt - first) / 86400000 / 7) % s.intervalCount === 0;
    }
    const step = { monthly: 1, quarterly: 3, yearly: 12 }[s.frequency] * s.intervalCount;
    const apart = (y * 12 + m) - (sy * 12 + sm);
    if (apart < 0 || apart % step !== 0) return false;
    const want = s.dayOfMonth ?? sd;
    return day === (want >= 31 ? dim(y, m) : Math.min(want, dim(y, m)));
  };
  for (let i = 0; i < 600; i++) {
    const frequency = ["weekly", "monthly", "quarterly", "yearly"][ri(0, 3)];
    const s = { frequency, intervalCount: ri(1, 4), dayOfMonth: frequency === "weekly" ? null : ri(1, 31), weekday: frequency === "weekly" ? ri(0, 6) : null,
      startDate: iso(ri(2024, 2026), ri(1, 12), ri(1, 28)), endDate: rnd() < 0.3 ? iso(ri(2027, 2029), ri(1, 12), ri(1, 28)) : null };
    const after = iso(ri(2024, 2030), ri(1, 12), ri(1, 28));
    let expected = null;
    // Far enough to reach a yearly schedule's next date even when it starts years after `after` and repeats every few years.
    for (let k = 1; k <= 3700 && !expected; k++) { const d = add(after, k); if (isOcc(s, d)) expected = d; }
    assert.strictEqual(r.nextRunDate(s, after), expected, JSON.stringify({ s, after }));
  }
  const old = S({ frequency: "weekly", weekday: 5, startDate: "1900-01-05" });
  const t0 = Date.now();
  for (let i = 0; i < 20000; i++) r.nextRunDate(old, "2026-11-12");
  assert.ok(Date.now() - t0 < 1500, "nextRunDate must stay fast however old the schedule is");
});

// ═══ VAT ═══
test("vat: 7.5% splits exactly, for every amount from 0.01 to 5,000.00", () => {
  const v = L("vat");
  const g = v.vatFromGross(15000000, 750);
  assert.deepStrictEqual([g.netCents, g.vatCents], [13953488, 1046512]);
  for (let c = 1; c <= 500000; c++) {
    const x = v.vatFromGross(c, 750);
    assert.strictEqual(x.netCents + x.vatCents, c);
    assert.ok(Math.abs(x.vatCents - (c * 750) / 10750) <= 0.5000001);
  }
  assert.strictEqual(v.vatFromNet(20, 750).vatCents, 2); // 0.015 rounds half up
  assert.strictEqual(v.vatFromGross(999999999999999, 750).netCents + v.vatFromGross(999999999999999, 750).vatCents, 999999999999999);
});
test("vat: a sale's lines balance, and a tampered VAT line is caught", () => {
  const v = L("vat");
  const b = v.buildVatLines({ kind: "sale", categoryId: "professional", amountCents: 15000000, inclusive: true, ratePercent: 7.5, registered: true, settlementAccountId: "bank", mainAccountId: "rev", outputVatAccountId: "ov", inputVatAccountId: "iv" });
  assert.deepStrictEqual(v.checkVatConsistency(b.lines, "ov", "iv"), []);
  const t = b.lines.map((l) => ({ ...l })); t[2].credit = 10000;
  assert.ok(v.checkVatConsistency(t, "ov", "iv").length > 0);
});

// ═══ Journal and balance rules ═══
test("journal: debits must equal credits to the cent (0.1 + 0.2 = 0.3)", () => {
  const j = L("journal-math");
  assert.ok(j.checkJournalLines([{ accountId: "a", debit: 0.1 }, { accountId: "b", debit: 0.2 }, { accountId: "c", credit: 0.3 }]).ok);
  assert.ok(!j.checkJournalLines([{ accountId: "a", debit: 25 }, { accountId: "b", credit: 20 }]).ok);
  assert.ok(!j.checkJournalLines([{ accountId: "a", debit: 25 }]).ok);
});
test("balance reconciliation: cash and card examples reconcile; a missing item shows the gap", () => {
  const b = L("balance-rec");
  const it = (id, side, amount) => ({ id, side, amount, date: "2026-08-20", description: id });
  assert.ok(b.computeBalanceRec({ kind: "cash", statementClosing: 1000, bookClosing: 925, items: [it("f", "bank", 25), it("c", "ledger", 100)] }).reconciled);
  assert.ok(b.computeBalanceRec({ kind: "card", statementClosing: 500, bookClosing: 540, items: [it("a", "ledger", 50), it("b", "bank", 10)] }).reconciled);
  assert.strictEqual(b.computeBalanceRec({ kind: "cash", statementClosing: 1000, bookClosing: 925, items: [it("c", "ledger", 100), it("f", "bank", 17.5)] }).difference, -7.5);
});

// ═══ Statement import and CSV ═══
test("statement import: preamble, footer, quoted commas, balances, date order", () => {
  const m = L("statement-import");
  const csv = 'Account Statement\nPeriod,Aug\n\nTrans. Date,Description,Debit,Credit,Balance\n2026-08-03,"Transfer, to A","25,000.00",,"475,000.00"\n2026-08-05,Airtime,500.00,,"474,500.00"\n2026-08-05,Airtime,500.00,,"474,000.00"\n,Total,"26,000.00",,\n';
  const rows = m.parseDelimited(csv);
  const settings = m.guessSettings(rows);
  const r = m.normalizeRows(rows, settings);
  assert.strictEqual(r.rows.length, 3);
  assert.strictEqual(r.problems.length, 0);
  assert.deepStrictEqual(r.rows.map((x) => x.amount), [25000, 500, 500]);
  assert.deepStrictEqual(r.rows.map((x) => x.occurrence), [0, 0, 1]);
  assert.strictEqual(m.detectDateFormat(["25/04/2026", "05/06/2026"]).format, "dmy");
  assert.strictEqual(m.detectDateFormat(["04/25/2026"]).format, "mdy");
  assert.strictEqual(m.parseAmountCell("(1,000.50)", "."), -1000.5);
});
test("csv: text that spreadsheets would run as a formula is neutralised, numbers are left alone", () => {
  const c = L("csv");
  assert.strictEqual(c.csvCell("=cmd|x"), "'=cmd|x");
  assert.strictEqual(c.csvCell(-500), "-500");
});

// ═══ The daily job at scale ═══
function makeDb(seed) {
  const t = { recurring_templates: [], recurring_runs: [], journal_entries: [], journal_entry_lines: [], accounts: [], organizations: [], organization_members: [], ...seed };
  const byId = {}; const runKey = new Set(); let n = 1; const id = () => "id" + n++;
  const idx = (table) => byId[table] ?? (byId[table] = new Map(t[table].map((r) => [r.id, r])));
  const stats = { queries: 0, clock: 0 };
  function from(table) {
    stats.queries++; stats.clock++;
    const st = { op: "select", filters: [], payload: null, one: false, opts: null, orders: [], range: null };
    const match = (r) => st.filters.every(([k, op, v]) => (op === "eq" ? r[k] === v : op === "lte" ? r[k] <= v : op === "in" ? v.includes(r[k]) : op === "notnull" ? r[k] != null : true));
    const run = () => {
      const rows = t[table];
      const idEq = st.filters.find((f) => f[0] === "id" && f[1] === "eq");
      if (st.op === "select") {
        let o = idEq ? [idx(table).get(idEq[2])].filter(Boolean).filter(match) : rows.filter(match);
        for (const [k, asc] of [...st.orders].reverse()) o = [...o].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1));
        if (st.range) o = o.slice(st.range[0], st.range[1] + 1);
        return st.one ? { data: o[0] ?? null, error: null } : { data: o, error: null };
      }
      if (st.op === "insert") {
        const list = Array.isArray(st.payload) ? st.payload : [st.payload]; const made = [];
        for (const p of list) {
          const row = { id: id(), ...p };
          if (table === "recurring_runs") { const k = row.template_id + "|" + row.run_date; if (runKey.has(k)) return { data: null, error: { code: "23505", message: "duplicate key" } }; runKey.add(k); }
          rows.push(row); idx(table).set(row.id, row); made.push(row);
        }
        return { data: st.one ? made[0] : made, error: null };
      }
      if (st.op === "upsert") {
        const p = st.payload;
        if (table === "recurring_runs") { const ex = rows.find((r) => r.template_id === p.template_id && r.run_date === p.run_date); if (ex) Object.assign(ex, p); else { runKey.add(p.template_id + "|" + p.run_date); const row = { id: id(), ...p }; rows.push(row); idx(table).set(row.id, row); } }
        return { data: [p], error: null };
      }
      if (st.op === "update") { const hit = idEq ? [idx(table).get(idEq[2])].filter(Boolean) : rows.filter(match); hit.forEach((r) => Object.assign(r, st.payload)); return { data: hit, error: null }; }
      if (st.op === "delete") {
        if (idEq) { const row = idx(table).get(idEq[2]); if (row) { idx(table).delete(row.id); const i = rows.indexOf(row); if (i >= 0) rows.splice(i, 1); if (table === "recurring_runs") runKey.delete(row.template_id + "|" + row.run_date); } return { data: null, error: null }; }
        t[table] = rows.filter((r) => !match(r)); return { data: null, error: null };
      }
    };
    const b = {
      select() { return b; }, insert(p) { st.op = "insert"; st.payload = p; return b; }, upsert(p, o) { st.op = "upsert"; st.payload = p; st.opts = o; return b; },
      update(p) { st.op = "update"; st.payload = p; return b; }, delete() { st.op = "delete"; return b; },
      eq(k, v) { st.filters.push([k, "eq", v]); return b; }, lte(k, v) { st.filters.push([k, "lte", v]); return b; }, in(k, v) { st.filters.push([k, "in", v]); return b; }, not(k) { st.filters.push([k, "notnull"]); return b; },
      order(k, o) { st.orders.push([k, o?.ascending !== false]); return b; }, range(a, c) { st.range = [a, c]; return b; }, single() { st.one = true; return b; }, maybeSingle() { st.one = true; return b; },
      then(res, rej) { Promise.resolve().then(() => { try { res(run()); } catch (e) { rej && rej(e); } }); },
    };
    return b;
  }
  return { t, from, stats };
}
function seedBig(nTemplates, nOrgs) {
  const accounts = [], organizations = [], organization_members = [], recurring_templates = [];
  for (let o = 0; o < nOrgs; o++) {
    organizations.push({ id: "O" + o, name: "Org " + o });
    organization_members.push({ id: "M" + o, organization_id: "O" + o, user_id: "U" + o, role: "owner", joined_at: "x" });
    accounts.push({ id: "A" + o + "x", name: "Expense", entity_id: "E" + o, archived_at: null }, { id: "A" + o + "y", name: "Bank", entity_id: "E" + o, archived_at: null });
  }
  for (let i = 0; i < nTemplates; i++) {
    const o = i % nOrgs;
    recurring_templates.push({ id: "T" + i, organization_id: "O" + o, entity_id: "E" + o, name: "Rent " + i, description: "d", frequency: "monthly", interval_count: 1, day_of_month: 1, weekday: null, start_date: "2026-11-01", end_date: null,
      next_run_date: "2026-11-01", lead_days: 0, status: "active", created_by: "U" + o, lines: [{ accountId: "A" + o + "x", debit: 100, credit: 0 }, { accountId: "A" + o + "y", debit: 0, credit: 100 }] });
  }
  return { accounts, organizations, organization_members, recurring_templates };
}
const run = (db, opts) => L("recurring-engine").runDueTemplates(db, { today: "2026-11-12", ...opts });

test("daily job: 2,000 due templates across 400 organizations use a small, constant number of database calls each, and a repeat run does nothing", async () => {
  const db = makeDb(seedBig(2000, 400));
  const r = await run(db, {});
  assert.strictEqual(r.created, 2000);
  assert.strictEqual(db.t.journal_entries.length, 2000);
  assert.ok(db.stats.queries / 2000 < 14, `too many calls per template: ${db.stats.queries / 2000}`);
  const before = db.t.journal_entries.length;
  assert.strictEqual((await run(db, {})).created, 0);
  assert.strictEqual(db.t.journal_entries.length, before);
});
test("daily job: a run cut off by its time budget leaves the rest due, and the next run finishes with no duplicates", async () => {
  const db = makeDb(seedBig(2000, 400));
  const realNow = Date.now; Date.now = () => db.stats.clock;
  let r1; try { r1 = await run(db, { deadlineAt: 3000 }); } finally { Date.now = realNow; }
  assert.ok(r1.timedOut && r1.created > 0 && r1.deferred > 0);
  assert.strictEqual(r1.created + r1.deferred, 2000);
  await run(db, {});
  assert.strictEqual(db.t.journal_entries.length, 2000);
});
test("daily job: two runs at the same moment never prepare the same draft twice", async () => {
  const db = makeDb(seedBig(1500, 150));
  await Promise.all([run(db, {}), run(db, {})]);
  assert.strictEqual(db.t.journal_entries.length, 1500);
  const keys = new Set(db.t.recurring_runs.map((x) => x.template_id + "|" + x.run_date));
  assert.strictEqual(keys.size, db.t.recurring_runs.length);
  assert.strictEqual(db.t.journal_entries.filter((e) => !db.t.recurring_runs.some((x) => x.entry_id === e.id)).length, 0);
});
test("daily job: one organization's problem never holds up the others, and a later retry succeeds", async () => {
  const db = makeDb(seedBig(1000, 100));
  for (let o = 0; o < 100; o += 7) db.t.accounts.find((x) => x.id === "A" + o + "x").archived_at = "2026-01-01";
  const bad = Math.ceil(100 / 7) * 10;
  const r = await run(db, {});
  assert.strictEqual(r.failed, bad);
  assert.strictEqual(r.created, 1000 - bad);
  db.t.accounts.forEach((x) => (x.archived_at = null));
  const fixed = await run(db, { today: "2026-11-13" });
  assert.strictEqual(fixed.created, bad);
  assert.strictEqual(db.t.journal_entries.length, 1000);
});
test("daily job: catching up after a long gap is capped per run, and never touches paused templates", async () => {
  const db = makeDb(seedBig(1, 1));
  Object.assign(db.t.recurring_templates[0], { start_date: "2020-01-01", next_run_date: "2020-01-01" });
  const r = await run(db, { maxPerTemplate: 12 });
  assert.strictEqual(r.created, 12);
  const db2 = makeDb(seedBig(5, 1)); db2.t.recurring_templates.forEach((t) => (t.status = "paused"));
  assert.strictEqual((await run(db2, {})).created, 0);
});
test("housekeeping: old read notifications and old job-log rows are removed in batches; unread and recent ones stay", async () => {
  const { pruneOldRows } = L("cron/maintenance");
  const day = 86400000, now = Date.now();
  const tables = { notifications: [], job_runs: [] };
  for (let i = 0; i < 2300; i++) tables.notifications.push({ id: "n" + i, read_at: i % 2 ? "x" : null, created_at: new Date(now - (i % 3 === 0 ? 200 : 10) * day).toISOString() });
  for (let i = 0; i < 50; i++) tables.job_runs.push({ id: "j" + i, ran_at: new Date(now - (i < 20 ? 400 : 5) * day).toISOString() });
  const expected = tables.notifications.filter((n) => n.read_at && n.created_at < new Date(now - 90 * day).toISOString()).length;
  const admin = { from: (t) => { const st = { f: [], op: "select", lim: 1e9, ids: null }; const b = {
    select() { return b; }, not(k) { st.f.push((r) => r[k] != null); return b; }, lt(k, v) { st.f.push((r) => r[k] < v); return b; }, limit(n) { st.lim = n; return b; },
    delete() { st.op = "delete"; return b; }, in(k, v) { st.ids = new Set(v); return b; },
    then(res) { Promise.resolve().then(() => { if (st.op === "select") res({ data: tables[t].filter((r) => st.f.every((f) => f(r))).slice(0, st.lim), error: null }); else { tables[t] = tables[t].filter((r) => !st.ids.has(r.id)); res({ error: null }); } }); } }; return b; } };
  const r = await pruneOldRows(admin, Date.now() + 10000);
  assert.strictEqual(r.notifications, expected);
  assert.strictEqual(r.jobRuns, 20);
  assert.strictEqual(tables.notifications.filter((n) => !n.read_at).length, 1150);
});

// ── run them ──
(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    const t0 = Date.now();
    try { await fn(); console.log(`  PASS  ${name} (${Date.now() - t0} ms)`); }
    catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${String(e.message).split("\n")[0].slice(0, 300)}`); }
  }
  console.log(`\n${tests.length - failed} of ${tests.length} passed${failed ? `, ${failed} FAILED` : ""}.`);
  process.exit(failed ? 1 : 0);
})();
