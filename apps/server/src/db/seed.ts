import { loadConfig } from '@domdelo/config';
import { sql } from 'drizzle-orm';

import { createDatabase } from './client.js';
import {
  caseConfirmations,
  cases,
  caseStatusHistory,
  caseWatchers,
  chatBindings,
  houseMembers,
  houses,
  users,
} from './schema.js';

const houseId = '11111111-1111-4111-8111-111111111111';
const demoUsers = [
  { id: '22222222-2222-4222-8222-222222222222', displayName: 'Анна Петрова', role: 'resident' as const },
  { id: '33333333-3333-4333-8333-333333333333', displayName: 'Михаил Соколов', role: 'resident' as const },
  { id: '44444444-4444-4444-8444-444444444444', displayName: 'Елена, диспетчер УК', role: 'dispatcher' as const },
  { id: '55555555-5555-4555-8555-555555555555', displayName: 'Илья, электрик', role: 'executor' as const },
  { id: '66666666-6666-4666-8666-666666666666', displayName: 'Ольга Смирнова', role: 'resident' as const },
  { id: '77777777-7777-4777-8777-777777777777', displayName: 'Павел Орлов', role: 'resident' as const },
  { id: '88888888-8888-4888-8888-888888888888', displayName: 'Мария Волкова', role: 'resident' as const },
  { id: '99999999-9999-4999-8999-999999999999', displayName: 'Алексей Морозов', role: 'resident' as const },
];

const config = loadConfig();
const { client, db } = createDatabase(config);

try {
  await db.transaction(async (tx) => {
    await tx
      .insert(houses)
      .values({
        id: houseId,
        address: 'г. Казань, ул. Спортивная, д. 12',
        normalizedAddress: 'казань|спортивная|12',
        isDemo: true,
      })
      .onConflictDoNothing();
    await tx.insert(users).values(demoUsers.map((user) => ({ ...user, isDemo: true }))).onConflictDoNothing();
    await tx
      .insert(houseMembers)
      .values(demoUsers.map((user) => ({ houseId, userId: user.id })))
      .onConflictDoNothing();
    await tx
      .insert(chatBindings)
      .values({
        id: '12121212-1212-4212-8212-121212121212',
        houseId,
        maxChatId: -1000128n,
        isDemo: true,
      })
      .onConflictDoNothing();

    await tx
      .insert(cases)
      .values([
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          number: 128,
          houseId,
          authorId: demoUsers[0]!.id,
          title: 'Не работает освещение в подъезде №2',
          description: 'На площадках второго и третьего этажей не горят лампы.',
          normalizedText: 'лестничная клетка площадках второго третьего этажей не горят лампы',
          category: 'lighting',
          entrance: '2',
          place: 'Лестничная клетка',
          status: 'registered',
          responsibleOrganization: 'УК «Наш дом»',
          isDemo: true,
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          number: 127,
          houseId,
          authorId: demoUsers[1]!.id,
          title: 'Сломана защёлка входной двери',
          description: 'Дверь первого подъезда не закрывается и остаётся открытой ночью.',
          normalizedText: 'входная дверь первого подъезда не закрывается остается открытой ночью',
          category: 'entrance',
          entrance: '1',
          place: 'Входная дверь',
          status: 'in_progress',
          responsibleOrganization: 'УК «Наш дом»',
          assignee: 'Мастер участка Сергей',
          version: 3,
          isDemo: true,
        },
      ])
      .onConflictDoNothing();

    await tx
      .insert(caseConfirmations)
      .values(demoUsers.filter((user) => user.role === 'resident').map((user) => ({
        caseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: user.id,
      })))
      .onConflictDoNothing();
    await tx
      .insert(caseConfirmations)
      .values(demoUsers.slice(0, 3).map((user) => ({
        caseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        userId: user.id,
      })))
      .onConflictDoNothing();
    await tx
      .insert(caseWatchers)
      .values(demoUsers.slice(0, 4).map((user) => ({
        caseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        userId: user.id,
      })))
      .onConflictDoNothing();
    await tx
      .insert(caseWatchers)
      .values(demoUsers.slice(0, 5).map((user) => ({
        caseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        userId: user.id,
      })))
      .onConflictDoNothing();

    await tx
      .insert(caseStatusHistory)
      .values([
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
          caseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          toStatus: 'registered',
          actorId: demoUsers[0]!.id,
          comment: 'Создано из сообщения в домовом чате',
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
          caseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          toStatus: 'registered',
          actorId: demoUsers[1]!.id,
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
          caseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          fromStatus: 'registered',
          toStatus: 'assigned',
          actorId: demoUsers[2]!.id,
          comment: 'Назначен мастер участка',
        },
        {
          id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
          caseId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          fromStatus: 'assigned',
          toStatus: 'in_progress',
          actorId: demoUsers[2]!.id,
        },
      ])
      .onConflictDoNothing();
    await tx.execute(
      sql`select setval(pg_get_serial_sequence('cases', 'number'), greatest((select max(number) from cases), 1))`,
    );
  });
  console.info('Demo data seeded');
} finally {
  await client.end();
}
