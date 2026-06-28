// src/controllers/mistriController.ts
import { Request, Response } from "express";
import { db } from "../../db";
import { 
    users,              // Admin users only
    userAccounts,       // Customer accounts
    mistriAccounts,     // Mistri accounts ✅
    mistriProfiles, 
    services, 
    serviceRequests 
} from "../../db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { logger } from "../../utils/logger";

// Initialize Supabase client conditionally
let supabase: ReturnType<typeof createClient> | null = null;

try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    
    if (supabaseUrl && supabaseKey && supabaseUrl !== 'your-supabase-url' && supabaseKey !== 'your-supabase-key') {
        supabase = createClient(supabaseUrl, supabaseKey);
        logger.info('Supabase client initialized successfully');
    } else {
        logger.warn('Supabase environment variables not properly set. Image upload features will use fallback mode.');
    }
} catch (error) {
    logger.error('Failed to initialize Supabase client:', error);
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

async function compressAndUploadProfileImage(
    profilePhotoBase64: string,
    userId: string | number
): Promise<string> {
    if (!supabase) {
        logger.warn(`[DEV] Supabase not available. Returning placeholder for user ${userId}`);
        return `https://placehold.co/400x400/2196F3/FFFFFF?text=Mistri+${userId}`;
    }

    try {
        const rawBuffer = Buffer.from(profilePhotoBase64, 'base64');
        const compressedBuffer = await sharp(rawBuffer)
            .resize({ width: 400, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 65, progressive: true })
            .toBuffer();

        const fileName = `mistri_${userId}_${Date.now()}.jpg`;

        const { data: uploadData, error: uploadError } = await supabase
            .storage
            .from('profiles')
            .upload(fileName, compressedBuffer, { upsert: true, contentType: 'image/jpeg' });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
            .from('profiles')
            .getPublicUrl(uploadData.path);

        return urlData.publicUrl;
    } catch (error) {
        logger.error('Image upload error:', error);
        return `https://placehold.co/400x400/FF0000/FFFFFF?text=Error+${userId}`;
    }
}

async function uploadGovtIdImage(
    base64: string,
    label: 'front' | 'back',
    userId: string | number
): Promise<string> {
    if (!supabase) {
        logger.warn(`[DEV] Supabase not available. Returning placeholder for govt ID ${label}`);
        return `https://placehold.co/1200x800/FF9800/FFFFFF?text=Govt+ID+${label}`;
    }

    try {
        const rawBuffer = Buffer.from(base64, 'base64');
        const compressedBuffer = await sharp(rawBuffer)
            .resize({ width: 1200, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80, progressive: true })
            .toBuffer();

        const fileName = `govtid_${userId}_${label}_${Date.now()}.jpg`;

        const { data: uploadData, error: uploadError } = await supabase
            .storage
            .from('profiles')
            .upload(fileName, compressedBuffer, { upsert: true, contentType: 'image/jpeg' });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
            .from('profiles')
            .getPublicUrl(uploadData.path);

        return urlData.publicUrl;
    } catch (error) {
        logger.error(`Government ID (${label}) upload error:`, error);
        return `https://placehold.co/1200x800/FF0000/FFFFFF?text=Govt+ID+Error`;
    }
}

// ============================================
// CREATE MISTRI PROFILE
// ============================================

export const createMistriProfile = async (req: Request, res: Response) => {
    try {
        // ✅ FIXED: Use userId from decoded token
        const userId = (req as any).user?.userId;
        
        logger.info('Create Mistri Profile - User ID:', userId);
        
        if (!userId) {
            return res.status(401).json({ 
                success: false,
                message: "Unauthorized. Please login again." 
            });
        }

        // ✅ FIXED: Check if user exists in mistriAccounts (they should be a mistri)
        const mistri = await db.query.mistriAccounts.findFirst({
            where: eq(mistriAccounts.id, userId),
        });

        if (!mistri) {
            return res.status(404).json({ 
                success: false,
                message: "Mistri account not found" 
            });
        }

        const {
            serviceId,
            profilePhotoBase64,
            currentLocation,
            fullName,
            bio,
            experienceLevel,
            govtIdType,
            govtIdFrontBase64,
            govtIdBackBase64,
        } = req.body;

        // Validate required fields
        const missingFields = [];
        if (!serviceId) missingFields.push('serviceId');
        if (!profilePhotoBase64) missingFields.push('profilePhotoBase64');
        if (!currentLocation) missingFields.push('currentLocation');
        if (!fullName) missingFields.push('fullName');
        if (!bio) missingFields.push('bio');
        if (!experienceLevel) missingFields.push('experienceLevel');
        if (!govtIdType) missingFields.push('govtIdType');
        if (!govtIdFrontBase64) missingFields.push('govtIdFrontBase64');
        if (!govtIdBackBase64) missingFields.push('govtIdBackBase64');

        if (missingFields.length > 0) {
            return res.status(400).json({ 
                success: false,
                message: `Missing required fields: ${missingFields.join(', ')}` 
            });
        }

        const VALID_ID_TYPES = ['citizenship', 'passport', 'pan', 'driving_license'];
        if (!VALID_ID_TYPES.includes(govtIdType)) {
            return res.status(400).json({ 
                success: false,
                message: "Invalid government ID type. Allowed: citizenship, passport, pan, driving_license" 
            });
        }

        // ✅ FIXED: Check if mistri profile already exists using mistriId
        const existingProfile = await db.query.mistriProfiles.findFirst({
            where: eq(mistriProfiles.mistriId, userId),
        });

        if (existingProfile) {
            return res.status(400).json({ 
                success: false,
                message: "Mistri profile already exists for this user" 
            });
        }

        // Validate service ID
        const validServiceIds = [1, 2];
        if (!validServiceIds.includes(Number(serviceId))) {
            return res.status(400).json({
                success: false,
                message: "Invalid service ID. Please select a valid service category."
            });
        }

        const SERVICE_MAP: Record<number, string> = {
            1: 'plumber',
            2: 'electrician',
        };
        const serviceName = SERVICE_MAP[Number(serviceId)];
        if (!serviceName) {
            return res.status(400).json({ 
                success: false,
                message: "Invalid service ID. Allowed: 1 (plumber), 2 (electrician)" 
            });
        }
        
        // Insert service if it doesn't exist
        await db.insert(services)
            .values({ id: Number(serviceId), serviceName, isActive: true })
            .onConflictDoNothing();

        // Upload images with fallback
        let profilePhotoUrl: string;
        let govtIdFrontUrl: string;
        let govtIdBackUrl: string;

        try {
            [profilePhotoUrl, govtIdFrontUrl, govtIdBackUrl] = await Promise.all([
                compressAndUploadProfileImage(profilePhotoBase64, userId),
                uploadGovtIdImage(govtIdFrontBase64, 'front', userId),
                uploadGovtIdImage(govtIdBackBase64, 'back', userId),
            ]);
        } catch (uploadError) {
            logger.error('Image upload error:', uploadError);
            profilePhotoUrl = `https://placehold.co/400x400/2196F3/FFFFFF?text=Mistri+${userId}`;
            govtIdFrontUrl = `https://placehold.co/1200x800/FF9800/FFFFFF?text=Govt+ID+Front`;
            govtIdBackUrl = `https://placehold.co/1200x800/FF9800/FFFFFF?text=Govt+ID+Back`;
        }

        // ✅ FIXED: Create mistri profile using mistriId
        const result = await db.transaction(async (tx) => {
            const [newProfile] = await tx.insert(mistriProfiles).values({
                mistriId: userId,  // ✅ Changed from userId to mistriId
                serviceId: Number(serviceId),
                profilePhotoUrl,
                currentLocation,
                bio,
                experienceLevel,
                govtIdType,
                govtIdFrontUrl,
                govtIdBackUrl,
                approvalStatus: "pending",
                isAvailable: true,
                availabilityStatus: "available",
            }).returning();

            // ✅ FIXED: Update mistri account
            const [updatedMistri] = await tx.update(mistriAccounts)
                .set({ 
                    fullName, 
                    isOnboarded: true, 
                    onboardingCompletedAt: new Date(),
                    roleSelectedAt: new Date(),
                })
                .where(eq(mistriAccounts.id, userId))
                .returning();

            return { profile: newProfile, mistri: updatedMistri };
        });

        return res.status(200).json({ 
            success: true, 
            message: "Profile created successfully. Awaiting admin approval.", 
            profile: result.profile,
            mistri: result.mistri
        });
    } catch (error) {
        logger.error('Mistri profile error:', error);
        return res.status(500).json({ 
            success: false,
            message: "Failed to create mistri profile. Please try again." 
        });
    }
};

// ============================================
// GET NEARBY MISTRIS
// ============================================

export const getNearbyMistris = async (req: Request, res: Response) => {
    try {
        // ✅ FIXED: Use userId from decoded token
        const userId = (req as any).user?.userId;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }

        const { lat, lng, maxDistanceKm = 20 } = req.body;

        if (!lat || !lng) {
            return res.status(400).json({
                success: false,
                message: "Customer location (lat, lng) is required",
            });
        }

        // ✅ FIXED: Use mistriAccounts instead of users
        const availableMistris = await db
            .select({
                id: mistriAccounts.id,
                fullName: mistriAccounts.fullName,
                currentLocation: mistriProfiles.currentLocation,
                serviceId: mistriProfiles.serviceId,
                profilePhotoUrl: mistriProfiles.profilePhotoUrl,
                bio: mistriProfiles.bio,
                averageRating: mistriProfiles.averageRating,
                jobsCompleted: mistriProfiles.jobsCompleted,
                serviceName: services.serviceName,
                serviceMapIconColor: services.mapIconColor,
            })
            .from(mistriProfiles)
            .innerJoin(mistriAccounts, eq(mistriProfiles.mistriId, mistriAccounts.id))  // ✅ Changed from userId to mistriId
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
            .where(eq(mistriProfiles.isAvailable, true));

        const nearbyMistris = availableMistris
            .map(mistri => {
                try {
                    let mistriLat: number, mistriLng: number;

                    if (typeof mistri.currentLocation === 'string') {
                        const coords = mistri.currentLocation.split(',');
                        mistriLat = parseFloat(coords[0]);
                        mistriLng = parseFloat(coords[1]);
                    } else if (mistri.currentLocation !== null) {
                        const location = JSON.parse(mistri.currentLocation as unknown as string);
                        mistriLat = location.lat;
                        mistriLng = location.lng;
                    } else {
                        logger.warn('Mistri location is null for mistri:', mistri.id);
                        return null;
                    }

                    const distance = calculateDistance(lat, lng, mistriLat, mistriLng);

                    return {
                        ...mistri,
                        distance: Math.round(distance * 10) / 10,
                        location: {
                            lat: mistriLat,
                            lng: mistriLng,
                        },
                        averageRating: mistri.averageRating || 0,
                    };
                } catch (error) {
                    logger.error('Error parsing mistri location:', mistri.currentLocation, error);
                    return null;
                }
            })
            .filter((mistri): mistri is NonNullable<typeof mistri> => mistri !== null && mistri.distance <= maxDistanceKm)
            .sort((a, b) => a.distance - b.distance);

        return res.status(200).json({
            success: true,
            mistris: nearbyMistris,
            count: nearbyMistris.length,
            searchRadius: maxDistanceKm,
            message: `Found ${nearbyMistris.length} mistris within ${maxDistanceKm}km`,
        });
    } catch (error) {
        logger.error("Error fetching nearby mistris:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch nearby mistris",
        });
    }
};

