DECISIONS LOG — PASTE-IN TEXT FOR TODAY (9/9/2026)
====================================================
Two things owed to the log: the Dashboard lease-events buildout, and the
SOP/folder-structure decision from the Sanav Lexington file reorg. Four
small edits total — do them in this order.

--------------------------------------------------------------------
1) TOP OF FILE — replace the "Last updated" line (line 5)
--------------------------------------------------------------------
FIND (starts with "Last updated: 9/9/2026 (Astlali basemap..."):

Last updated: 9/9/2026 (Astlali basemap regressed to Esri a SECOND time same day, ~4 hours after the first fix, found via a routine check rather than a Dan report — fixed again, promoted the redeploy caution to a required step in Live_Client_Map_Links.md, open question added on root cause; Space/Lease Phase 2 — lease_events and property_expenses tables — built and confirmed live in production; Mapbox Satellite Streets basemap retrofit and redeploy mechanics documented; a same-day version mixup on this log file itself was resolved via Dropbox version restore; per-candidate multi-document subfolder pivot added 9/8/2026 — see Decisions below)

REPLACE WITH:

Last updated: 9/9/2026 (Space/Lease Phase 2 lease_events surfaced on the Dashboard; client listing-folder taxonomy split into Leases-/Financials-/narrowed Marketing Package, applied via the Commercial Listing Engagements SOP and executed on the Sanav Lexington Holdings CS engagement; Astlali basemap regressed to Esri a SECOND time same day, ~4 hours after the first fix, found via a routine check rather than a Dan report — fixed again, promoted the redeploy caution to a required step in Live_Client_Map_Links.md, open question added on root cause; Space/Lease Phase 2 — lease_events and property_expenses tables — built and confirmed live in production; Mapbox Satellite Streets basemap retrofit and redeploy mechanics documented; a same-day version mixup on this log file itself was resolved via Dropbox version restore; per-candidate multi-document subfolder pivot added 9/8/2026 — see Decisions below)

--------------------------------------------------------------------
2) "Live infrastructure" section — Agent API line
--------------------------------------------------------------------
FIND the sentence ending "...(Value/Probability/Expected-Value scoring — see Decisions; **confirmed live 9/2/2026**)." at the end of the Agent API bullet (it's a long bullet — this is its last sentence), and ADD immediately after it (still inside the same bullet, no blank line):

**`lease-events`**, **`property-expenses`** (added 9/9/2026 — see Decisions; **live in production as of 9/9/2026**).

--------------------------------------------------------------------
3) "Live infrastructure" section — Live screens line
--------------------------------------------------------------------
FIND, inside the Live screens bullet, this fragment:

Expected-Value-aware sort + "Expected value in play" stat card + per-task EV badge added 9/2/2026, code pushed and confirmed live in production 9/4/2026, see Decisions)

REPLACE WITH:

Expected-Value-aware sort + "Expected value in play" stat card + per-task EV badge added 9/2/2026, code pushed and confirmed live in production 9/4/2026, see Decisions; open `lease_events` added to the same triage view 9/9/2026, see Decisions)

--------------------------------------------------------------------
4) "Decisions (settled)" section — insert TWO new entries
--------------------------------------------------------------------
FIND this existing sub-bullet (the last line of the 9/9/2026 Phase 2 entry):

  - **Unrelated incident during this build:** a demo file (Mapbox_Basemap_Demo.html) was accidentally committed with a live Mapbox *secret*-scope token hardcoded at the tile-request line, caught by GitHub's push protection before reaching the remote. Fixed by swapping in the existing public (pk.) token and squashing local commits before pushing, so the secret never entered pushed history. Lesson: only ever use pk. tokens in client-facing/demo HTML, never sk. — reinforces the 9/9/2026 Mapbox decision above, which already used a public token correctly for the real Property Survey Map Standard.

INSERT two new entries immediately AFTER that line (before the blank line that comes next, then before "- **9/8/2026 — Space/Lease data model..."):

