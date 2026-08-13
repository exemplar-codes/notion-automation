/**
 * Scratch / ad-hoc entrypoint. Prefer adding lasting jobs under migrations/.
 *
 * Example — copy Link (rich_text href) → URL when URL is empty:
 *
 *   node --env-file=.env index.js
 */

const { notion } = require("./setup.js");
const { traverseRows } = require("./lib.js");

async function updateURLCopyLink(row) {
  const properties = row.properties;
  const href = properties["Link"]?.rich_text?.[0]?.href ?? "";
  const url = properties["URL"]?.url ?? "";
  const finalUrl = url || href;
  if (!finalUrl || url) return;

  await notion.pages.update({
    page_id: row.id,
    properties: {
      URL: { url: finalUrl },
    },
  });
  console.log(`updated ${row.id} → ${finalUrl}`);
}

async function main() {
  await traverseRows({
    filter: {
      and: [
        { property: "Link", rich_text: { is_not_empty: true } },
        { property: "URL", url: { is_empty: true } },
      ],
    },
    sorts: [{ property: "Created time", direction: "descending" }],
    rowWork: updateURLCopyLink,
  });
}

// Opt-in: uncomment to run the Link→URL helper against DATABASE_ID
// main().catch((err) => {
//   console.error(err.body || err.message || err);
//   process.exit(1);
// });

module.exports = { updateURLCopyLink, main };
