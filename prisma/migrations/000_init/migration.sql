-- CreateTable
CREATE TABLE "firms" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "cbi_registration" VARCHAR(100),
    "subscription_tier" VARCHAR(50) NOT NULL DEFAULT 'starter',
    "subscription_status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "gdpr_status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "import_mapping" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "pcf_role" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sessions_revoked_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "policy_number" TEXT NOT NULL,
    "policy_number_normalized" TEXT,
    "policy_type" TEXT NOT NULL,
    "insurer_name" TEXT NOT NULL,
    "inception_date" TIMESTAMP(3) NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "premium" DECIMAL(10,2) NOT NULL,
    "commission_rate" DECIMAL(5,2),
    "ncb" INTEGER,
    "policy_status" TEXT NOT NULL DEFAULT 'active',
    "dedup_hash" TEXT,
    "dedup_confidence" DECIMAL(3,2) NOT NULL DEFAULT 1.0,
    "adviser_id" TEXT,
    "import_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewals" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "new_premium" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "renewals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "renewal_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assigned_to" TEXT,
    "completed_by" TEXT,
    "completed_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "evidence_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "renewal_id" TEXT,
    "document_type" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "generated_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "cpc_version" TEXT NOT NULL DEFAULT '2012',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imports" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "source_format" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL,
    "imported_rows" INTEGER NOT NULL,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_by" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "renewal_id" TEXT,
    "reminder_type" TEXT NOT NULL,
    "sent_to" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pcf_roles" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "last_confirmation_date" TIMESTAMP(3),
    "next_confirmation_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pcf_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conduct_trainings" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "module_name" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3),
    "score" INTEGER,
    "evidence_url" TEXT,

    CONSTRAINT "conduct_trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attestations" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "signed_by" TEXT,

    CONSTRAINT "attestations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpc_rules" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requires_sign_off" BOOLEAN NOT NULL DEFAULT false,
    "evidence_required" BOOLEAN NOT NULL DEFAULT false,
    "policy_types" TEXT[] DEFAULT ARRAY['all']::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpc_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_ingress_configs" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "forwarding_address" VARCHAR(255),
    "provider" VARCHAR(50),
    "oauth_access_token_encrypted" TEXT,
    "oauth_refresh_token_encrypted" TEXT,
    "oauth_expires_at" TIMESTAMP(3),
    "imap_host" VARCHAR(255),
    "imap_port" INTEGER,
    "imap_username" VARCHAR(255),
    "imap_password_encrypted" TEXT,
    "execution_mode" TEXT NOT NULL DEFAULT 'suggestion',
    "confidence_threshold" DECIMAL(3,2) NOT NULL DEFAULT 0.95,
    "process_attachments" BOOLEAN NOT NULL DEFAULT true,
    "email_folder_filter" TEXT[],
    "insurer_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notify_on_action" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "notify_channel" VARCHAR(20) NOT NULL DEFAULT 'dashboard',
    "notify_digest_mode" VARCHAR(20) NOT NULL DEFAULT 'realtime',
    "digest_enabled" BOOLEAN NOT NULL DEFAULT true,
    "digest_time" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "urgent_notifications" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_polled_at" TIMESTAMP(3),
    "last_error" TEXT,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_ingress_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incoming_emails" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "message_id" VARCHAR(500) NOT NULL,
    "in_reply_to" VARCHAR(500),
    "thread_id" VARCHAR(500),
    "from_address" VARCHAR(500) NOT NULL,
    "to_addresses" TEXT[],
    "cc_addresses" TEXT[],
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "body_text" TEXT,
    "body_html" TEXT,
    "is_insurance" BOOLEAN,
    "category" VARCHAR(50),
    "priority" VARCHAR(20),
    "classification_confidence" DECIMAL(3,2),
    "status" TEXT NOT NULL DEFAULT 'pending_processing',
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "raw_url" VARCHAR(500),
    "pipeline_step" VARCHAR(50),
    "processing_started_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incoming_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_attachments" (
    "id" TEXT NOT NULL,
    "email_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(100),
    "size_bytes" INTEGER,
    "storage_url" VARCHAR(500),
    "extracted_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_actions" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "email_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "match_confidence" DECIMAL(3,2),
    "changes" JSONB NOT NULL DEFAULT '{}',
    "confidence" DECIMAL(3,2) NOT NULL,
    "reasoning" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "mode" TEXT NOT NULL DEFAULT 'suggestion',
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "modified_fields" JSONB,
    "rejected_reason" TEXT,
    "executed_at" TIMESTAMP(3),
    "is_reversed" BOOLEAN NOT NULL DEFAULT false,
    "reversed_by" TEXT,
    "reversed_at" TIMESTAMP(3),
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_action_modifications" (
    "id" TEXT NOT NULL,
    "action_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "field_name" VARCHAR(100) NOT NULL,
    "original_value" TEXT,
    "corrected_value" TEXT,
    "modified_by" TEXT,
    "modified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_action_modifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_metrics_daily" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "emails_received" INTEGER NOT NULL DEFAULT 0,
    "emails_processed" INTEGER NOT NULL DEFAULT 0,
    "emails_not_insurance" INTEGER NOT NULL DEFAULT 0,
    "actions_created" INTEGER NOT NULL DEFAULT 0,
    "actions_confirmed" INTEGER NOT NULL DEFAULT 0,
    "actions_modified" INTEGER NOT NULL DEFAULT 0,
    "actions_rejected" INTEGER NOT NULL DEFAULT 0,
    "actions_auto_executed" INTEGER NOT NULL DEFAULT 0,
    "avg_confidence" DECIMAL(3,2),
    "avg_processing_time_ms" INTEGER,
    "time_saved_minutes" INTEGER,

    CONSTRAINT "agent_metrics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_firm_id_idx" ON "users"("firm_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "clients_firm_id_idx" ON "clients"("firm_id");

-- CreateIndex
CREATE INDEX "policies_firm_id_idx" ON "policies"("firm_id");

-- CreateIndex
CREATE INDEX "policies_client_id_idx" ON "policies"("client_id");

-- CreateIndex
CREATE INDEX "policies_expiry_date_idx" ON "policies"("expiry_date");

-- CreateIndex
CREATE INDEX "policies_firm_id_policy_number_normalized_idx" ON "policies"("firm_id", "policy_number_normalized");

-- CreateIndex
CREATE INDEX "policies_firm_id_dedup_hash_idx" ON "policies"("firm_id", "dedup_hash");

-- CreateIndex
CREATE INDEX "policies_firm_id_policy_status_idx" ON "policies"("firm_id", "policy_status");

-- CreateIndex
CREATE INDEX "renewals_firm_id_idx" ON "renewals"("firm_id");

-- CreateIndex
CREATE INDEX "renewals_due_date_idx" ON "renewals"("due_date");

-- CreateIndex
CREATE INDEX "renewals_status_idx" ON "renewals"("status");

-- CreateIndex
CREATE INDEX "checklist_items_renewal_id_idx" ON "checklist_items"("renewal_id");

-- CreateIndex
CREATE INDEX "checklist_items_status_idx" ON "checklist_items"("status");

-- CreateIndex
CREATE INDEX "documents_firm_id_idx" ON "documents"("firm_id");

-- CreateIndex
CREATE INDEX "documents_renewal_id_idx" ON "documents"("renewal_id");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "imports_firm_id_idx" ON "imports"("firm_id");

-- CreateIndex
CREATE INDEX "audit_events_firm_id_timestamp_idx" ON "audit_events"("firm_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_idx" ON "audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events"("actor_id");

-- CreateIndex
CREATE INDEX "notifications_firm_id_idx" ON "notifications"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_renewal_id_reminder_type_key" ON "notifications"("renewal_id", "reminder_type");

-- CreateIndex
CREATE INDEX "scheduled_jobs_status_scheduled_for_idx" ON "scheduled_jobs"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "pcf_roles_firm_id_idx" ON "pcf_roles"("firm_id");

-- CreateIndex
CREATE INDEX "conduct_trainings_firm_id_idx" ON "conduct_trainings"("firm_id");

-- CreateIndex
CREATE INDEX "attestations_firm_id_idx" ON "attestations"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_idx" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expires_at_idx" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "cpc_rules_firm_id_idx" ON "cpc_rules"("firm_id");

-- CreateIndex
CREATE INDEX "cpc_rules_firm_id_rule_type_idx" ON "cpc_rules"("firm_id", "rule_type");

-- CreateIndex
CREATE UNIQUE INDEX "cpc_rules_firm_id_rule_id_key" ON "cpc_rules"("firm_id", "rule_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_ingress_configs_firm_id_key" ON "email_ingress_configs"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_ingress_configs_forwarding_address_key" ON "email_ingress_configs"("forwarding_address");

-- CreateIndex
CREATE INDEX "incoming_emails_firm_id_status_idx" ON "incoming_emails"("firm_id", "status");

-- CreateIndex
CREATE INDEX "incoming_emails_firm_id_received_at_idx" ON "incoming_emails"("firm_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "incoming_emails_firm_id_thread_id_idx" ON "incoming_emails"("firm_id", "thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "incoming_emails_firm_id_message_id_key" ON "incoming_emails"("firm_id", "message_id");

-- CreateIndex
CREATE INDEX "email_attachments_email_id_idx" ON "email_attachments"("email_id");

-- CreateIndex
CREATE INDEX "agent_actions_firm_id_status_idx" ON "agent_actions"("firm_id", "status");

-- CreateIndex
CREATE INDEX "agent_actions_firm_id_created_at_idx" ON "agent_actions"("firm_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "agent_actions_email_id_idx" ON "agent_actions"("email_id");

-- CreateIndex
CREATE INDEX "agent_actions_entity_type_entity_id_idx" ON "agent_actions"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "agent_action_modifications_action_id_idx" ON "agent_action_modifications"("action_id");

-- CreateIndex
CREATE INDEX "agent_metrics_daily_firm_id_date_idx" ON "agent_metrics_daily"("firm_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "agent_metrics_daily_firm_id_date_key" ON "agent_metrics_daily"("firm_id", "date");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_adviser_id_fkey" FOREIGN KEY ("adviser_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_renewal_id_fkey" FOREIGN KEY ("renewal_id") REFERENCES "renewals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_renewal_id_fkey" FOREIGN KEY ("renewal_id") REFERENCES "renewals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_renewal_id_fkey" FOREIGN KEY ("renewal_id") REFERENCES "renewals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pcf_roles" ADD CONSTRAINT "pcf_roles_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conduct_trainings" ADD CONSTRAINT "conduct_trainings_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attestations" ADD CONSTRAINT "attestations_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpc_rules" ADD CONSTRAINT "cpc_rules_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_ingress_configs" ADD CONSTRAINT "email_ingress_configs_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_emails" ADD CONSTRAINT "incoming_emails_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "incoming_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_attachments" ADD CONSTRAINT "email_attachments_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_email_id_fkey" FOREIGN KEY ("email_id") REFERENCES "incoming_emails"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_action_modifications" ADD CONSTRAINT "agent_action_modifications_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "agent_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_action_modifications" ADD CONSTRAINT "agent_action_modifications_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_metrics_daily" ADD CONSTRAINT "agent_metrics_daily_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

