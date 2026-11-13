// Usage: bun admin.ts <username> [--revoke]
//        bun admin.ts --invite
// Makes an account an admin (or, with --revoke, a regular user again). Admins can reset
// passwords, make users mods, hand out invites and do everything mods can. --invite prints an
// invite link that expires in 14 days, for when no one can make one in the app yet. Needs
// DATABASE_URL (and PUBLIC_URL for a full link).
// With docker: docker compose exec web bun admin.ts <username>
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

// @ts-ignore bun globals aren't typed here
const args: string[] = Bun.argv.slice(2);
const revoke = args.includes('--revoke');
const invite = args.includes('--invite');
const username = args
	.find((a) => !a.startsWith('--'))
	?.replace(/^@/, '')
	.toLowerCase();

const usage = 'Usage: bun admin.ts <username> [--revoke]\n       bun admin.ts --invite';
if (
	invite ? args.length !== 1 : !username || args.some((a) => a.startsWith('--') && a !== '--revoke')
) {
	console.error(usage);
	process.exit(1);
}

// @ts-ignore bun globals aren't typed here
const url: string | undefined = Bun.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set');
	process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => undefined });

// same alphabet and length as src/lib/server/invites.ts (no 0/o, 1/l/i)
function inviteCode() {
	const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
	const limit = 256 - (256 % alphabet.length);
	let code = '';
	while (code.length < 12)
		for (const byte of randomBytes(24))
			if (byte < limit && code.length < 12) code += alphabet[byte % alphabet.length];
	return code;
}

if (invite) {
	try {
		const code = inviteCode();
		// an admin code of no one's: it doesn't come out of any account's invites
		await sql`
			INSERT INTO invites (code, by_staff, note, expires_at)
			VALUES (${code}, true, 'from the command line', NOW() + INTERVAL '14 days')
		`;
		// @ts-ignore bun globals aren't typed here
		const base = (Bun.env.PUBLIC_URL || 'http://localhost:7777').replace(/\/$/, '');
		console.log(`${base}/register?invite=${code}`);
	} finally {
		await sql.end();
	}
	process.exit(0);
}

try {
	const [user] = await sql<{ id: number; owner_id: number | null; role: string }[]>`
		SELECT id, owner_id, role FROM users WHERE username = ${username}
	`;
	if (!user) {
		console.error(`No user named @${username}`);
		process.exit(1);
	}
	// identities have no credentials of their own, roles belong to accounts
	if (user.owner_id !== null) {
		console.error(`@${username} is an identity: pick the account that owns it`);
		process.exit(1);
	}

	const role = revoke ? 'user' : 'admin';
	if (user.role === role) {
		console.log(`@${username} is already ${revoke ? 'not an admin' : 'an admin'}`);
	} else if (revoke && user.role !== 'admin') {
		console.log(`@${username} is not an admin (they are a ${user.role})`);
	} else {
		await sql`UPDATE users SET role = ${role} WHERE id = ${user.id}`;
		console.log(revoke ? `@${username} is no longer an admin` : `@${username} is now an admin`);
	}
} finally {
	await sql.end();
}