// ============================================
// GET TARGETED REQUESTS
// ============================================

export const getTargetedRequests = async (req: Request, res: Response) => {
    try {
        // ✅ FIXED: Use userId from decoded token
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }

        if (accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Only mistri users can view targeted requests",
            });
        }

        // ✅ FIXED: Use userAccounts for customer names
        const targetedRequests = await db
            .select({
                id: serviceRequests.id,
                type: serviceRequests.type,
                lat: serviceRequests.lat,
                lng: serviceRequests.lng,
                address: serviceRequests.address,
                status: serviceRequests.status,
                createdAt: serviceRequests.createdAt,
                customerName: userAccounts.fullName,
                customerId: userAccounts.id,
            })
            .from(serviceRequests)
            .innerJoin(userAccounts, eq(serviceRequests.customerId, userAccounts.id))
            .where(
                and(
                    eq(serviceRequests.assignedMistriId, userId),
                    eq(serviceRequests.status, 'pending')
                )
            );

        return res.status(200).json({
            success: true,
            requests: targetedRequests,
            count: targetedRequests.length,
        });
    } catch (error) {
        logger.error("Error fetching targeted requests:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch targeted requests",
        });
    }
};

// ============================================
// GET MISTRI PROFILE
// ============================================

export const getMistriProfile = async (req: Request, res: Response) => {
    try {
        // ✅ FIXED: Use userId from decoded token
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }

        if (accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Only mistri users can view their profile",
            });
        }

        // ✅ FIXED: Use mistriAccounts and mistriId
        const profile = await db
            .select({
                mistriId: mistriProfiles.mistriId,
                fullName: mistriAccounts.fullName,
                phoneNumber: mistriAccounts.phoneNumber,
                serviceId: mistriProfiles.serviceId,
                serviceName: services.serviceName,
                mapIconColor: services.mapIconColor,
                profilePhotoUrl: mistriProfiles.profilePhotoUrl,
                bio: mistriProfiles.bio,
                currentLocation: mistriProfiles.currentLocation,
                isAvailable: mistriProfiles.isAvailable,
                availabilityStatus: mistriProfiles.availabilityStatus,
                averageRating: mistriProfiles.averageRating,
                jobsCompleted: mistriProfiles.jobsCompleted,
                approvalStatus: mistriProfiles.approvalStatus,
            })
            .from(mistriProfiles)
            .innerJoin(mistriAccounts, eq(mistriProfiles.mistriId, mistriAccounts.id))
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
            .where(eq(mistriProfiles.mistriId, userId))
            .limit(1);

        if (profile.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Mistri profile not found. Please complete your registration.",
            });
        }

        return res.status(200).json({
            success: true,
            profile: profile[0],
        });
    } catch (error) {
        logger.error("Error fetching mistri profile:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch mistri profile",
        });
    }
};

