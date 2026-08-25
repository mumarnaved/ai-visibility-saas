import cron from "node-cron";

import {
  runDueDeprovisioning,
} from "../database/postgres/tenant-deprovisioning.js";

/* ========================================
   START DEPROVISIONING SCHEDULER

   Runs once daily at midnight and tears
   down every tenant whose deprovision_at
   has passed.
======================================== */

export function startDeprovisioningScheduler(): void {
  cron.schedule(
    "0 0 * * *",
    async () => {
      try {
        const torn =
          await runDueDeprovisioning();

        if (torn.length > 0) {
          console.log(
            `Deprovisioned ${torn.length} tenant(s): ${torn
              .map(
                (tenant) =>
                  tenant.tenantId
              )
              .join(", ")}`
          );
        }
      } catch (error) {
        console.error(
          "Scheduled tenant deprovisioning failed:",
          error
        );
      }
    }
  );
}
