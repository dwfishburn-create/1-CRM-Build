-- db/013_sop_matrix.sql
-- Moves the companion-SOP routing matrix out of lib/sopMatrix (hardcoded) and into the database,
-- so a re-sync is a row edit instead of a code change + push + deploy.
--
-- Decision: 9/14/2026. Surfaced running BR-Hy-Vee 108th & Hwy 370 through the CRM.
-- Canonical prose source stays /1-SOPs & Templates/New_Project_Setup_and_Categorization_-_SOP.md,
-- Section 4. This table is the machine-readable projection of it, not a replacement for it.
--
-- Two problems this closes:
--   1. get_sop_checklist could report its own source_last_synced but could not compare it to
--      anything, so "stale label" and "stale data" were indistinguishable without doing by hand
--      the exact cross-check the tool exists to eliminate. sop_matrix_meta makes the comparison
--      data, so the tool returns a verdict instead of an instruction.
--   2. The matrix could only report a Gap for an SOP that had a row. A missing cell was visible;
--      a missing row was invisible. That is why the Due Diligence Documents SOP never showed up
--      as a gap on a BR deal -- it was never a row. Section 6's "SOPs Still Needed" roadmap and
--      Section 4's row list are reconciled here into one list.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create table if not exists sop_matrix (
  id            uuid primary key default gen_random_uuid(),
  sop_name      text not null,
  sop_filename  text,                     -- null = SOP not written yet
  project_type  text not null,            -- TR, BR, CL, CS, L, LRT, LRLL, SL
  status        text not null,
  note          text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint sop_matrix_status_check
    check (status in ('Load', 'Adapt', 'N/A', 'Gap')),
  constraint sop_matrix_project_type_check
    check (project_type in ('TR', 'BR', 'CL', 'CS', 'L', 'LRT', 'LRLL', 'SL')),
  constraint sop_matrix_unique_cell
    unique (sop_name, project_type)
);

create index if not exists sop_matrix_project_type_idx on sop_matrix (project_type);
create index if not exists sop_matrix_sort_idx on sop_matrix (sort_order, sop_name);

-- Single-row metadata table. The whole point of the two date columns is that the tool can
-- compare them itself:
--   source_doc_last_updated  <- the SOP doc's own "Last updated:" line. Any session that reads
--                               or edits that doc updates this.
--   source_last_synced       <- the date these rows were last reconciled against Section 4.
-- stale := source_doc_last_updated > source_last_synced
create table if not exists sop_matrix_meta (
  id                      integer primary key default 1,
  source_doc              text not null default 'New_Project_Setup_and_Categorization_-_SOP.md, Section 4',
  source_doc_path         text not null default '/1-SOPs & Templates/New_Project_Setup_and_Categorization_-_SOP.md',
  source_doc_last_updated date not null,
  source_last_synced      date not null,
  updated_at              timestamptz not null default now(),
  constraint sop_matrix_meta_singleton check (id = 1)
);

-- ---------------------------------------------------------------------------
-- 1b. Row-level security -- matches the existing pattern in this schema
--
-- Verified 9/14/2026: contacts, properties, entities and projects all have relrowsecurity = true
-- and ZERO policies in pg_policies. That combination means anon and authenticated roles can read
-- nothing, and the only access path is the server-side Supabase secret key (service role), which
-- bypasses RLS -- i.e. the Agent API and the web app, both of which run server-side. These two
-- tables follow the same posture rather than becoming the schema's one unsecured pair.
--
-- No policies are created here on purpose. If a client-side read path is ever added, policies get
-- designed for the whole schema at once, not bolted onto this table alone.
--
-- Note: the table owner still bypasses RLS, so the seed inserts below run normally from the SQL
-- Editor even with RLS enabled here first.
-- ---------------------------------------------------------------------------

