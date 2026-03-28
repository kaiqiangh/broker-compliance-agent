import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { computeDedupHash, normalizePolicyNumber } from '../src/lib/dedup';
import { subDays, addDays } from 'date-fns';
import { CHECKLIST_DEFINITIONS } from '../src/lib/checklist-state';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create firm
  const firm = await prisma.firm.create({
    data: {
      name: 'O\'Brien Insurance Brokers',
      cbiRegistration: 'CBI-12345',
    },
  });
  console.log(`Created firm: ${firm.name} (${firm.id})`);

  // Create users
  const passwordHash = await hash('password123', 10);

  const admin = await prisma.user.create({
    data: {
      firmId: firm.id,
      email: 'michael@obrien-insurance.ie',
      passwordHash,
      name: 'Michael O\'Brien',
      role: 'firm_admin',
    },
  });

  const co = await prisma.user.create({
    data: {
      firmId: firm.id,
      email: 'sarah@obrien-insurance.ie',
      passwordHash,
      name: 'Sarah Collins',
      role: 'compliance_officer',
    },
  });

  const adviser = await prisma.user.create({
    data: {
      firmId: firm.id,
      email: 'david@obrien-insurance.ie',
      passwordHash,
      name: 'David Murphy',
      role: 'adviser',
    },
  });

  console.log(`Created ${3} users`);

  // Create clients
  const clientData = [
    { name: 'Seán Ó Briain', email: 'sean@example.ie', phone: '087 123 4567', address: '14 Main Street, Dublin 4' },
    { name: 'Áine Murphy', email: 'aine@example.ie', phone: '086 234 5678', address: '22 Patrick\'s Road, Cork' },
    { name: 'Patrick Kelly', email: 'patrick@example.ie', phone: '085 345 6789', address: '8 Bridge Street, Galway' },
    { name: 'Máire Ní Chonaill', email: 'maire@example.ie', phone: '089 456 7890', address: '' },
    { name: 'Cormac Brennan', email: 'cormac@example.ie', phone: '087 567 8901', address: 'Unit 5 Industrial Estate, Limerick' },
    { name: 'Niamh Fitzgerald', email: 'niamh@example.ie', phone: '086 678 9012', address: '17 O\'Connell Street, Dublin 1' },
    { name: 'Conor O\'Neill', email: 'conor@example.ie', phone: '085 789 0123', address: '33 Patrick Street, Cork' },
    { name: 'Siobhán Doyle', email: 'siobhan@example.ie', phone: '089 890 1234', address: '9 Eyre Square, Galway' },
  ];

  const clients = await Promise.all(
    clientData.map(cd => prisma.client.create({ data: { firmId: firm.id, ...cd } }))
  );
  console.log(`Created ${clients.length} clients`);

  // Create policies
  const now = new Date();
  const policyData = [
    { clientIdx: 0, policyNumber: 'POL-2024-001', type: 'motor', insurer: 'Aviva', inception: subDays(now, 365), expiry: addDays(now, 45), premium: 1245, ncb: 5 },
    { clientIdx: 0, policyNumber: 'POL-2024-002', type: 'home', insurer: 'Zurich', inception: subDays(now, 300), expiry: addDays(now, 65), premium: 890, ncb: null },
    { clientIdx: 1, policyNumber: 'POL-2024-003', type: 'motor', insurer: 'Allianz', inception: subDays(now, 350), expiry: addDays(now, 15), premium: 1580, ncb: 3 },
    { clientIdx: 2, policyNumber: 'POL-2024-004', type: 'commercial', insurer: 'FBD', inception: subDays(now, 365), expiry: addDays(now, -5), premium: 4200, ncb: null },
    { clientIdx: 3, policyNumber: 'POL-2024-005', type: 'motor', insurer: 'Liberty', inception: subDays(now, 260), expiry: addDays(now, 105), premium: 980, ncb: 7 },
    { clientIdx: 4, policyNumber: 'POL-2024-006', type: 'motor', insurer: 'Aviva', inception: subDays(now, 340), expiry: addDays(now, 25), premium: 1100, ncb: 4 },
    { clientIdx: 5, policyNumber: 'POL-2024-007', type: 'home', insurer: 'Allianz', inception: subDays(now, 320), expiry: addDays(now, 45), premium: 750, ncb: null },
    { clientIdx: 6, policyNumber: 'POL-2024-008', type: 'motor', insurer: 'Zurich', inception: subDays(now, 310), expiry: addDays(now, 55), premium: 1350, ncb: 6 },
    { clientIdx: 7, policyNumber: 'POL-2024-009', type: 'commercial', insurer: 'FBD', inception: subDays(now, 300), expiry: addDays(now, 65), premium: 3800, ncb: null },
    { clientIdx: 7, policyNumber: 'POL-2024-010', type: 'motor', insurer: 'Aviva', inception: subDays(now, 250), expiry: addDays(now, 115), premium: 1420, ncb: 2 },
  ];

  const policies = await Promise.all(
    policyData.map(async pd => {
      const dedupHash = computeDedupHash({
        firmId: firm.id,
        policyNumber: pd.policyNumber,
        policyType: pd.type,
        insurerName: pd.insurer,
        inceptionDate: pd.inception.toISOString().slice(0, 10),
      });

      return prisma.policy.create({
        data: {
          firmId: firm.id,
          clientId: clients[pd.clientIdx].id,
          policyNumber: pd.policyNumber,
          policyNumberNormalized: normalizePolicyNumber(pd.policyNumber),
          policyType: pd.type,
          insurerName: pd.insurer,
          inceptionDate: pd.inception,
          expiryDate: pd.expiry,
          premium: pd.premium,
          ncb: pd.ncb,
          policyStatus: 'active',
          dedupHash,
          dedupConfidence: 1.0,
          adviserId: adviser.id,
        },
      });
    })
  );
  console.log(`Created ${policies.length} policies`);

  // Generate renewals for policies expiring within 90 days
  const expiringPolicies = policies.filter(p => {
    const daysUntil = Math.ceil((p.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntil <= 90 && daysUntil >= -30;
  });

  for (const policy of expiringPolicies) {
    const renewal = await prisma.renewal.create({
      data: {
        firmId: firm.id,
        policyId: policy.id,
        dueDate: policy.expiryDate,
        status: policy.expiryDate < now ? 'overdue' : 'pending',
      },
    });

    // Create checklist items
    for (const itemDef of CHECKLIST_DEFINITIONS) {
      await prisma.checklistItem.create({
        data: {
          firmId: firm.id,
          renewalId: renewal.id,
          itemType: itemDef.type,
          status: 'pending',
          assignedTo: adviser.id,
        },
      });
    }
  }
  console.log(`Created ${expiringPolicies.length} renewals with checklists`);

  // Create some audit events
  await prisma.auditEvent.createMany({
    data: [
      { firmId: firm.id, actorId: admin.id, action: 'firm.created', entityType: 'firm', entityId: firm.id },
      { firmId: firm.id, actorId: admin.id, action: 'user.invited', entityType: 'user', entityId: co.id, metadata: { role: 'compliance_officer' } },
      { firmId: firm.id, actorId: admin.id, action: 'user.invited', entityType: 'user', entityId: adviser.id, metadata: { role: 'adviser' } },
      { firmId: firm.id, actorId: admin.id, action: 'policy.import', entityType: 'import', metadata: { count: policies.length, format: 'seed' } },
    ],
  });

  console.log('Seed complete!');
  console.log(`\nLogin credentials:`);
  console.log(`  Admin:  michael@obrien-insurance.ie / password123`);
  console.log(`  CO:     sarah@obrien-insurance.ie / password123`);
  console.log(`  Adviser: david@obrien-insurance.ie / password123`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
