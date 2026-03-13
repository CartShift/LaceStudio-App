/**
 * One-shot script: ensure users with the fixed UUIDs expected by auth.ts exist in the DB.
 * If a user exists with the right email but wrong ID, UPDATE it (ON UPDATE CASCADE propagates).
 * If no user exists, INSERT with the correct fixed ID directly.
 *
 * Run with:  npx tsx prisma/fix-seed-user-ids.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_USERS = [
	{ email: "admin@lacestudio.internal", id: "00000000-0000-0000-0000-000000000001", display_name: "LaceStudio Admin", role: "ADMIN" },
	{ email: "operator@lacestudio.internal", id: "00000000-0000-0000-0000-000000000002", display_name: "LaceStudio Operator", role: "OPERATOR" },
	{ email: "client@lacestudio.internal", id: "00000000-0000-0000-0000-000000000003", display_name: "LaceStudio Client", role: "CLIENT" }
];

async function main() {
	for (const u of SEED_USERS) {
		const existing = await prisma.user.findUnique({ where: { email: u.email } });

		if (!existing) {
			console.log(`[INSERT] ${u.email} with id=${u.id}`);
			await prisma.$executeRawUnsafe(
				`INSERT INTO users (id, email, display_name, role, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4::"UserRole", now(), now())
         ON CONFLICT (email) DO NOTHING`,
				u.id,
				u.email,
				u.display_name,
				u.role
			);
			continue;
		}

		if (existing.id === u.id) {
			console.log(`[OK]     ${u.email} already has correct id ${u.id}`);
			continue;
		}

		console.log(`[UPDATE] ${u.email}: ${existing.id} → ${u.id}`);
		// ON UPDATE CASCADE propagates to ai_models.created_by etc.
		await prisma.$executeRawUnsafe(`UPDATE users SET id = $1::uuid WHERE email = $2`, u.id, u.email);
		console.log(`         Done.`);
	}

	const count = await prisma.user.count();
	console.log(`\nDone. users table now has ${count} row(s).`);
}

main()
	.catch(err => {
		console.error(err);
		process.exit(1);
	})
	.finally(() => prisma.$disconnect());
