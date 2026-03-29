-- Row-Level Security (RLS) migration for multi-tenant isolation.
-- ADR-001: Each firm can only see its own data.

-- ═══════════════════════════════════════════════════════════════
-- 1. Create function to set/get current firm context
-- ═══════════════════════════════════════════════════════════════

-- Function to set the current firm_id for this session
-- Uses session-scoped (false) so it persists across queries in the same connection
CREATE OR REPLACE FUNCTION set_current_firm_id(firm_id TEXT)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_firm_id', firm_id, false); -- false = session-scoped
END;
$$ LANGUAGE plpgsql;

-- Function to get the current firm_id
CREATE OR REPLACE FUNCTION get_current_firm_id()
RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.current_firm_id', true);
EXCEPTION
  WHEN undefined_object THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- ═══════════════════════════════════════════════════════════════
-- 2. Enable RLS on all firm-scoped tables
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewals ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE pcf_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE conduct_trainings ENABLE ROW LEVEL SECURITY;
ALTER TABLE attestations ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- 3. Create RLS policies (SELECT, INSERT, UPDATE, DELETE)
-- ═══════════════════════════════════════════════════════════════

-- Clients
CREATE POLICY firm_isolation ON clients
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Policies
CREATE POLICY firm_isolation ON policies
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Renewals
CREATE POLICY firm_isolation ON renewals
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Checklist Items
CREATE POLICY firm_isolation ON checklist_items
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Documents
CREATE POLICY firm_isolation ON documents
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Imports
CREATE POLICY firm_isolation ON imports
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Audit Events (append-only: no UPDATE or DELETE allowed)
CREATE POLICY firm_isolation_select ON audit_events
  FOR SELECT USING (firm_id = get_current_firm_id());

CREATE POLICY firm_isolation_insert ON audit_events
  FOR INSERT WITH CHECK (firm_id = get_current_firm_id());

-- Deny UPDATE and DELETE on audit_events (append-only compliance)
CREATE POLICY no_update_audit ON audit_events
  FOR UPDATE USING (false);

CREATE POLICY no_delete_audit ON audit_events
  FOR DELETE USING (false);

-- Notifications
CREATE POLICY firm_isolation ON notifications
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- PCF Roles (Phase 2)
CREATE POLICY firm_isolation ON pcf_roles
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Conduct Trainings (Phase 2)
CREATE POLICY firm_isolation ON conduct_trainings
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Attestations (Phase 2)
CREATE POLICY firm_isolation ON attestations
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- ═══════════════════════════════════════════════════════════════
-- 4. Grant necessary permissions
-- ═══════════════════════════════════════════════════════════════

-- The database user needs EXECUTE on the helper functions
GRANT EXECUTE ON FUNCTION set_current_firm_id(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_current_firm_id() TO PUBLIC;

-- ═══════════════════════════════════════════════════════════════
-- Notes:
-- ═══════════════════════════════════════════════════════════════
-- RLS is enforced at the PostgreSQL level, NOT at the Prisma level.
-- Before every Prisma query, the application must call:
--   await prisma.$executeRaw`SELECT set_current_firm_id(${firmId})`
-- This is transaction-scoped, so it applies to all queries in the
-- same transaction.
--
-- The Prisma middleware (in prisma.ts) provides a WARNING layer
-- but the real enforcement is here at the DB level.
--
-- For superuser/admin access (migrations, seeds), RLS is bypassed
-- because superusers bypass RLS by default. To test RLS, use a
-- non-superuser database role.