alter table sop_matrix      enable row level security;
alter table sop_matrix_meta enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Seed -- existing Section 4 rows, transcribed verbatim from the SOP doc
--    (doc "Last updated: 9/14/2026"). Provenance worth keeping straight: as of 9/5/2026 the
--    matrix had been unchanged since 8/26/2026 -- verified cell by cell 9/14/2026, the 8/26 -> 9/5
--    edits touched Sections 3, 5, 6 and 8 only, so the tool's 8/26 snapshot was accurate the whole
--    time and only its label looked stale. Section 4 itself then changed on 9/14/2026, in the same
--    pass that created this table: the Transaction Documents LRT/LRLL cells picked up the
--    renewal-amendment qualifier below, and a note paragraph was added under the table for the
--    BR Deal Timeline cell.
-- ---------------------------------------------------------------------------

insert into sop_matrix (sop_name, sop_filename, project_type, status, note, sort_order) values

-- Row 1: Client Property Survey Map SOP
('Client Property Survey Map SOP', 'Client_Property_Survey_Map_-_SOP.md', 'TR',   'Load',  null, 10),
('Client Property Survey Map SOP', 'Client_Property_Survey_Map_-_SOP.md', 'BR',   'Load',  null, 10),
('Client Property Survey Map SOP', 'Client_Property_Survey_Map_-_SOP.md', 'CL',   'Adapt', 'comps, not candidates', 10),
('Client Property Survey Map SOP', 'Client_Property_Survey_Map_-_SOP.md', 'CS',   'Adapt', 'comps, not candidates', 10),
('Client Property Survey Map SOP', 'Client_Property_Survey_Map_-_SOP.md', 'L',    'Adapt', 'comps, not candidates', 10),
('Client Property Survey Map SOP', 'Client_Property_Survey_Map_-_SOP.md', 'LRT',  'Adapt', 'renewal comps', 10),
('Client Property Survey Map SOP', 'Client_Property_Survey_Map_-_SOP.md', 'LRLL', 'Adapt', 'renewal comps', 10),
('Client Property Survey Map SOP', 'Client_Property_Survey_Map_-_SOP.md', 'SL',   'Adapt', 'comps, not candidates', 10),

-- Row 2: Client Transaction Documents SOP
('Client Transaction Documents SOP', 'Client_Transaction_Documents_-_SOP.md', 'TR',   'Load',  null, 20),
('Client Transaction Documents SOP', 'Client_Transaction_Documents_-_SOP.md', 'BR',   'Load',  null, 20),
('Client Transaction Documents SOP', 'Client_Transaction_Documents_-_SOP.md', 'CL',   'Load',  'Stage 3 only - see Listing SOP, Section 6', 20),
('Client Transaction Documents SOP', 'Client_Transaction_Documents_-_SOP.md', 'CS',   'Load',  'Stage 3 only', 20),
('Client Transaction Documents SOP', 'Client_Transaction_Documents_-_SOP.md', 'L',    'Load',  'Stage 3 only', 20),
('Client Transaction Documents SOP', 'Client_Transaction_Documents_-_SOP.md', 'LRT',  'Adapt', 'amendment, not full LOI/Lease; dedicated renewal-amendment section not yet written', 20),
('Client Transaction Documents SOP', 'Client_Transaction_Documents_-_SOP.md', 'LRLL', 'Adapt', 'amendment, not full LOI/Lease; dedicated renewal-amendment section not yet written', 20),
('Client Transaction Documents SOP', 'Client_Transaction_Documents_-_SOP.md', 'SL',   'Adapt', 'sublease agreement + prime landlord consent, not a direct lease', 20),

