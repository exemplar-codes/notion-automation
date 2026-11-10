// rename BAK to ZIP, extract it, rename it "readera-unzipped-bak" and move it to current folder
// then run "node ."
// books.json is produced
const fs = require("fs");
const books_coll = require("./readera-unzipped-bak/docs_1.json");
const collection_tags = require("./readera-unzipped-bak/colls.json");

const EXPORT_TO_JSON = true;
const UPLOAD_WITH_DEDUP = true;
const books = new Map();
books_coll.forEach((book, index) => {
  books.set(book.uri, book);
});
const unfound_books = new Set();
collection_tags.forEach((coll, index) => {
  const tag = coll.data.coll_title;
  const collection_book_ids = coll.docs;
  collection_book_ids.forEach((book_id) => {
    const book = books.get(book_id);
    if (!book) {
      unfound_books.add(book_id);
      // console.log("Not found book", book_id);
      return;
    }

    book.tags = book.tags || [];
    if (
      -1 ==
      book.tags.findIndex(
        (book_tag) => book_tag.toLocaleLowerCase() == tag.toLocaleLowerCase(),
      )
    ) {
      book.tags.push(tag);
    }

    console.log(book);
    books.set(book_id, book);
  });
});

// console.log("Book map size", books.size);

const exportable_books = [];
let skipped_books = [];
const seen_books = new Set();
books.entries().forEach(([book_id, book]) => {
  const formed_book = {
    id: book_id,
    name: book.data.doc_file_name_title,
    author: book.data.doc_authors,
    tags: book.tags, // can be used to set activity later on
    current_page: JSON.parse(book.data.doc_position).page,
    // total_pages: JSON.parse(book.data.doc_position).pagesCount,
    ...(book?.links?.[0]?.link_uri &&
    book?.links?.[0]?.link_uri.startsWith("gdrive:")
      ? {
          URL: `https://drive.google.com/file/d/${book.links[0].link_uri.replace("gdrive:", "")}`,
        }
      : {}),
    status: !JSON.parse(book.data.doc_position).page
      ? "Todo"
      : JSON.parse(book.data.doc_position).page <
          JSON.parse(book.data.doc_position).pagesCount
        ? "Paused"
        : "Done",
    bookmarks: book.bookmarks || [],
    citations: book.citations || [],
  };

  const NUMBERS = "0123456789".split("");
  const skip_school_book = formed_book.tags?.some((term) =>
    term
      .split("")
      .some(
        (title_letter) => -1 != NUMBERS.findIndex((num) => title_letter == num),
      ),
  );
  if (!formed_book.author) {
    formed_book.author = formed_book.name.split(" - ")[0];
    // formed_book.name = formed_book.name.split(" - ")[1];
  }

  if (seen_books.has(formed_book.name) || skip_school_book) {
    skipped_books.push(formed_book.name);
    return;
  }
  seen_books.add(formed_book.name);

  //   console.log(formed_book);
  exportable_books.push(formed_book);
  //   return formed_book;
});

console.log("Skipped books", skipped_books);
console.log(
  "Skipped books with names",
  skipped_books.filter((item) => !!item),
);

console.log("Books not found count", unfound_books.size);

// export to BOOKS.JSON
if (EXPORT_TO_JSON) {
  console.log("Exporting to json ...");
  const jsonString = JSON.stringify(exportable_books, null, 2);
  fs.writeFileSync("books.json", jsonString, "utf-8");
  console.log(
    "Export finished, total books",
    exportable_books.length,
    "at",
    "books.json",
  );
}

const sample_output = {
  id: "sha-1:fb82efd5412cbe18d2c8fcce7863de15cbdd3b64",
  name: "Chip Huyen - AI Engineering_ Building Applications with Foundation Models-O'Reilly Media (2025)",
  author: "Chip Huyen",
  tags: ["AIML"],
  current_page: 505,
  URL: "https://drive.google.com/file/d/1rvxUiEAVAfakL0QlAm5-GjxCW_oPXte5",
  status: "Paused",
  bookmarks: [
    {
      note_type: 2,
      note_uri: "d5f02f7d-4769-4e54-a893-7a3e7b7340a7",
      note_body: "Bookmark 1",
      note_data:
        '{"ratio":0.08052434456928839,"configHash":516122736,"page":43,"pagesCount":535,"offsetX":-0.01809295266866684,"offsetY":0,"zoom":1,"originPage":43,"pageEnd":-1,"version":2}',
      note_index: 0.08052434772253036,
      note_page: 43,
      note_insert_time: 1742902981752,
      note_modified_time: 1742902981752,
    },
  ],
  citations: [
    {
      note_type: 3,
      note_uri: "a13f9afa-f15f-4afe-8b8d-b8f1d3cc468a",
      note_body: "web designers,",
      note_extra: "Really?",
      note_data:
        '{"ratio":0.07504264933408393,"configHash":516122736,"page":40,"pagesCount":535,"offsetX":0.3034999966621399,"offsetY":0.1738000065088272,"zoom":1,"originPage":40,"xPath":"\\/page[40]\\/block[0]\\/line[5]\\/char[22]@0.3035:0.1738","xPathEnd":"\\/page[40]\\/block[0]\\/line[5]\\/char[36]@0.4265:0.1738","pageEnd":40,"version":2}',
      note_index: 0.07504265010356903,
      note_page: 40,
      note_mark: 0,
      note_insert_time: 1742901686916,
      note_modified_time: 1742901691713,
    },
  ],
};