// ============================================
// GET ACCEPTED JOBS
// ============================================

export const getAcceptedJobs = async (req: Request, res: Response) => {
    try {
        // ✅ FIXED: Use userId from decoded token
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }

        if (accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Only mistri users can view accepted jobs",
            });
        }

        // ✅ FIXED: Use userAccounts for customer names
        const acceptedJobs = await db
            .select({
                id: serviceRequests.id,
                type: serviceRequests.type,
                lat: serviceRequests.lat,
                lng: serviceRequests.lng,
                address: serviceRequests.address,
                status: serviceRequests.status,
                createdAt: serviceRequests.createdAt,
                assignedAt: serviceRequests.assignedAt,
                completedAt: serviceRequests.completedAt,
                unpaid: serviceRequests.unpaid,
                customerName: userAccounts.fullName,
                customerId: userAccounts.id,
            })
            .from(serviceRequests)
            .innerJoin(userAccounts, eq(serviceRequests.customerId, userAccounts.id))
            .where(
                and(
                    eq(serviceRequests.assignedMistriId, userId),
                    inArray(serviceRequests.status, ['assigned', 'completed'])
                )
            )
            .orderBy(desc(serviceRequests.createdAt));

        return res.status(200).json({
            success: true,
            jobs: acceptedJobs,
            count: acceptedJobs.length,
        });
    } catch (error) {
        logger.error("Error fetching accepted jobs:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch accepted jobs",
        });
    }
};

