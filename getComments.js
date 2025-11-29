const { logger } = require("./setup.js");

const notion = require("./setup.js").notion;

/**
 * Retrieve recent comments across all pages in a database
 * @param {string} databaseId - Notion DB ID
 * @param {number} limit - max number of comments to return
 */

console.log(process.env.DATABASE_ID);
async function fetchDatabaseComments(
  databaseId = process.env.DATABASE_ID,
  limit = 50
) {
  console.log("====================================");
  console.log({ databaseId });
  console.log("====================================");
  const comments = [];

  // 1. Collect all pages in the database
  let cursor = undefined;
  const pageIds = [];

  while (true) {
    const res = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 50,
    });

    res.results.forEach((p) => pageIds.push(p.id));

    if (!res.has_more) break;
    cursor = res.next_cursor;
  }

  console.log({ pageIds });
  // 2. For each page, fetch its comments
  for (const pid of pageIds) {
    const cs = await notion.comments.list({ block_id: pid });

    for (const c of cs.results) {
      // if (comments.length > 5) break;
      comments.push({
        page_id: pid,
        comment_id: c.id,
        rich_text: c.rich_text,
        created_time: c.created_time,
        created_by: c.created_by,
      });
    }
  }

  // 3. Sort & truncate
  comments.sort((a, b) => new Date(b.created_time) - new Date(a.created_time));

  logger.info(JSON.stringify(comments, null, 2));

  return comments.slice(0, limit);
}

// fetchDatabaseComments();

module.exports = fetchDatabaseComments;
