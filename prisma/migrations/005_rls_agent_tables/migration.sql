-- Row-Level Security (RLS) for agent tables.
-- Extends ADR-001 multi-tenant isolation to the 6 agent-related tables.

-- ═══════════════════════════════════════════════════════════════
-- 1. Enable RLS on all agent tables
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE email_ingress_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_action_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_metrics_daily ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════
-- 2. Create RLS policies (SELECT, INSERT, UPDATE, DELETE)
-- ═══════════════════════════════════════════════════════════════

-- Email Ingress Configs
CREATE POLICY firm_isolation ON email_ingress_configs
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Incoming Emails
CREATE POLICY firm_isolation ON incoming_emails
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Email Attachments
CREATE POLICY firm_isolation ON email_attachments
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Agent Actions
CREATE POLICY firm_isolation ON agent_actions
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Agent Action Modifications
CREATE POLICY firm_isolation ON agent_action_modifications
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());

-- Agent Metrics Daily
CREATE POLICY firm_isolation ON agent_metrics_daily
  USING (firm_id = get_current_firm_id())
  WITH CHECK (firm_id = get_current_firm_id());