// ============================================
// UPDATE MISTRI PROFILE
// ============================================

export const updateMistriProfile = async (req: Request, res: Response) => {
    try {
        // ✅ FIXED: Use userId from decoded token
        const userId = (req as any).user?.userId;
        const accountType = (req as any).user?.accountType;

        if (!userId) {
            return res.status(401).json({ 
                success: false,
                message: "Unauthorized" 
            });
        }

        if (accountType !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Only mistri users can update their profile",
            });
        }

        const { serviceId, profilePhotoBase64, currentLocation, fullName, bio, isAvailable, availabilityStatus } = req.body;

        const mistriProfileUpdates: any = {};
        const mistriAccountUpdates: any = {};

        if (serviceId !== undefined) {
            const validServiceIds = [1, 2];
            if (!validServiceIds.includes(Number(serviceId))) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid service ID. Please select a valid service category."
                });
            }
            
            const SERVICE_MAP: Record<number, string> = {
                1: 'plumber',
                2: 'electrician',
            };
            const serviceName = SERVICE_MAP[Number(serviceId)];
            if (!serviceName) {
                return res.status(400).json({ 
                    success: false,
                    message: "Invalid service ID" 
                });
            }
            await db.insert(services)
                .values({ id: Number(serviceId), serviceName, isActive: true })
                .onConflictDoNothing();
            mistriProfileUpdates.serviceId = Number(serviceId);
        }

        if (profilePhotoBase64) {
            mistriProfileUpdates.profilePhotoUrl = await compressAndUploadProfileImage(profilePhotoBase64, userId);
        }

        if (currentLocation !== undefined) {
            mistriProfileUpdates.currentLocation = currentLocation;
        }

        if (bio !== undefined) {
            mistriProfileUpdates.bio = bio;
        }

        if (isAvailable !== undefined) {
            mistriProfileUpdates.isAvailable = isAvailable;
        }

        if (availabilityStatus !== undefined) {
            mistriProfileUpdates.availabilityStatus = availabilityStatus;
            mistriProfileUpdates.isAvailable = availabilityStatus !== 'unavailable';
        }

        if (fullName !== undefined) {
            mistriAccountUpdates.fullName = fullName;
        }

        // ✅ FIXED: Use mistriId in the where clause
        if (Object.keys(mistriProfileUpdates).length > 0) {
            await db.update(mistriProfiles)
                .set(mistriProfileUpdates)
                .where(eq(mistriProfiles.mistriId, userId));
        }

        if (Object.keys(mistriAccountUpdates).length > 0) {
            await db.update(mistriAccounts)
                .set(mistriAccountUpdates)
                .where(eq(mistriAccounts.id, userId));
        }

        // ✅ FIXED: Use mistriAccounts for the updated profile
        const updatedProfile = await db
            .select({
                mistriId: mistriProfiles.mistriId,
                fullName: mistriAccounts.fullName,
                phoneNumber: mistriAccounts.phoneNumber,
                serviceId: mistriProfiles.serviceId,
                serviceName: services.serviceName,
                mapIconColor: services.mapIconColor,
                profilePhotoUrl: mistriProfiles.profilePhotoUrl,
                bio: mistriProfiles.bio,
                currentLocation: mistriProfiles.currentLocation,
                isAvailable: mistriProfiles.isAvailable,
                availabilityStatus: mistriProfiles.availabilityStatus,
                averageRating: mistriProfiles.averageRating,
                jobsCompleted: mistriProfiles.jobsCompleted,
            })
            .from(mistriProfiles)
            .innerJoin(mistriAccounts, eq(mistriProfiles.mistriId, mistriAccounts.id))
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
            .where(eq(mistriProfiles.mistriId, userId))
            .limit(1);

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            profile: updatedProfile[0],
        });
    } catch (error) {
        logger.error('Mistri profile update error:', error);
        return res.status(500).json({ 
            success: false,
            message: "Failed to update mistri profile. Please try again." 
        });
    }
};