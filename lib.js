const { notion } = require("./setup.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseLimit(value) {
  if (value === undefined || value === null || value === "") return Infinity;
  const n = Number(value);
  return Number.isFinite(n) ? n : Infinity;
}

/**
 * Paginate databases.query and optionally run rowWork on each row.
 *
 * @param {object} options
 * @param {string} [options.databaseId=process.env.DATABASE_ID]
 * @param {object} [options.filter]
 * @param {object[]} [options.sorts]
 * @param {(row: object, index: number, response: object) => Promise<void>|void} [options.rowWork]
 * @param {number|string} [options.limit=process.env.ROW_LIMIT]
 * @param {number|string} [options.interval=process.env.RATE_LIMITING_INTERVAL]
 * @returns {Promise<object[]>} all collected rows (capped by limit)
 */
async function traverseRows({
  databaseId = process.env.DATABASE_ID,
  filter,
  sorts,
  rowWork,
  limit = process.env.ROW_LIMIT,
  interval = process.env.RATE_LIMITING_INTERVAL || 350,
} = {}) {
  if (!databaseId) throw new Error("DATABASE_ID is required");

  const max = parseLimit(limit);
  const delayMs = Number(interval) || 350;

  let cursor = undefined;
  let hasMore = true;
  let i = 0;
  const all = [];

  while (hasMore && i < max) {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: cursor,
      page_size: 100,
      ...(filter ? { filter } : {}),
      ...(sorts ? { sorts } : {}),
    });

    for (let j = 0; j < response.results.length && i < max; j++, i++) {
      const row = response.results[j];
      all.push(row);
      if (rowWork) {
        await rowWork(row, i, response);
        await sleep(delayMs);
      }
    }

    hasMore = Boolean(response.has_more);
    cursor = response.next_cursor || undefined;
    if (hasMore && !rowWork) await sleep(delayMs);
  }

  return all;
}

module.exports = { traverseRows, sleep, parseLimit };
