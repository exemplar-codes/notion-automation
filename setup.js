require("dotenv").config({ override: true, quiet: true });

const { Client } = require("@notionhq/client");
const winston = require("winston");

const token =
  process.env.NOTION_API_TOKEN ||
  process.env.NOTION_TOKEN ||
  process.env.NOTION_API_KEY;

if (!token) {
  console.error(
    "Missing NOTION_API_TOKEN (or NOTION_TOKEN / NOTION_API_KEY). Usually already in the shell via ~/.zshrc / ~/.env — or copy .env.example → .env"
  );
  process.exit(1);
}

const notion = new Client({ auth: token });

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

module.exports = { notion, logger };
