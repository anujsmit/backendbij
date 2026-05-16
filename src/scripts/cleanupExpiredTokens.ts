/**
 * Cleanup script to remove expired refresh tokens from the database
 * Run this periodically (e.g., daily via cron) to keep the table clean
 */

import { db } from "../db";
import { refreshTokens } from "../db/schema";
import { lt } from "drizzle-orm";

async function cleanupExpiredTokens() {
    try {
        const now = new Date();
        const result = await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, now));
        
        console.log(`✅ Cleaned up expired refresh tokens at ${now.toISOString()}`);
        // Note: result.rowCount might not be available depending on drizzle version
    } catch (error) {
        console.error("❌ Error cleaning up expired tokens:", error);
        process.exit(1);
    }
}

// Run cleanup
cleanupExpiredTokens()
    .then(() => {
        console.log("Cleanup completed successfully");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Cleanup failed:", error);
        process.exit(1);
    });

