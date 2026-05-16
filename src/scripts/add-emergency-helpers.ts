// Helper functions for emergency service requests

import { db } from "../db";
import { serviceRequests, users, mistriProfiles, services, notifications } from "../db/schema";
import { eq, and, ne } from "drizzle-orm";
import { createNotification } from "../controllers/notificationController";

/**
 * Haversine formula to calculate distance between two points on Earth
 */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
}

/**
 * Broadcast emergency request to all nearby FULLY available mistris
 */
async function broadcastEmergencyRequest(
    request: any,
    customerLat: number,
    customerLng: number
) {
    // Get mistris where isAvailable=true AND availabilityStatus='available'
    // EXCLUDE 'on_work_available' and 'unavailable'
    const availableMistris = await db.select({
        id: users.id,
        fullName: users.fullName,
        deviceToken: users.deviceToken,
        currentLocation: mistriProfiles.currentLocation,
        serviceName: services.serviceName,
    })
    .from(mistriProfiles)
    .innerJoin(users, eq(mistriProfiles.userId, users.id))
    .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
    .where(
        and(
            eq(mistriProfiles.isAvailable, true),
            eq(mistriProfiles.availabilityStatus, 'available')
        )
    );

    // Filter by service type and 20km proximity
    const nearbyMistris = availableMistris.filter(mistri => {
        if (mistri.serviceName.toLowerCase() !== request.type.toLowerCase()) return false;
        if (!mistri.currentLocation) return false;

        try {
            const coords = mistri.currentLocation.split(',');
            const distance = calculateDistance(
                customerLat, customerLng,
                parseFloat(coords[0]), parseFloat(coords[1])
            );
            return distance <= 20;
        } catch { return false; }
    });

    if (nearbyMistris.length === 0) {
        // No available mistris - notify customer
        await createNotification(
            request.customerId,
            'No Mistris Available',
            'No mistris are available for your emergency request. Try again shortly.',
            'emergency_no_mistris',
            request.id
        );
        return;
    }

    // Create emergency notifications for ALL nearby mistris
    const notificationPromises = nearbyMistris.map(mistri =>
        createNotification(
            mistri.id,
            '🚨 EMERGENCY SERVICE REQUEST',
            `Urgent ${request.type} service at ${request.address}. Premium pricing applies.`,
            'emergency_request',
            request.id
        )
    );

    await Promise.all(notificationPromises);
    console.log(`Emergency ${request.id} broadcasted to ${nearbyMistris.length} mistris`);
}

/**
 * Auto-reject all other mistris who received the emergency request
 */
async function autoRejectOtherMistris(requestId: string, acceptedMistriId: string) {
    const otherNotifications = await db.select()
        .from(notifications)
        .where(
            and(
                eq(notifications.relatedRequestId, requestId),
                eq(notifications.type, 'emergency_request'),
                ne(notifications.userId, acceptedMistriId)
            )
        );

    const rejectionPromises = otherNotifications.map(notif =>
        createNotification(
            notif.userId,
            'Emergency Request Filled',
            'This emergency request was accepted by another mistri.',
            'emergency_filled',
            requestId
        )
    );

    await Promise.all(rejectionPromises);
}

export { calculateDistance, broadcastEmergencyRequest, autoRejectOtherMistris };
