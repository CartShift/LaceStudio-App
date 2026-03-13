import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

// These UUIDs must stay in sync with ROLE_USER_IDS in src/lib/auth.ts.
// The API falls back to these hardcoded IDs when no session cookie is present,
// so these rows must exist in the `users` table to satisfy FK constraints.
const SEED_USERS = [
	{
		id: "00000000-0000-0000-0000-000000000001",
		email: "admin@lacestudio.internal",
		display_name: "LaceStudio Admin",
		role: UserRole.ADMIN
	},
	{
		id: "00000000-0000-0000-0000-000000000002",
		email: "operator@lacestudio.internal",
		display_name: "LaceStudio Operator",
		role: UserRole.OPERATOR
	},
	{
		id: "00000000-0000-0000-0000-000000000003",
		email: "client@lacestudio.internal",
		display_name: "LaceStudio Client",
		role: UserRole.CLIENT
	}
];

async function main() {
	for (const user of SEED_USERS) {
		await prisma.user.upsert({
			where: { email: user.email },
			create: user,
			update: { display_name: user.display_name, role: user.role }
		});
	}
}

main()
	.catch(error => {
		console.error(error);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
