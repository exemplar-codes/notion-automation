// Initializing a client
const notion = require("./setup.js");
const { traverseRows } = require("./lib.js");

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

const DATA = [
  "https://www.geeksforgeeks.org/problems/construct-tree-from-inorder-and-levelorder/1",
  "https://www.geeksforgeeks.org/problems/detect-cycle-in-a-directed-graph/1",
  "https://www.geeksforgeeks.org/problems/minimum-spanning-tree/1",
  "https://www.geeksforgeeks.org/problems/union-find/1",
  "https://www.geeksforgeeks.org/problems/implementing-dijkstra-set-1-adjacency-matrix/1",
  "https://www.geeksforgeeks.org/problems/strongly-connected-components-kosarajus-algo/1",
  "https://leetcode.com/problems/remove-linked-list-elements/",
  "https://leetcode.com/problems/binary-tree-level-order-traversal/",
  "https://leetcode.com/problems/construct-binary-tree-from-inorder-and-postorder-traversal/",
  "https://leetcode.com/problems/construct-binary-tree-from-preorder-and-postorder-traversal/ ",
  "https://leetcode.com/problems/construct-binary-tree-from-preorder-and-inorder-traversal/",
  "https://leetcode.com/problems/balance-a-binary-search-tree",
  "https://leetcode.com/problems/search-in-a-binary-search-tree/",
  "https://leetcode.com/problems/count-complete-tree-nodes/",
  "https://leetcode.com/problems/check-completeness-of-a-binary-tree/",
  "https://leetcode.com/problems/find-the-length-of-the-longest-common-prefix/",
  "https://leetcode.com/problems/implement-trie-prefix-tree/",
  "https://leetcode.com/problems/design-add-and-search-words-data-structure/",
  "https://leetcode.com/problems/is-graph-bipartite",
];
async function insertData(data = []) {
  for (let i = 0; i < data.length; i++) {
    const datum = data[i];
    await notion.pages.create({
      parent: {
        type: "database_id",
        database_id: process.env.DATABASE_ID,
      },
      properties: {
        URL: { url: datum },
      },
    });
  }
}

// traverseRows(updateURLCopyLink);
// insertData(DATA);
