import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
p.user
	.findMany()
	.then(u => {
		console.log("users count:", u.length);
		console.log(JSON.stringify(u, null, 2));
		return p.$disconnect();
	})
	.catch(e => {
		console.error(e);
		return p.$disconnect();
	});
