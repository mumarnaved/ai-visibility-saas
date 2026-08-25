import "dotenv/config";

import { checkDatabaseConnection } from "./connection.js";

try {
  await checkDatabaseConnection();

  console.log("PostgreSQL connection: OK");
} catch (error) {
  console.error("PostgreSQL connection: FAILED");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
}