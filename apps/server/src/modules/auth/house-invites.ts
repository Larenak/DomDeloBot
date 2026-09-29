import { createHash } from 'node:crypto';

import { and, eq, gt, isNull } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { auditLog, houseMembers, houseRoleGrants, houses, houseInvites, users } from '../../db/schema.js';
import { ForbiddenError } from '../../repositories/case-repository.js';

export function houseInviteHash(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export async function redeemHouseInvite(db: Database, userId: string, code: string): Promise<void> {
  await db.transaction(async (tx) => {
    // The MAX identity comes from the database, never from a request body or session claim.
    const [user] = await tx.select({ maxUserId: users.maxUserId })
      .from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.maxUserId) throw new ForbiddenError('Откройте приложение через MAX');

    const now = new Date();
    const [invite] = await tx.update(houseInvites)
      .set({ usedAt: now, usedBy: userId })
      .where(and(
        eq(houseInvites.codeHash, houseInviteHash(code)),
        eq(houseInvites.maxUserId, user.maxUserId),
        isNull(houseInvites.usedAt),
        gt(houseInvites.expiresAt, now),
      ))
      .returning({ houseId: houseInvites.houseId, role: houseInvites.role });
    if (!invite || !['resident', 'dispatcher', 'executor'].includes(invite.role)) {
      throw new ForbiddenError('Приглашение недействительно или срок его действия истёк');
    }

    const [house] = await tx.select({ id: houses.id }).from(houses)
      .where(and(eq(houses.id, invite.houseId), eq(houses.isDemo, false))).limit(1);
    if (!house) throw new ForbiddenError('Приглашение недействительно');

    await tx.insert(houseMembers)
      .values({ houseId: invite.houseId, userId, isFavorite: true, lastUsedAt: now })
      .onConflictDoUpdate({
        target: [houseMembers.houseId, houseMembers.userId],
        set: { isFavorite: true, lastUsedAt: now },
      });
    await tx.insert(houseRoleGrants)
      .values({ houseId: invite.houseId, userId, role: invite.role, source: 'house_invite', verifiedAt: now })
      .onConflictDoUpdate({
        target: [houseRoleGrants.houseId, houseRoleGrants.userId],
        set: { role: invite.role, source: 'house_invite', verifiedAt: now, expiresAt: null, revokedAt: null },
      });
    await tx.update(users).set({ activeHouseId: invite.houseId }).where(eq(users.id, userId));
    await tx.insert(auditLog).values({
      actorId: userId,
      action: 'house_invite.redeemed',
      entityType: 'house',
      entityId: invite.houseId,
      metadata: { role: invite.role },
    });
  });
}
