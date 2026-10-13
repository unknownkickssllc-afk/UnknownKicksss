const express = require("express");
const { supabase } = require("../lib/supabase");
const { requireAdmin } = require("../middleware/auth");
const { recordTypes, RecordEditError, updateRecord } = require("../services/osRecords");

function createRouter(getSupabase = supabase) {
  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  router.use(requireAdmin);
  for (const kind of Object.keys(recordTypes)) {
    router.patch(`/${kind}/:id`, async (req, res) => {
      try {
        const record = await updateRecord(getSupabase(), kind, req.params.id, req.body);
        res.json(record);
      } catch (error) {
        if (error instanceof RecordEditError) return res.status(error.status).json({ error: error.message });
        if (error.code === "23505") return res.status(409).json({ error: "That name or code is already in use. Choose another." });
        if (["42P01", "PGRST205"].includes(error.code)) return res.status(503).json({ error: "Editing is temporarily unavailable. Please try again later." });
        res.status(500).json({ error: "Your changes could not be saved. Please try again." });
      }
    });
  }
  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
