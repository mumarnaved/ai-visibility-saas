import { pool } from "../database/postgres/connection.js";

import { createJobQueue } from "./job-queue.js";

/* The queue bound to the real pool (platform.jobs). */
export const jobQueue = createJobQueue(pool);
