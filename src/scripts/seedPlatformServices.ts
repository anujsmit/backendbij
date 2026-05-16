import 'dotenv/config';
import { db } from '../db';
import { platformServices, services } from '../db/schema';
import { sql } from 'drizzle-orm';

async function seedPlatformServices() {
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

        // Get service IDs
        const servicesList = await db.select().from(services);
        const plumberService = servicesList.find(s => s.serviceName === 'plumber');
        const electricianService = servicesList.find(s => s.serviceName === 'electrician');

        if (!plumberService || !electricianService) {
            throw new Error('Service categories (plumber/electrician) not found. Please run seedServices.ts first.');
        }

        console.log(`✅ Found service categories - Plumber: ${plumberService.id}, Electrician: ${electricianService.id}`);

        // Check if platform services already exist
        const existingPlatformServices = await db.select().from(platformServices);
        if (existingPlatformServices.length > 0) {
            console.log('ℹ️  Platform services already exist in database:');
            existingPlatformServices.forEach(service => {
                console.log(`   - ${service.name} - NPR ${service.price}`);
            });
            console.log('✅ No seeding needed');
            return;
        }

        console.log('🌱 Seeding platform_services table...');

        // Plumbing services
        const plumbingServices = [
            { name: 'Bathroom tap', price: '500' },
            { name: 'Conceal change', price: '500' },
            { name: 'Shower fitting', price: '500' },
            { name: 'Commode spray fitting', price: '800' },
            { name: 'Commode fitting', price: '1500' },
            { name: 'Pena fitting and change', price: '1500' },
            { name: 'Normal basin fitting', price: '1200' },
            { name: 'Counter top basin fitting', price: '2500' },
            { name: 'Commode system change', price: '500' },
            { name: 'Tanki fitting only', price: '1000' },
            { name: 'New tanki fitting and new connections', price: '4000' },
        ];

        // Electrical services
        const electricalServices = [
            { name: 'Bulb change', price: '500' },
            { name: 'Fan change', price: '500' },
            { name: 'Power socket change', price: '500' },
            { name: 'Switch board change', price: '500' },
            { name: 'Geaser fitting', price: '1000' },
            { name: 'Geaser service', price: '1000' },
            { name: 'Fan repairing', price: '700' },
            { name: 'Fan coil change', price: '1200' },
            { name: 'Fan bearing change', price: '500' },
            { name: 'Fridge gas filling', price: '6000' },
            { name: 'Fridge system change', price: '4000' },
        ];

        // Prepare data for insertion
        const servicesToInsert = [
            ...plumbingServices.map(s => ({
                serviceId: plumberService.id,
                name: s.name,
                description: null,
                price: s.price,
                imageUrl: null,
                isActive: true,
            })),
            ...electricalServices.map(s => ({
                serviceId: electricianService.id,
                name: s.name,
                description: null,
                price: s.price,
                imageUrl: null,
                isActive: true,
            })),
        ];

        const result = await db.insert(platformServices)
            .values(servicesToInsert)
            .returning();

        console.log('✅ Seeded platform_services table successfully');
        console.log(`📊 Inserted ${result.length} platform services:`);
        console.log(`   - ${plumbingServices.length} plumbing services`);
        console.log(`   - ${electricalServices.length} electrical services`);

        console.log('\n📋 Plumbing Services:');
        plumbingServices.forEach(s => console.log(`   - ${s.name}: NPR ${s.price}`));

        console.log('\n⚡ Electrical Services:');
        electricalServices.forEach(s => console.log(`   - ${s.name}: NPR ${s.price}`));

    } catch (error) {
        console.error('❌ Failed to seed platform services:', error);

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

seedPlatformServices();
