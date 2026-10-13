const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { createOwnerDraft, publicAssistantError, MAX_MESSAGE_LENGTH } = require('../services/ownerAssistant');

// A small team-wide limit per server instance; no owner text or credentials are stored.
function createDraftHandler({generate = createOwnerDraft, now = Date.now} = {}) {
  let active = false, requests = [];
  return async (req,res) => {
    res.set('Cache-Control','private, no-store');
    const message = req.body?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({error:'Describe one transaction in 1–3,000 characters.'});
    const time = now(); requests = requests.filter(timestamp=>timestamp > time-60000);
    if (active || requests.length >= 5) {
      res.set('Retry-After','60');
      return res.status(429).json({error:active?'A draft is already being prepared. Wait for it to finish.':'You have prepared five drafts this minute. Please wait a minute.'});
    }
    requests.push(time); active = true;
    try { return res.json(await generate(message)); }
    catch (error) { const safe = publicAssistantError(error); return res.status(safe.status).json({error:safe.error}); }
    finally { active = false; }
  };
}
const router = express.Router();
router.use(requireAdmin);
router.post('/draft',createDraftHandler());
module.exports = router;
module.exports.createDraftHandler = createDraftHandler;
