import 'dotenv/config';
import { db } from '../db';
import { mistriProfiles, users, services } from '../db/schema';
import { eq } from 'drizzle-orm';

async function checkMistris() {
    try {
        console.log('🔍 Checking mistri profiles in database...\n');

        // Get all mistri profiles with user and service info
        const mistris = await db
            .select({
                userId: users.id,
                fullName: users.fullName,
                phoneNumber: users.phoneNumber,
                role: users.role,
                serviceId: mistriProfiles.serviceId,
                serviceName: services.serviceName,
                isAvailable: mistriProfiles.isAvailable,
                currentLocation: mistriProfiles.currentLocation,
                profilePhotoUrl: mistriProfiles.profilePhotoUrl,
            })
            .from(mistriProfiles)
            .innerJoin(users, eq(mistriProfiles.userId, users.id))
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id));

        console.log(`Found ${mistris.length} mistri profile(s)\n`);

        if (mistris.length === 0) {
            console.log('❌ No mistri profiles found in database');
            console.log('💡 This is why the app shows 0 available mistris');
            console.log('💡 You need to create mistri profiles by onboarding users as mistris\n');
        } else {
            console.log('📋 Mistri profiles:');
            mistris.forEach((mistri, index) => {
                console.log(`\n${index + 1}. ${mistri.fullName}`);
                console.log(`   Phone: ${mistri.phoneNumber}`);
                console.log(`   Service: ${mistri.serviceName} (ID: ${mistri.serviceId})`);
                console.log(`   Available: ${mistri.isAvailable}`);
                console.log(`   Location: ${mistri.currentLocation || 'Not set'}`);
                console.log(`   Role: ${mistri.role}`);
            });

            // Check available mistris
            const availableMistris = mistris.filter(m => m.isAvailable);
            console.log(`\n✅ ${availableMistris.length} mistri(s) marked as available`);

            // Check mistris with location
            const mistrisWithLocation = mistris.filter(m => m.currentLocation);
            console.log(`📍 ${mistrisWithLocation.length} mistri(s) have location set`);

            if (availableMistris.length === 0) {
                console.log('\n⚠️  No mistris are marked as available');
                console.log('💡 This is why the app shows 0 available mistris\n');
            } else if (mistrisWithLocation.length === 0) {
                console.log('\n⚠️  No mistris have their location set');
                console.log('💡 Mistris without location cannot be found on the map\n');
            }
        }
    } catch (error) {
        console.error('❌ Error checking mistris:', error);
    } finally {
        process.exit(0);
    }
}

checkMistris();
