/** "$1,234.56" from cents — every price DISPLAY in the app should go
 * through this rather than a bare toFixed(2), so a $70 card and a
 * $70,000 card are both readable at a glance instead of the thousands
 * digits running together. Text-input price fields (Sell/Edit Listing)
 * intentionally don't use this — inserting commas into what someone's
 * actively typing is a separate, fussier problem (cursor position,
 * locale of the decimal separator) that isn't what was asked for here. */
export function formatPriceCents(cents: number, prefix = "$"): string {
  return `${prefix}${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
