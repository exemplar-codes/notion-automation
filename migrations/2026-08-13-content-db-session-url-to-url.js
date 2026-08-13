/**
 * Migration: content-db — copy session_url → URL (if URL empty), tag session_url_done,
 * optionally delete the session_url property.
 *
 * TASK-1354: In content-db, copy session_url to URL field (if its empty), and delete session_url
 *
 * Idempotency: successful writes set Tags += "session_url_done". Re-runs skip those.
 * Conflicts (both set and differ): skip — do not overwrite, do not tag.
 *
 * Usage (do not run until asked):
 *   pnpm i
 *   # NOTION_API_TOKEN is usually already in the shell via ~/.zshrc / ~/.env
 *   # optional: cp .env.example .env for local overrides
 *   # share content-db with the integration first
 *   node migrations/2026-08-13-content-db-session-url-to-url.js
 *   node migrations/2026-08-13-content-db-session-url-to-url.js --apply
 *   node migrations/2026-08-13-content-db-session-url-to-url.js --verify
 *   node migrations/2026-08-13-content-db-session-url-to-url.js --delete-property
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { notion } = require("../setup.js");
const { traverseRows, sleep, parseLimit } = require("../lib.js");

const DATABASE_ID =
  process.env.DATABASE_ID || "046335fc-56fe-4f8a-afd8-12bf4bc18205";
const SESSION_URL_PROP = "session_url";
const URL_PROP = "URL";
const TAGS_PROP = "Tags";
const DONE_TAG = "session_url_done";
const INTERVAL = Number(process.env.RATE_LIMITING_INTERVAL || 350);

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const VERIFY = args.has("--verify");
const DELETE_PROPERTY = args.has("--delete-property");

function titleOf(page) {
  const t = page.properties?.Name?.title;
  if (!Array.isArray(t) || t.length === 0) return "(untitled)";
  return t.map((x) => x.plain_text || "").join("") || "(untitled)";
}

function urlOf(page, prop) {
  return page.properties?.[prop]?.url || null;
}

function tagsOf(page) {
  const tags = page.properties?.[TAGS_PROP]?.multi_select;
  if (!Array.isArray(tags)) return [];
  return tags.map((t) => t.name).filter(Boolean);
}

function tagsPayloadWithDone(existingTagNames) {
  const names = new Set(existingTagNames);
  names.add(DONE_TAG);
  return { multi_select: [...names].map((name) => ({ name })) };
}

function classify(page) {
  const sessionUrl = urlOf(page, SESSION_URL_PROP);
  const url = urlOf(page, URL_PROP);
  const tags = tagsOf(page);
  const hasSession = Boolean(sessionUrl);
  const hasUrl = Boolean(url);

  if (!hasSession) return { action: "ignore", sessionUrl, url, tags };
  if (tags.includes(DONE_TAG)) return { action: "skip-done", sessionUrl, url, tags };
  if (!hasUrl) return { action: "copy", sessionUrl, url, tags };
  if (sessionUrl === url) return { action: "skip-same", sessionUrl, url, tags };
  return { action: "conflict", sessionUrl, url, tags };
}

function summarize(rows) {
  const counts = {
    copy: 0,
    "skip-same": 0,
    "skip-done": 0,
    conflict: 0,
    ignore: 0,
  };
  for (const r of rows) counts[r.action] = (counts[r.action] || 0) + 1;
  return counts;
}

async function ensureDbAccess() {
  try {
    const db = await notion.databases.retrieve({ database_id: DATABASE_ID });
    const props = db.properties || {};

    for (const name of [SESSION_URL_PROP, URL_PROP]) {
      if (!props[name]) {
        throw new Error(
          `Database missing property "${name}". Found: ${Object.keys(props).join(", ")}`
        );
      }
      if (props[name].type !== "url") {
        throw new Error(
          `Property "${name}" is type "${props[name].type}", expected "url"`
        );
      }
    }

    if (!props[TAGS_PROP] || props[TAGS_PROP].type !== "multi_select") {
      throw new Error(
        `Database missing multi_select property "${TAGS_PROP}" (needed for ${DONE_TAG}).`
      );
    }

    return db;
  } catch (err) {
    if (err.code === "object_not_found" || err.status === 404) {
      console.error(`
Cannot access content-db with this integration.

Share the database with your Notion integration:
  1. Open https://www.notion.so/${DATABASE_ID.replace(/-/g, "")}
  2. ••• → Connections → Connect to → your integration

Then re-run this script.
`);
    }
    throw err;
  }
}

/** Aggregate-only — safe to commit / push (no titles, URLs, or page ids). */
async function writeReport(counts, mode) {
  const dir = path.join(__dirname, "..", "reports");
  await fs.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${stamp}-${mode}.json`);
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode,
        databaseId: DATABASE_ID,
        doneTag: DONE_TAG,
        counts: {
          copy: counts.copy || 0,
          "skip-same": counts["skip-same"] || 0,
          "skip-done": counts["skip-done"] || 0,
          conflict: counts.conflict || 0,
          ignore: counts.ignore || 0,
          totalWithSessionUrl:
            (counts.copy || 0) +
            (counts["skip-same"] || 0) +
            (counts["skip-done"] || 0) +
            (counts.conflict || 0),
        },
      },
      null,
      2
    )
  );
  return file;
}

async function applyCopies(copyRows) {
  for (const row of copyRows) {
    await notion.pages.update({
      page_id: row.id,
      properties: {
        [URL_PROP]: { url: row.sessionUrl },
        [TAGS_PROP]: tagsPayloadWithDone(row.tags),
      },
    });
    console.log(`  copied+tagged → ${row.name}`);
    await sleep(INTERVAL);
  }
}

async function tagSkipSame(rows) {
  for (const row of rows) {
    await notion.pages.update({
      page_id: row.id,
      properties: {
        [TAGS_PROP]: tagsPayloadWithDone(row.tags),
      },
    });
    console.log(`  tagged skip-same → ${row.name}`);
    await sleep(INTERVAL);
  }
}

async function deleteSessionUrlProperty() {
  await notion.databases.update({
    database_id: DATABASE_ID,
    properties: {
      [SESSION_URL_PROP]: null,
    },
  });
}

async function main() {
  console.log(
    `Mode: ${
      DELETE_PROPERTY ? "delete-property" : APPLY ? "apply" : VERIFY ? "verify" : "dry-run"
    }`
  );

  await ensureDbAccess();
  console.log("content-db accessible ✓");

  const pages = await traverseRows({
    databaseId: DATABASE_ID,
    filter: {
      property: SESSION_URL_PROP,
      url: { is_not_empty: true },
    },
    rowWork: null,
    limit: Infinity,
  });

  const rows = pages.map((page) => ({
    id: page.id,
    name: titleOf(page),
    ...classify(page),
  }));

  const counts = summarize(rows);
  console.log("\nClassification:");
  console.log(`  copy         ${counts.copy}`);
  console.log(`  skip-same    ${counts["skip-same"]}`);
  console.log(`  skip-done    ${counts["skip-done"]}  (tag: ${DONE_TAG})`);
  console.log(`  conflict     ${counts.conflict}`);
  console.log(`  total w/ session_url  ${pages.length}`);

  if (counts.conflict > 0) {
    console.log("\nConflicts (skipped — URL left as-is, not tagged):");
    for (const r of rows.filter((x) => x.action === "conflict")) {
      console.log(`  - ${r.name}`);
      console.log(`      URL:         ${r.url}`);
      console.log(`      session_url: ${r.sessionUrl}`);
    }
  }

  const mode = DELETE_PROPERTY
    ? "delete-property"
    : APPLY
      ? "apply"
      : VERIFY
        ? "verify"
        : "dry-run";
  const reportPath = await writeReport(counts, mode);
  console.log(`\nReport: ${reportPath}`);

  if (VERIFY) {
    if (counts.copy > 0) {
      console.error(`\nVERIFY FAILED: ${counts.copy} untagged row(s) still need copy.`);
      process.exit(1);
    }
    console.log("\nVERIFY OK: no untagged rows need copy.");
    return;
  }

  if (DELETE_PROPERTY) {
    if (counts.copy > 0) {
      console.error(
        `\nRefusing --delete-property: ${counts.copy} row(s) still need copy. Run --apply first.`
      );
      process.exit(1);
    }
    if (counts.conflict > 0) {
      console.log(
        `\nNote: ${counts.conflict} conflict row(s) will lose session_url data (URL kept).`
      );
    }
    console.log("\nDeleting session_url property…");
    await deleteSessionUrlProperty();
    console.log("Deleted session_url ✓");
    return;
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to copy+tag, then --delete-property.");
    return;
  }

  const rowLimit = parseLimit(process.env.ROW_LIMIT);
  let toCopy = rows.filter((r) => r.action === "copy");
  let toTagSame = rows.filter((r) => r.action === "skip-same");

  if (Number.isFinite(rowLimit)) {
    console.log(`ROW_LIMIT=${rowLimit} — capping apply work`);
    toCopy = toCopy.slice(0, rowLimit);
    const remaining = Math.max(0, rowLimit - toCopy.length);
    toTagSame = toTagSame.slice(0, remaining);
  }

  if (toCopy.length === 0 && toTagSame.length === 0) {
    console.log("\nNothing to apply (all done, conflict-only, or empty).");
    return;
  }

  if (toCopy.length > 0) {
    console.log(`\nApplying ${toCopy.length} copy+tag…`);
    await applyCopies(toCopy);
  }

  if (toTagSame.length > 0) {
    console.log(`\nTagging ${toTagSame.length} skip-same as ${DONE_TAG}…`);
    await tagSkipSame(toTagSame);
  }

  console.log(
    "Done. Safe to re-run --apply (skips session_url_done). Then run with --verify."
  );
}

main().catch((err) => {
  console.error(err.body || err.message || err);
  process.exit(1);
});
