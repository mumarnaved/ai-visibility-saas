/* ========================================
   VERCEL SERVERLESS ENTRY POINT

   Any file under apps/worker/api/ becomes a
   Vercel serverless function automatically.
   The Express app instance (exported as the
   default export from server.ts) is already
   a valid (req, res) handler - Vercel's
   Node.js runtime accepts it directly, no
   serverless-http adapter needed. vercel.json
   rewrites every request to this one
   function, so the whole app runs as a
   single serverless function, matching how
   it already behaves as one Express process
   locally.
======================================== */

export { default } from "../src/api/server.js";