-- Row 3: Client Commercial Listing Engagements SOP (CL, CS, L)
('Client Commercial Listing Engagements SOP (CL, CS, L)', 'Client_Commercial_Listing_Engagements_-_SOP_(CL,_CS,_L).md', 'TR',   'N/A',   null, 30),
('Client Commercial Listing Engagements SOP (CL, CS, L)', 'Client_Commercial_Listing_Engagements_-_SOP_(CL,_CS,_L).md', 'BR',   'N/A',   null, 30),
('Client Commercial Listing Engagements SOP (CL, CS, L)', 'Client_Commercial_Listing_Engagements_-_SOP_(CL,_CS,_L).md', 'CL',   'Load',  null, 30),
('Client Commercial Listing Engagements SOP (CL, CS, L)', 'Client_Commercial_Listing_Engagements_-_SOP_(CL,_CS,_L).md', 'CS',   'Load',  null, 30),
('Client Commercial Listing Engagements SOP (CL, CS, L)', 'Client_Commercial_Listing_Engagements_-_SOP_(CL,_CS,_L).md', 'L',    'Load',  null, 30),
('Client Commercial Listing Engagements SOP (CL, CS, L)', 'Client_Commercial_Listing_Engagements_-_SOP_(CL,_CS,_L).md', 'LRT',  'N/A',   null, 30),
('Client Commercial Listing Engagements SOP (CL, CS, L)', 'Client_Commercial_Listing_Engagements_-_SOP_(CL,_CS,_L).md', 'LRLL', 'N/A',   null, 30),
('Client Commercial Listing Engagements SOP (CL, CS, L)', 'Client_Commercial_Listing_Engagements_-_SOP_(CL,_CS,_L).md', 'SL',   'Adapt', 'client is sublandlord/tenant, not fee owner; add master lease/prime landlord consent step', 30),

-- Row 4: Client Lease Review SOP (Tenant Representation)
('Client Lease Review SOP (Tenant Representation)', 'Client_Lease_Review_-_SOP_(Tenant_Representation).md', 'TR',   'Load',  null, 40),
('Client Lease Review SOP (Tenant Representation)', 'Client_Lease_Review_-_SOP_(Tenant_Representation).md', 'BR',   'N/A',   null, 40),
('Client Lease Review SOP (Tenant Representation)', 'Client_Lease_Review_-_SOP_(Tenant_Representation).md', 'CL',   'N/A',   null, 40),
('Client Lease Review SOP (Tenant Representation)', 'Client_Lease_Review_-_SOP_(Tenant_Representation).md', 'CS',   'N/A',   null, 40),
('Client Lease Review SOP (Tenant Representation)', 'Client_Lease_Review_-_SOP_(Tenant_Representation).md', 'L',    'N/A',   null, 40),
('Client Lease Review SOP (Tenant Representation)', 'Client_Lease_Review_-_SOP_(Tenant_Representation).md', 'LRT',  'Adapt', null, 40),
('Client Lease Review SOP (Tenant Representation)', 'Client_Lease_Review_-_SOP_(Tenant_Representation).md', 'LRLL', 'N/A',   null, 40),
('Client Lease Review SOP (Tenant Representation)', 'Client_Lease_Review_-_SOP_(Tenant_Representation).md', 'SL',   'N/A',   null, 40),

-- Row 5: Client Deal Timeline SOP (Tenant Representation)
-- Gap cells here are the per-type variants on Section 6's roadmap. Deal Timeline variants stay
-- CELLS on this row, not new rows -- start any new variant from the existing doc's Section 2
-- ("Universal Rules"), which is written to carry forward unchanged.
('Client Deal Timeline SOP (Tenant Representation)', 'Client_Deal_Timeline_-_SOP_(Tenant_Representation).md', 'TR',   'Load', null, 50),
('Client Deal Timeline SOP (Tenant Representation)', 'Client_Deal_Timeline_-_SOP_(Tenant_Representation).md', 'BR',   'Gap',  'buy-side timeline built ad hoc 9/14/2026 on BR-Hy-Vee 108th & Hwy 370 -- use it as the draft basis when this variant gets written', 50),
('Client Deal Timeline SOP (Tenant Representation)', 'Client_Deal_Timeline_-_SOP_(Tenant_Representation).md', 'CL',   'Gap',  null, 50),
('Client Deal Timeline SOP (Tenant Representation)', 'Client_Deal_Timeline_-_SOP_(Tenant_Representation).md', 'CS',   'Gap',  null, 50),
('Client Deal Timeline SOP (Tenant Representation)', 'Client_Deal_Timeline_-_SOP_(Tenant_Representation).md', 'L',    'Gap',  null, 50),
('Client Deal Timeline SOP (Tenant Representation)', 'Client_Deal_Timeline_-_SOP_(Tenant_Representation).md', 'LRT',  'Gap',  null, 50),
('Client Deal Timeline SOP (Tenant Representation)', 'Client_Deal_Timeline_-_SOP_(Tenant_Representation).md', 'LRLL', 'Gap',  null, 50),
('Client Deal Timeline SOP (Tenant Representation)', 'Client_Deal_Timeline_-_SOP_(Tenant_Representation).md', 'SL',   'Gap',  null, 50),

