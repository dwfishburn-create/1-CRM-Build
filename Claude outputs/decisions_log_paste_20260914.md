DECISIONS LOG — PASTE-IN TEXT FOR TODAY (9/14/2026)
====================================================
Two things to log: the first BR-type engagement entered in the CRM, and a
recurring data-quality bug in agent-written text plus the guard added for it.

--------------------------------------------------------------------
1) TOP OF FILE — replace the "Last updated" line
--------------------------------------------------------------------
Whatever the current "Last updated:" line reads at the top of the file,
prepend this to the front of the parenthetical (keep everything already
in there after it):

HTML-entity decode guard added to the agent write path (lib/sanitize.ts), closing a recurring bug where agent-supplied text stored "&amp;" instead of "&" and broke plain-text search; first BR (buyer rep) engagement entered — BR-Hy-Vee 108th & Hwy 370;

--------------------------------------------------------------------
2) "Decisions (settled)" section — insert TWO new entries
--------------------------------------------------------------------
Add these as the two newest entries at the start of the Decisions
(settled) section, most recent first:

- **9/14/2026 — HTML entities in agent-supplied text are now decoded at the write path (`lib/sanitize.ts`), not cleaned up by hand after the fact:** Claude sessions intermittently write HTML-escaped text into the CRM — a notes field arrives holding the five characters `&amp;` where it should hold a single `&`. Confirmed this session that the server is NOT at fault: the same tool, in the same session, stored a literal `&` correctly when given one and stored `&amp;` verbatim when given that, so the escaping is entirely caller-side. The cost is not cosmetic — an escaped row stops matching a plain-text search, so a contact stored as "Cushman &amp; Wakefield" is invisible to anyone searching "Cushman & Wakefield". An audit of every table found 24 affected fields across 20 records, including six written in earlier, unrelated sessions (CON-0013, CON-0014, CON-0015, CON-0017, CON-0054, ENT-0048) — recurring, not a one-off, which is what justified a guard over another manual sweep. All 24 fields were corrected the same day.
  - **Code:** new `lib/sanitize.ts` exporting `decodeHtmlEntities` (string) and `decodeHtmlEntitiesDeep` (walks a JSON body). Applied in `lib/agentApiClient.ts` inside `agentApiRequest`, on both the JSON body and query-string values. That function is the single choke point every MCP tool passes through, so one call covers every tool and every table — consistent with this file's existing "exactly one place each table's validation lives" principle, and the reason no per-route edits were needed.
  - **Deliberately narrow, three ways:** (1) only `&amp; &lt; &gt; &quot; &apos; &nbsp;` and their numeric/hex forms are decoded, so a genuine `&copy;` or `&#8364;` in a note survives; (2) decoding is a SINGLE pass, so `&amp;lt;` becomes `&lt;` and stops — repeated decoding until stable would corrupt any note that legitimately discusses escaped markup; (3) the UI server actions in `app/*/actions.ts` are untouched, because a human typing into a form means exactly what they typed. `&nbsp;` decodes to a normal space rather than U+00A0 on purpose — a stray non-breaking space is the same class of quiet search-breaking bug.
  - **Tested:** 33 assertions covering the real affected strings, every supported entity, the must-not-change cases (plain `&`, `R&D`, URL query strings, unsupported entities), the single-pass boundary, deep/nested/array walking, type preservation, and the depth guard. Both changed files type-check clean under `--strict`.
  - **Not covered:** direct `/api/agent/*` callers that bypass the MCP route. `proxy.ts` is Edge middleware and rewriting a request body there is awkward, so it was left alone; if direct Agent API callers ever start producing the same artifact, import the same helper into the route handlers.

- **9/14/2026 — First BR (buyer representation) engagement entered: BR-Hy-Vee 108th & Hwy 370.** Confirmed no schema or SOP work was needed to support it — `project_type` is free text and already lists BR in the `create_project` taxonomy, and `get_sop_checklist("BR")` already returns a populated matrix (Property Survey SOP: Load; Transaction Documents SOP: Load; Listing Engagements and Lease Review: N/A; Deal Timeline: **Gap**). Records created: project `BR-Hy-Vee 108th & Hwy 370`; PROP-0029 parent assemblage (150.19 AC, Papillion, Sarpy County) with PROP-0030/0031/0032/0033 as the four parcels; ENT-0049 Haug Moore Legacy Trust, ENT-0050 Robert G. and Elaine L. Moore Family Trust, ENT-0051 Cushman & Wakefield/The Lund Company, ENT-0052 TitleCore LLC; CON-0056 through CON-0062. LOG-0100 through LOG-0106 back-fill the deal history from the source documents.
  - **Modeling note — two-trust seller, one assemblage:** the four parcels sit under two different selling trusts, so ownership is recorded at the child-parcel level (Parcels 1-3 to ENT-0049, Parcel 4 to ENT-0050) with both linked at the parent. Worth reusing for any future multi-parcel assemblage.
  - **Modeling note — formula pricing:** this deal has no fixed price. `deal_price` holds the $15,019,000 floor with the full seller-net formula explained in the project notes, because the actual number is not knowable until closing. If formula-priced deals become common, the Value/Probability scoring fields may need a "price is a range" flag rather than a single figure.
  - **Deal Timeline SOP gap is now blocking on two live deals** (this one and TR/BR-Astlali), both buy-side. Worth writing the buy-side equivalent rather than continuing to mark it Gap.

--------------------------------------------------------------------
That's it — 3 edits (1 header line, 2 new entries).