- **9/9/2026 — Space/Lease Phase 2 data surfaced on the Dashboard: open `lease_events` added to daily triage, closing the "Phase 2 → Dashboard integration" gap flagged in migration 012's own comments:** `/dashboard` now queries open (`is_completed = false`) lease events, sorted by `event_date` ascending (undated events sort last) — no EV-weighting here since lease events don't carry an Expected Value the way tasks do; overdue events sort to the top on date alone. New 6th stat card ("Open lease events," red text when any are overdue) added to the existing 5-card grid. New "Upcoming lease events" section at the bottom of the page renders each as a card (mirrors the existing TaskCard styling — property/tenant context line, red/amber date coloring, amount badge if set, italic notes) with a "Mark done" action wired to a new `completeLeaseEventAction` Server Action (`app/dashboard/lease-event-actions.ts`, mirrors `completeTaskAction`'s pattern) calling a new `completeLeaseEvent` helper in `lib/leaseEvents.ts`. Verified clean (`tsc --noEmit`, `eslint`, `next build`) before shipping; committed via the device bridge to `app/dashboard/page.tsx`, `app/dashboard/lease-event-actions.ts`, `lib/leaseEvents.ts`; confirmed live via direct `curl` against `/dashboard` (both "Upcoming lease events" and "Open lease events" text present).

- **9/9/2026 — Client listing-folder taxonomy: the old single "Marketing Package" catch-all split into `Leases -`, `Financials -`, and a narrowed `Marketing Package -`/`Due Diligence -`, applied to CL/CS/L/SL via the Commercial Listing Engagements SOP:** Triggered by a real gap found in Sanav Lexington Holdings' CS engagement (2802 Plum Creek Pky - Shoppes of Lexington) — three tenant leases (Dollar Tree, Dollar Tree First Amendment, Hibbett) and three financial documents (2025 financials, rent roll, OM pro forma) were sitting loose at the client root with no assigned home instead of filed under the engagement subfolder. Three taxonomy options were presented; Dan chose the three-way split and confirmed it should also apply to CL assignments — the Commercial Listing Engagements SOP already covers CL/CS/L jointly (and SL via its existing "Adapt" note), so one doc update covers all four engagement types.
  - **Executed in Dropbox:** created `Leases - Shoppes of Lexington/` and `Financials - Shoppes of Lexington/` under the CS engagement folder; moved the three lease PDFs into Leases and the three financial spreadsheets into Financials; deleted three confirmed duplicates (a duplicate Dollar Tree lease PDF, and two duplicate/recompressed copies of the appraisal report already correctly filed under `Comps - Shoppes of Lexington/` — confirmed by reading each file's text, not by filename, after an initial filename-based guess about one of them turned out wrong and was corrected before anything was deleted).
  - **SOP updated:** `Client_Commercial_Listing_Engagements_-_SOP_(CL,_CS,_L).md`, Section 5 — the old single "Marketing Package" bullet split into three: `Leases - [Property]/` (existing tenant leases/amendments/guaranties — also the trigger to check the CRM's `leases`/`lease_events` tables match the document), `Financials - [Property]/` (rent roll, operating financials, OM/pro forma), and a narrowed `Marketing Package -`/`Due Diligence -` now scoped to third-party technical due diligence only (construction/architectural plans, ECRs, CC&Rs, environmental reports, surveys, title work — a Master Lease for SL deals now goes in `Leases -` instead). Section 3 (Stage 1 setup) and Section 9 (Quick-Start Checklist) got a matching new step to ask about existing leases/financials at listing setup. Section 8's open-items list got a placeholder for `Leases -`/`Financials -` naming, mirroring the existing `Marketing Package` vs. `Due Diligence` naming question.
  - **Next up (separate, already authorized):** review the three relocated lease PDFs and reconcile their terms against the CRM's `leases`/`lease_events` records for PROP-0024 (The Shoppes at Lexington), and log relevant terms to the lease comps database.

--------------------------------------------------------------------
That's it — 4 edits, in order. Ping me once they're in and I'll move on to
reviewing the three lease PDFs and updating the CRM/comps data.
