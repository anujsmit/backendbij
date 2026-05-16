import 'dotenv/config';
import { db } from '../db';
import { services } from '../db/schema';
import { sql } from 'drizzle-orm';

async function seedServices() {
    try {
        // Check if DATABASE_URL is available
        if (!process.env.DATABASE_URL) {
            throw new Error('DATABASE_URL environment variable is not set');
        }

        console.log('🔌 Connecting to database...');
        console.log('📍 Database URL:', process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@'));

        // Test the connection first
        await db.execute(sql`SELECT 1`);
        console.log('✅ Database connection successful');

        // Check if services already exist
        const existingServices = await db.select().from(services);
        if (existingServices.length > 0) {
            console.log('ℹ️  Services already exist in database:');
            existingServices.forEach(service => {
                console.log(`   - ${service.serviceName} (ID: ${service.id})`);
            });
            console.log('✅ No seeding needed');
            return;
        }

        console.log('🌱 Seeding services table...');
        const result = await db.insert(services)
            .values([
                { id: 1, serviceName: 'plumber', description: 'Professional plumbing services (leak repair, pipe installation)', mapIconColor: '#0177b8', isActive: true },
                { id: 2, serviceName: 'electrician', description: 'Certified electrical services (wiring, fixtures, repairs)', mapIconColor: '#179d2e', isActive: true }
            ])
            .onConflictDoNothing()
            .returning();

        console.log('✅ Seeded services table successfully');
        console.log('📊 Inserted services:', result);
    } catch (error) {
        console.error('❌ Failed to seed services:', error);

        if (error instanceof Error) {
            if (error.message.includes('ECONNREFUSED')) {
                console.error('💡 Connection refused. Please check:');
                console.error('   1. Database server is running');
                console.error('   2. DATABASE_URL is correct');
                console.error('   3. Network connectivity');
                console.error('   4. Firewall settings');
            } else if (error.message.includes('DATABASE_URL')) {
                console.error('💡 Environment variable issue. Please check:');
                console.error('   1. .env file exists and has DATABASE_URL');
                console.error('   2. Running from correct directory');
            } else if (error.message.includes('authentication')) {
                console.error('💡 Authentication failed. Please check:');
                console.error('   1. Database credentials are correct');
                console.error('   2. Database user has proper permissions');
            }
        }

        // Log the full error for debugging
        console.error('🔍 Full error details:', {
            name: error instanceof Error ? error.name : 'Unknown',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
    } finally {
        process.exit(0);
    }
}

seedServices();
