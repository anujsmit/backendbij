import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/schema';
import { eq } from 'drizzle-orm';

const PHONE = '9862775193';
const FULL_NAME = 'Admin';

async function main() {
    const client = postgres(process.env.DATABASE_URL!);
    const db = drizzle(client, { schema });

    const existing = await db.query.users.findFirst({
        where: eq(schema.users.phoneNumber, PHONE),
    });

    if (existing) {
        const [updated] = await db
            .update(schema.users)
            .set({ role: 'admin', isActive: true, updatedAt: new Date() })
            .where(eq(schema.users.phoneNumber, PHONE))
            .returning();

        console.log('✅ Existing user promoted to admin:');
        console.log(`   ID:    ${updated.id}`);
        console.log(`   Name:  ${updated.fullName}`);
        console.log(`   Phone: ${updated.phoneNumber}`);
        console.log(`   Role:  ${updated.role}`);
    } else {
        const [created] = await db
            .insert(schema.users)
            .values({
                phoneNumber: PHONE,
                fullName: FULL_NAME,
                role: 'admin',
                isActive: true,
                isOnboarded: true,
                onboardingCompletedAt: new Date(),
                roleSelectedAt: new Date(),
            })
            .returning();

        console.log('✅ New admin user created:');
        console.log(`   ID:    ${created.id}`);
        console.log(`   Name:  ${created.fullName}`);
        console.log(`   Phone: ${created.phoneNumber}`);
        console.log(`   Role:  ${created.role}`);
    }

    await client.end();
}

main().catch((err) => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
});
