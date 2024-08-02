const notion = require("./setup.js");

const updateRows = async (
  rowWork = console.log,
  limit = process.env.ROW_LIMIT || Infinity,
  interval = process.env.RATE_LIMITING_INTERVAL
) => {
  let cursor = undefined,
    hasMore = true,
    i = 0;
  const databaseId = process.env.DATABASE_ID;

  while (hasMore && i < limit) {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        and: [
          {
            property: "Link",
            rich_text: {
              is_not_empty: true,
            },
          },
          {
            property: "URL",
            url: {
              is_empty: true,
            },
          },
        ],
      },
      sorts: [
        {
          property: "Created time",
          direction: "descending",
        },
      ],
    });
    cursor = response.cursor;
    hasMore = response.has_more;

    for (let j = 0; j < response.results.length && i < limit; j++, i++) {
      await rowWork(response.results[j], i, response);
      await new Promise((resolve, reject) => setTimeout(resolve, interval));
    }
  }
};

module.exports = updateRows;
