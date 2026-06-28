// backend/src/services/dispatch.ts

/**
 * Sequential "ping the nearest mistri" dispatch engine (backend-only model).
 *
 * When a customer broadcasts a service request (no pre-selected mistri), we
 * build an ordered candidate list (nearest first when GPS is known, else
 * best-rated / most-experienced) of approved, available mistris of that trade
 * and PUSH them one at a time, 60s apart. Any mistri can still accept from
 * their pending list (first-come-first-served) — the ping just concentrates
 * attention in order. When the list is exhausted (or empty), the request
 * simply stays `pending`/unassigned, where it surfaces in the admin ops
 * console for manual assignment.
 *
 * State is in-memory (single API instance). On restart, in-flight pings stop
 * and the request falls back to the admin board; recent ones are re-engaged
 * by resumeRecentDispatches() at boot.
 */
import { db } from "../db";
import { 
    serviceRequests, 
    mistriProfiles, 
    mistriAccounts,  // ✅ Changed from users
    services 
} from "../db/schema";
import { and, eq, isNull, gte, sql } from "drizzle-orm";
import { createNotification } from "../controllers/notificationController";
import { logger } from "../utils/logger";

const OFFER_MS = 60_000;   // 1 minute per mistri
const RADIUS_KM = 15;      // skip GPS-known mistris farther than this
const RESUME_WINDOW_MS = 10 * 60_000; // re-engage requests created in the last 10 min on boot

interface DispatchState {
    requestId: string;
    type: string;
    address: string;
    candidateIds: string[];
    index: number;
    timer: ReturnType<typeof setTimeout> | null;
}

const active = new Map<string, DispatchState>();

// ============================================
// HELPER FUNCTIONS
// ============================================

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseLoc(loc: unknown): { lat: number; lng: number } | null {
    if (typeof loc !== "string" || !loc.includes(",")) return null;
    const [la, ln] = loc.split(",").map((x) => parseFloat(x.trim()));
    if (Number.isFinite(la) && Number.isFinite(ln)) return { lat: la, lng: ln };
    return null;
}

// ============================================
// PUBLIC FUNCTIONS
// ============================================

/** Stop pinging a request and drop its timer. Safe to call repeatedly. */
export function stopDispatch(requestId: string): void {
    const s = active.get(requestId);
    if (s?.timer) clearTimeout(s.timer);
    active.delete(requestId);
    logger.info(`[dispatch] Stopped dispatch for request ${requestId}`);
}

/** Begin (or restart) the sequential ping for a broadcast request. */
export async function initiateDispatch(requestId: string): Promise<void> {
    try {
        const [r] = await db
            .select()
            .from(serviceRequests)
            .where(eq(serviceRequests.id, requestId))
            .limit(1);
        
        if (!r || r.status !== "pending" || r.assignedMistriId) {
            logger.info(`[dispatch] Request ${requestId} is not pending or already assigned`);
            return;
        }

        // ✅ Query mistriAccounts instead of users
        const rows = await db
            .select({
                id: mistriAccounts.id,
                currentLocation: mistriProfiles.currentLocation,
                isAvailable: mistriProfiles.isAvailable,
                averageRating: mistriProfiles.averageRating,
                jobsCompleted: mistriProfiles.jobsCompleted,
            })
            .from(mistriAccounts)  // ✅ Changed from users
            .innerJoin(mistriProfiles, eq(mistriAccounts.id, mistriProfiles.mistriId))
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
            .where(
                and(
                    eq(mistriAccounts.accountType, "mistri"),      // ✅ Changed from users.role
                    eq(mistriAccounts.isActive, true),             // ✅ Changed from users.isActive
                    eq(mistriProfiles.approvalStatus, "approved"),
                    eq(mistriProfiles.isAvailable, true),
                    sql`LOWER(${services.serviceName}) = ${r.type.toLowerCase()}`
                )
            );

        const reqLat = parseFloat(r.lat as string);
        const reqLng = parseFloat(r.lng as string);
        const haveReqGps = Number.isFinite(reqLat) && Number.isFinite(reqLng);

        const ranked = rows
            .map((m) => {
                let dist = Number.POSITIVE_INFINITY;
                const loc = parseLoc(m.currentLocation);
                if (haveReqGps && loc) dist = haversineKm(reqLat, reqLng, loc.lat, loc.lng);
                return { 
                    id: m.id, 
                    dist, 
                    rating: parseFloat(m.averageRating ?? "0"), 
                    jobs: m.jobsCompleted ?? 0 
                };
            })
            // keep GPS-known mistris within radius; GPS-unknown ones still allowed (ranked last)
            .filter((m) => m.dist === Number.POSITIVE_INFINITY || m.dist <= RADIUS_KM)
            .sort((a, b) => {
                if (a.dist !== b.dist) return a.dist - b.dist;
                if (a.rating !== b.rating) return b.rating - a.rating;
                return b.jobs - a.jobs;
            });

        const candidateIds = ranked.map((m) => m.id);
        if (candidateIds.length === 0) {
            logger.info(`[dispatch] no available ${r.type} mistris for request ${requestId} — left for admin`);
            return;
        }

        stopDispatch(requestId);
        active.set(requestId, {
            requestId,
            type: r.type as string,
            address: r.address,
            candidateIds,
            index: -1,
            timer: null,
        });
        await advance(requestId);
    } catch (err) {
        logger.error("[dispatch] initiate error:", err);
    }
}