-- ---------------------------------------------------------------------------
-- 3. Seed -- NEW rows (3). Reconciles Section 6's "SOPs Still Needed" roadmap into the matrix,
--    so an SOP that does not exist yet is reportable instead of invisible.
--    Every cell below is Gap or N/A by definition; they flip to Load as the SOPs get written.
-- ---------------------------------------------------------------------------

-- Row 6: Client Due Diligence Documents SOP -- the row whose absence caused this whole finding.
-- In progress as of 9/14/2026. Flip BR to 'Load' and set sop_filename on publication.
-- Applicability outside BR/CS/L is unconfirmed with Dan -- same convention as the SL row note in
-- Section 4 ("added on judgment, not yet confirmed").
('Client Due Diligence Documents SOP', null, 'TR',   'N/A', 'unconfirmed with Dan -- tenant-side site DD may warrant an Adapt rather than N/A', 60),
('Client Due Diligence Documents SOP', null, 'BR',   'Gap', 'SOP in progress as of 9/14/2026 -- flip to Load on publication', 60),
('Client Due Diligence Documents SOP', null, 'CL',   'N/A', null, 60),
('Client Due Diligence Documents SOP', null, 'CS',   'Gap', 'seller-side DD response -- unconfirmed with Dan whether this is the same SOP or its own', 60),
('Client Due Diligence Documents SOP', null, 'L',    'Gap', 'land DD differs materially from improved property -- unconfirmed with Dan', 60),
('Client Due Diligence Documents SOP', null, 'LRT',  'N/A', null, 60),
('Client Due Diligence Documents SOP', null, 'LRLL', 'N/A', null, 60),
('Client Due Diligence Documents SOP', null, 'SL',   'N/A', null, 60),

-- Row 7: Buyer-side PSA Review SOP -- Section 6 roadmap item. Counterpart to the Tenant Rep
-- Lease Review SOP on row 4.
('Buyer-side PSA Review SOP', null, 'TR',   'N/A', null, 70),
('Buyer-side PSA Review SOP', null, 'BR',   'Gap', 'Section 6 roadmap item, not yet written -- counterpart to Client Lease Review SOP (TR)', 70),
('Buyer-side PSA Review SOP', null, 'CL',   'N/A', null, 70),
('Buyer-side PSA Review SOP', null, 'CS',   'Gap', 'seller-side PSA review -- unconfirmed with Dan whether this folds into the same SOP', 70),
('Buyer-side PSA Review SOP', null, 'L',    'Gap', 'unconfirmed with Dan -- land PSA may fold into the same SOP', 70),
('Buyer-side PSA Review SOP', null, 'LRT',  'N/A', null, 70),
('Buyer-side PSA Review SOP', null, 'LRLL', 'N/A', null, 70),
('Buyer-side PSA Review SOP', null, 'SL',   'N/A', null, 70),

-- Row 8: Landlord-side Lease/Amendment Review SOP -- Section 6 roadmap item. Counterpart to the
-- Tenant Rep Lease Review SOP for the CL and LRLL sides.
('Landlord-side Lease/Amendment Review SOP', null, 'TR',   'N/A', null, 80),
('Landlord-side Lease/Amendment Review SOP', null, 'BR',   'N/A', null, 80),
('Landlord-side Lease/Amendment Review SOP', null, 'CL',   'Gap', 'Section 6 roadmap item, not yet written', 80),
('Landlord-side Lease/Amendment Review SOP', null, 'CS',   'N/A', null, 80),
('Landlord-side Lease/Amendment Review SOP', null, 'L',    'N/A', null, 80),
('Landlord-side Lease/Amendment Review SOP', null, 'LRT',  'N/A', null, 80),
('Landlord-side Lease/Amendment Review SOP', null, 'LRLL', 'Gap', 'Section 6 roadmap item, not yet written', 80),
('Landlord-side Lease/Amendment Review SOP', null, 'SL',   'N/A', null, 80)