async function uploadBooksToNotion(booksToUpload) {
  const token = process.env.NOTION_API_KEY;
  const dataSourceId = process.env.CONTENT_DATA_SOURCE_ID;
  if (!token || !dataSourceId) {
    throw new Error("NOTION_API_KEY and CONTENT_DATA_SOURCE_ID are required");
  }

  // Notion's 2025-09-03 API separates data sources from databases.
  const api = async (method, path, body) => {
    const response = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2025-09-03",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(`Notion ${method} ${path}: ${response.status} ${JSON.stringify(result)}`);
    }
    return result;
  };

  const source = await api("GET", `/data_sources/${encodeURIComponent(dataSourceId)}`);
  const properties = source.properties || {};
  const expected = {
    Name: "title",
    Status: "status",
    URL: "url",
    Progress: "rich_text",
    Type: "select",
    Tags: "multi_select",
  };
  for (const [name, type] of Object.entries(expected)) {
    if (properties[name]?.type !== type) {
      throw new Error(`Expected existing Notion property ${name} of type ${type}; found ${properties[name]?.type || "missing"}`);
    }
  }
  // New multi-select options are permitted for imported tags; existing rows are never updated.
  const statuses = new Set((properties.Status.status?.options || []).map((o) => o.name));
  const types = new Set((properties.Type.select?.options || []).map((o) => o.name));
  if (!["Todo", "Paused", "Done"].every((value) => statuses.has(value)) || !types.has("Book")) {
    throw new Error("Existing Notion Status options Todo/Paused/Done and Type option Book are required; refusing to create new options");
  }

  // Read every page, not only the first 100, before deduplicating.
  const existingNames = new Set();
  let cursor;
  do {
    const result = await api("POST", `/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const page of result.results || []) {
      const title = (page.properties?.Name?.title || []).map((part) => part.plain_text).join("").trim();
      if (title) existingNames.add(title.toLocaleLowerCase());
    }
    cursor = result.has_more ? result.next_cursor : null;
    if (result.has_more && !cursor) throw new Error("Notion pagination did not return a cursor");
  } while (cursor);

  let created = 0;
  let skipped = 0;
  for (const book of booksToUpload) {
    const name = String(book.name || "").trim();
    if (!name) { skipped++; continue; }
    const key = name.toLocaleLowerCase();
    if (existingNames.has(key)) { skipped++; continue; }
    if (!statuses.has(book.status)) {
      throw new Error(`Unknown existing Notion status ${JSON.stringify(book.status)} for ${name}`);
    }
    const importedTags = Array.isArray(book.tags) ? book.tags : [];
    const tagNames = [...new Set([...importedTags, "readera-migration"]
      .filter((tag) => typeof tag === "string")
      .map((tag) => tag.trim())
      .filter(Boolean))];
    const values = {
      Name: { title: [{ text: { content: name.slice(0, 2000) } }] },
      Type: { select: { name: "Book" } },
      Tags: { multi_select: tagNames.map((name) => ({ name })) },
      Status: { status: { name: book.status } },
      Progress: { rich_text: [{ text: { content: String(book.current_page ?? 0) } }] },
    };
    if (book.URL) {
      try {
        const url = new URL(book.URL);
        if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid URL protocol");
        values.URL = { url: url.toString() };
      } catch {
        throw new Error(`Invalid URL for ${name}: ${book.URL}`);
      }
    }
    // No existing-page updates/upserts or property creation. Notion may create missing Tags options.
    await api("POST", "/pages", {
      parent: { type: "data_source_id", data_source_id: dataSourceId },
      properties: values,
    });
    existingNames.add(key);
    created++;
    console.log(`Created: ${name}`);
  }
  console.log(`ReadEra migration complete: ${created} created, ${skipped} skipped`);
}

if (UPLOAD_WITH_DEDUP) {
  uploadBooksToNotion(exportable_books).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

