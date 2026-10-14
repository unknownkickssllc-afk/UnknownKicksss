const { randomUUID } = require('node:crypto');

// Only signed notifications for the explicitly connected business account reach this parser.
function instagramEvents(payload, accountId) {
  if (payload?.object !== 'instagram' || !Array.isArray(payload.entry) || payload.entry.length > 50) return [];
  const events = [];
  for (const entry of payload.entry) {
    if (String(entry.id) !== String(accountId) || !Array.isArray(entry.messaging)) continue;
    if (entry.messaging.length > 50) throw new Error('Too many message events.');
    for (const event of entry.messaging) {
      const message = event.message;
      if (!message || typeof message.mid !== 'string' || !message.mid.trim() || message.mid.length > 500 || message.is_deleted) continue;
      const sender = String(event.sender?.id || ''), recipient = String(event.recipient?.id || '');
      if (sender !== String(accountId) && recipient !== String(accountId)) continue;
      const peer = sender === String(accountId) ? recipient : sender;
      if (!peer || !/^\d+$/.test(peer)) continue;
      const timestamp = Number(event.timestamp);
      if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 600000) continue;
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      const direction = sender === String(accountId) ? 'Business' : 'Customer';
      events.push({ id: randomUUID(), source: 'instagram', account_id: String(accountId), external_id: message.mid,
        conversation_id: peer, source_at: new Date(timestamp).toISOString(),
        source_text: direction + ': ' + (text.slice(0, 5500) || '[Attachment received. Review the original Instagram conversation; no amount was extracted.]'),
        draft: {}, status: 'pending' });
    }
  }
  if (events.length > 100) throw new Error('Too many message events.');
  return events;
}

async function receiveInstagram(sb, payload, accountId) {
  const events = instagramEvents(payload, accountId);
  if (!events.length) return [];
  const { data, error } = await sb.from('os_sale_inbox').upsert(events, {
    onConflict: 'source,account_id,external_id', ignoreDuplicates: true,
  }).select('id');
  if (error) throw new Error('Could not store Instagram notification.');
  return data || [];
}
module.exports = { instagramEvents, receiveInstagram };
