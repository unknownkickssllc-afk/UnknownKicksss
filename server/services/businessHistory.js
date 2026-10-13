const { applyHistoryOverrides } = require("./historyEditing");
// Historical reports are deliberately not folded into current balances or website orders.
// A dated estimate, a mixed personal/business card balance, and a pending payout are
// useful context, but none establishes today's available cash or a completed sale.
async function loadBusinessHistory(sb) {
  const records = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await sb.from("os_historical_records")
      .select("source_key,section,title,reported_on,confidence,value_text,detail,source_ref,sort_order")
      .order("source_key").range(offset, offset + 499);
    if (error) throw error;
    records.push(...data);
    if (data.length < 500) break;
    if (offset === 9500) throw new Error("History requires a larger reporting query");
  }
  const { data: imported, error } = await sb.from("os_sheet_imports")
    .select("payload,imported_at,source_title,source_url")
    .eq("source_key", "primary-reselling-sheet").maybeSingle();
  if (error) throw error;
  records.sort((a, b) => a.sort_order - b.sort_order || a.source_key.localeCompare(b.source_key));
  const overrides = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error: overridesError } = await sb.from("os_history_overrides")
      .select("entity_type,source_key,patch,updated_at").order("entity_type").order("source_key").range(offset, offset + 499);
    if (overridesError) throw overridesError;
    overrides.push(...data);
    if (data.length < 500) break;
    if (offset === 9500) throw new Error("History requires a larger reporting query");
  }
  return applyHistoryOverrides({ records, sheet: imported ? { ...imported.payload,
    importedAt: imported.imported_at, sourceTitle: imported.source_title, sourceUrl: imported.source_url,
  } : null }, overrides);
}
module.exports = { loadBusinessHistory };
