import { prisma } from '../lib/prisma';
import { pollConnectedMailboxes } from '../lib/email/oauth/poller';
import { pollIMAPConnections } from '../lib/email/imap/poller';
import {
  aggregateDailyMetrics,
  createAgentMaintenanceState,
  detectStaleEmails,
  processPendingEmails,
  runAgentMaintenanceTick,
} from './agent-runtime';

export {
  aggregateDailyMetrics,
  detectStaleEmails,
  processPendingEmails,
} from './agent-runtime';

// Run as standalone script
if (require.main === module) {
  async function main() {
    const command = process.argv[2];

    switch (command) {
      case 'process':
        const count = await processPendingEmails();
        console.log(`Processed ${count} emails`);
        break;
      case 'metrics':
        await aggregateDailyMetrics();
        console.log('Daily metrics aggregated');
        break;
      case 'stale':
        const requeued = await detectStaleEmails();
        console.log(`Re-queued ${requeued} stale emails`);
        break;
      case 'poll':
        const newEmails = await pollConnectedMailboxes();
        const imapNew = await pollIMAPConnections();
        console.log(`Polled mailboxes: ${newEmails + imapNew} new emails`);
        break;
      case 'all':
        const maintenanceState = createAgentMaintenanceState();
        const tick = await runAgentMaintenanceTick(maintenanceState);
        console.log(
          `Done: ${tick.processedEmails} emails processed, ${tick.requeuedEmails} re-queued, ${tick.polledEmails} polled`
        );
        break;
      default:
        console.log('Usage: tsx src/worker/agent-worker.ts [process|metrics|stale|all]');
    }

    await prisma.$disconnect();
  }

  main().catch(console.error);
}