on conflict (sop_name, project_type) do nothing;

-- Deliberately NOT given a row -- two Section 6 roadmap items that are edits to existing SOPs
-- rather than new documents:
--
--   * "Sub-lease consent/coordination step" -- an edit to the Transaction Documents and Commercial
--     Listing Engagements SOPs, already carried by the SL 'Adapt' notes on rows 2 and 3.
--
--   * "Renewal-amendment workflow" -- Section 6 itself says this is "likely a new section added to
--     the existing Transaction Documents SOP rather than a standalone file." Row 2 already routes
--     LRT and LRLL to Transaction Documents as 'Adapt (amendment, not full LOI/Lease)', so a
--     separate row would report the same fact twice under contradictory statuses -- Adapt on one
--     row, Gap on another -- for the identical situation. 'Gap' is also the wrong word: nothing is
--     missing from the Load list, a section is missing inside a document already being loaded.
--     Carried instead as an extension to the LRT/LRLL notes on row 2. Confirmed by Dan 9/14/2026.
--     If it ever does become a standalone document, it earns a row then.
--
-- Adding rows for either would report a gap that no new document will ever close.
--
-- The rule this establishes: a per-type VARIANT of an existing SOP is a cell on that SOP's row;
-- a genuinely new document is a new row; an edit to an existing SOP is neither -- it lives in the
-- note on the affected cell.

-- ---------------------------------------------------------------------------
-- 4. Seed -- metadata
-- ---------------------------------------------------------------------------

-- Both dates are 9/14/2026: the SOP doc's Section 4 was updated the same day this table was
-- seeded (a note recording the ad hoc BR deal timeline, plus the LRT/LRLL renewal-amendment
-- qualifier on the Transaction Documents row), so the matrix and the doc are in sync as of today.
insert into sop_matrix_meta (id, source_doc_last_updated, source_last_synced)
values (1, '2026-09-14', '2026-09-14')
on conflict (id) do update
  set source_doc_last_updated = excluded.source_doc_last_updated,
      source_last_synced      = excluded.source_last_synced,
      updated_at              = now();

-- ---------------------------------------------------------------------------
-- 5. updated_at triggers (matches the pattern used elsewhere in this schema)
-- ---------------------------------------------------------------------------

-- Deliberately named sop_matrix_set_updated_at() rather than the generic set_updated_at(), so this
-- migration cannot redefine an existing shared trigger function that other tables depend on.
create or replace function sop_matrix_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sop_matrix_touch on sop_matrix;
create trigger sop_matrix_touch
  before update on sop_matrix
  for each row execute function sop_matrix_set_updated_at();

drop trigger if exists sop_matrix_meta_touch on sop_matrix_meta;
create trigger sop_matrix_meta_touch
  before update on sop_matrix_meta
  for each row execute function sop_matrix_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Verification -- run after applying
-- ---------------------------------------------------------------------------
-- Expect 64 rows (8 SOPs x 8 project types):
--   select count(*) from sop_matrix;
--
-- Expect the BR column to match Section 4 plus the three new rows:
--   select sop_name, status, note from sop_matrix where project_type = 'BR' order by sort_order;
--
-- Expect both new tables to show relrowsecurity = true, matching contacts/properties/entities/
-- projects, and to have zero policies (service-key-only access, same as the rest of the schema):
--   select relname, relrowsecurity from pg_class
--   where relname in ('contacts','properties','entities','projects','sop_matrix','sop_matrix_meta');
--
--   select tablename, policyname from pg_policies
--   where schemaname = 'public' and tablename in ('sop_matrix','sop_matrix_meta');
--
-- Expect staleness = false (source_doc_last_updated 2026-09-14 <= source_last_synced 2026-09-14):
--   select source_doc_last_updated, source_last_synced,
--          (source_doc_last_updated > source_last_synced) as is_stale
--   from sop_matrix_meta;