async function advance(requestId: string): Promise<void> {
    const state = active.get(requestId);
    if (!state) return;

    // Bail out the moment the request leaves the pending/unassigned state.
    try {
        const [r] = await db
            .select({ 
                status: serviceRequests.status, 
                assignedMistriId: serviceRequests.assignedMistriId 
            })
            .from(serviceRequests)
            .where(eq(serviceRequests.id, requestId))
            .limit(1);
        if (!r || r.status !== "pending" || r.assignedMistriId) {
            stopDispatch(requestId);
            return;
        }
    } catch (err) {
        logger.error("[dispatch] status re-check failed:", err);
        return;
    }

    state.index += 1;
    if (state.index >= state.candidateIds.length) {
        logger.info(`[dispatch] exhausted candidates for request ${requestId} — needs manual assign`);
        stopDispatch(requestId);
        return;
    }

    const mistriId = state.candidateIds[state.index];
    try {
        // ✅ Get mistri name for notification
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.id, mistriId),
        });

        await createNotification(
            mistriId,
            "New job nearby",
            `A ${state.type} request at ${state.address} is available. Open ServeX to accept.`,
            "new_request",
            requestId
        );
        
        logger.info(`[dispatch] Notified mistri ${mistri?.fullName || mistriId} for request ${requestId} (${state.index + 1}/${state.candidateIds.length})`);
    } catch (err) {
        logger.error("[dispatch] notify error:", err);
    }

    state.timer = setTimeout(() => { void advance(requestId); }, OFFER_MS);
}

/** Re-engage recent pending/unassigned requests after an API restart. */
export async function resumeRecentDispatches(): Promise<void> {
    try {
        const since = new Date(Date.now() - RESUME_WINDOW_MS);
        const rows = await db
            .select({ id: serviceRequests.id })
            .from(serviceRequests)
            .where(
                and(
                    eq(serviceRequests.status, "pending"),
                    isNull(serviceRequests.assignedMistriId),
                    gte(serviceRequests.createdAt, since)
                )
            );
        if (rows.length === 0) {
            logger.info("[dispatch] No recent pending requests to resume");
            return;
        }
        logger.info(`[dispatch] resuming ${rows.length} recent pending request(s)`);
        for (const row of rows) {
            await initiateDispatch(row.id);
        }
    } catch (err) {
        logger.error("[dispatch] resume error:", err);
    }
}

// ============================================
// ADDITIONAL UTILITY FUNCTIONS
// ============================================

/**
 * Get dispatch status for a request
 */
export function getDispatchStatus(requestId: string): {
    isActive: boolean;
    candidateCount: number;
    currentIndex: number;
    timeRemaining: number | null;
} {
    const state = active.get(requestId);
    if (!state) {
        return {
            isActive: false,
            candidateCount: 0,
            currentIndex: -1,
            timeRemaining: null,
        };
    }

    return {
        isActive: true,
        candidateCount: state.candidateIds.length,
        currentIndex: state.index,
        timeRemaining: state.timer ? OFFER_MS : null,
    };
}

/**
 * Get all active dispatch states
 */
export function getAllActiveDispatches(): Record<string, DispatchState> {
    const result: Record<string, DispatchState> = {};
    for (const [key, value] of active) {
        result[key] = {
            ...value,
            timer: null, // Don't serialize timer
        };
    }
    return result;
}

/**
 * Force dispatch to a specific mistri (bypass sequential order)
 */
export async function forceDispatch(requestId: string, mistriId: string): Promise<boolean> {
    try {
        // Check if request exists and is pending
        const [request] = await db
            .select()
            .from(serviceRequests)
            .where(eq(serviceRequests.id, requestId))
            .limit(1);

        if (!request || request.status !== "pending" || request.assignedMistriId) {
            return false;
        }

        // Check if mistri is available
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.id, mistriId),
        });

        if (!mistri || mistri.accountType !== "mistri") {
            return false;
        }

        const profile = await db.query.mistriProfiles.findFirst({
            where: eq(mistriProfiles.mistriId, mistriId),
        });

        if (!profile || !profile.isAvailable || profile.approvalStatus !== "approved") {
            return false;
        }

        // Stop current dispatch
        stopDispatch(requestId);

        // Update request
        await db.update(serviceRequests)
            .set({
                status: "assigned",
                assignedMistriId: mistriId,
                assignedAt: new Date(),
            })
            .where(eq(serviceRequests.id, requestId));

        // Update mistri availability
        await db.update(mistriProfiles)
            .set({
                availabilityStatus: "unavailable",
                isAvailable: false,
            })
            .where(eq(mistriProfiles.mistriId, mistriId));

        // Notify mistri
        await createNotification(
            mistriId,
            "Service Request Assigned",
            `You have been assigned a ${request.type} service request at ${request.address}.`,
            "new_request",
            requestId
        );

        // Notify customer
        await createNotification(
            request.customerId,
            "Service Request Assigned",
            `${mistri.fullName} has been assigned to your service request.`,
            "request_assigned",
            requestId
        );

        return true;
    } catch (err) {
        logger.error(`[dispatch] force dispatch error for request ${requestId}:`, err);
        return false;
    }
}

/**
 * Clear all active dispatches
 */
export function clearAllDispatches(): void {
    for (const [requestId, state] of active) {
        if (state.timer) clearTimeout(state.timer);
    }
    active.clear();
    logger.info("[dispatch] Cleared all active dispatches");
}