require("dotenv").config();

const { Client } = require("@notionhq/client");

// Initializing a client
const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

module.exports.notion = notion;

// logger

const winston = require("winston");

const logger = winston.createLogger({
  level: "info", // Set the default log level
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json() // Log in JSON format
  ),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }), // Log errors to error.log
    new winston.transports.File({ filename: "combined.log" }), // Log all levels to combined.log
  ],
});

function loggerExample() {
  // Example usage
  logger.info("This is an informational message.");
  logger.warn("This is a warning message.");
  logger.error("This is an error message.");
}

module.exports = { notion, logger, loggerExample };
