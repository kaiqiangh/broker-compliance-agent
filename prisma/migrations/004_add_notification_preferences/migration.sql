-- AlterTable: Add notification preferences to email_ingress_configs
ALTER TABLE "email_ingress_configs" ADD COLUMN "notify_on_action" VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE "email_ingress_configs" ADD COLUMN "notify_channel" VARCHAR(20) NOT NULL DEFAULT 'dashboard';
ALTER TABLE "email_ingress_configs" ADD COLUMN "notify_digest_mode" VARCHAR(20) NOT NULL DEFAULT 'realtime';
