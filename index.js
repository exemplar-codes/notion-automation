// Initializing a client
const notion = require("./setup.js");
const { updateRows } = require("./lib.js");

async function updateURLCopyLink(row, i, response) {
  const row = response.results[j];
  const properties = row.properties;
  const href = properties["Link"]?.rich_text?.[0]?.href ?? "";
  const url = properties["URL"]?.url ?? "";
  const finalUrl = url || href;
  if (!finalUrl || url) return;
  // console.log(
  //   row.id,
  //   row.properties.Name.title[0].plain_text,
  //   Object.keys(row)
  // );
  notion.pages.update({
    page_id: row.id,
    properties: {
      URL: { url: finalUrl },
    },
  });
}

updateRows(updateURLCopyLink);
