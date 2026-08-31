-- Dan Fishburn CRM — v1 schema, migration 008
-- Commission-split/collaborator tracking, per the "Solo vs. collaborator
-- flag on Projects/Assignments" idea (parking lot, raised 8/26/2026, split
-- mechanics confirmed the same day, partially operationalized 8/28/2026 in
-- the interim Commission_Opportunity_Pipeline_Tracker.xlsx).
--
-- Extends `project_contacts` (built 8/30/2026, migration 006) rather than
-- adding a new table: project_contacts.role already anticipated this exact
-- use case ("freeform: decision-maker / co-broker / referral / cooperating
-- broker / etc."). What was missing was (1) the ability to link an outside
-- brokerage as an entity directly, before Dan necessarily has a specific
-- contact person there, and (2) the negotiated split percentage itself.
--
-- Deliberately does NOT compute an actual commission split here — this
-- only stores the negotiated number per collaborator. Dan confirmed
-- 8/26/2026: a referral fee is typically 10-20% off the top of the gross
-- commission (before any split), while a co-broker split (50/50 or 60/40
-- typical) divides what's left after any referral fee — so split_pct's
-- meaning depends on `role`, and the exact number varies deal-by-deal with
-- no fixed default. Turning this into an actual computed dollar split
-- needs the still-unbuilt 8/23/2026 deal-value/EV scoring (price x
-- commission rate) — out of scope here.

alter table project_contacts
  alter column contact_id drop not null;

alter table project_contacts
  add column entity_id uuid references entities(id) on delete cascade;

alter table project_contacts
  add column split_pct numeric;

alter table project_contacts
  add constraint project_contacts_contact_or_entity
    check (contact_id is not null or entity_id is not null);

create index idx_project_contacts_entity on project_contacts(entity_id);

-- Lets an entity-only collaborator link (no contact_id) also be re-linked/
-- updated by upsert, same "re-linking updates instead of duplicating"
-- semantics the existing (project_id, contact_id) unique constraint gives
-- contact-based links. No WHERE clause needed — Postgres unique indexes
-- already treat NULL as distinct from NULL, so multiple contact-only rows
-- (entity_id null) for the same project are still allowed; this only
-- enforces uniqueness once entity_id is actually set. (A partial index
-- with an explicit WHERE clause would also work, but a plain ON CONFLICT
-- upsert can't target a partial unique index without repeating its WHERE
-- predicate, which the Supabase client's upsert() doesn't support — so
-- this stays a plain index deliberately.)
create unique index idx_project_contacts_project_entity_unique
  on project_contacts(project_id, entity_id);
