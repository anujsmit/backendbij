import { Request, Response } from "express";
import { db } from "../db";
import { users, mistriProfiles, services, serviceRequests } from "../db/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

// Helper function to compress and upload profile image
async function compressAndUploadProfileImage(
    profilePhotoBase64: string,
    userId: string | number
): Promise<string> {
    try {
        // Remove data URL prefix if present
        let base64Data = profilePhotoBase64;
        if (profilePhotoBase64.includes(',')) {
            base64Data = profilePhotoBase64.split(',')[1];
        }
        
        const rawBuffer = Buffer.from(base64Data, 'base64');
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
        console.error('Error uploading profile image:', error);
        throw new Error('Failed to upload profile image');
    }
}

// Helper function to upload government ID images
async function uploadGovtIdImage(
    base64: string,
    label: 'front' | 'back',
    userId: string | number
): Promise<string> {
    try {
        // Remove data URL prefix if present
        let base64Data = base64;
        if (base64.includes(',')) {
            base64Data = base64.split(',')[1];
        }
        
        const rawBuffer = Buffer.from(base64Data, 'base64');
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
        console.error('Error uploading ID image:', error);
        throw new Error('Failed to upload ID image');
    }
}

// Create mistri profile (onboarding)
// Create mistri profile (onboarding)
export const createMistriProfile = async (req: Request, res: Response) => {
    try {
        console.log('=== Create Mistri Profile Started ===');
        console.log('Request body keys:', Object.keys(req.body));
        
        const userId = (req as any).user?.userId || (req as any).user?.id;
        console.log('User ID from token:', userId, 'Type:', typeof userId);
        
        if (!userId) {
            console.error('No userId found in token');
            return res.status(401).json({ message: "Unauthorized - No user ID" });
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
            console.error('Missing fields:', missingFields);
            return res.status(400).json({ 
                message: "All fields are required", 
                missingFields 
            });
        }

        // Validate ID type
        const VALID_ID_TYPES = ['citizenship', 'passport', 'pan', 'driving_license'];
        if (!VALID_ID_TYPES.includes(govtIdType)) {
            return res.status(400).json({ message: "Invalid government ID type" });
        }

        // Validate experience level
        const VALID_EXPERIENCE_LEVELS = ['less_than_1', '1_to_3', '3_plus'];
        if (!VALID_EXPERIENCE_LEVELS.includes(experienceLevel)) {
            return res.status(400).json({ message: "Invalid experience level" });
        }

        // Service mapping
        const SERVICE_MAP: Record<number, string> = {
            1: 'plumber',
            2: 'electrician',
            3: 'carpenter',
            4: 'painter',
            5: 'mechanic',
            6: 'gardener',
            7: 'cleaner',
            8: 'driver',
            9: 'cook',
            10: 'tutor',
        };
        
        const serviceName = SERVICE_MAP[Number(serviceId)];
        if (!serviceName) {
            return res.status(400).json({ message: "Invalid service ID" });
        }
        
        // Insert or ignore service
        try {
            await db.insert(services)
                .values({ id: Number(serviceId), serviceName: serviceName })
                .onConflictDoNothing();
            console.log('Service inserted/verified:', serviceId, serviceName);
        } catch (error) {
            console.error('Error inserting service:', error);
        }

        // Upload images
        console.log('Uploading profile image...');
        const profilePhotoUrl = await compressAndUploadProfileImage(profilePhotoBase64, userId);
        console.log('Profile image uploaded:', profilePhotoUrl);
        
        console.log('Uploading ID front...');
        const govtIdFrontUrl = await uploadGovtIdImage(govtIdFrontBase64, 'front', userId);
        console.log('ID front uploaded:', govtIdFrontUrl);
        
        console.log('Uploading ID back...');
        const govtIdBackUrl = await uploadGovtIdImage(govtIdBackBase64, 'back', userId);
        console.log('ID back uploaded:', govtIdBackUrl);

        // Check if profile already exists
        const existingProfile = await db
            .select()
            .from(mistriProfiles)
            .where(eq(mistriProfiles.userId, userId as string))
            .limit(1);

        let insertedProfile;
        if (existingProfile.length > 0) {
            // Update existing profile
            console.log('Updating existing profile...');
            const updatedProfiles = await db.update(mistriProfiles)
                .set({
                    serviceId: Number(serviceId),
                    profilePhotoUrl: profilePhotoUrl,
                    currentLocation: currentLocation,
                    bio: bio,
                    experienceLevel: experienceLevel,
                    govtIdType: govtIdType,
                    govtIdFrontUrl: govtIdFrontUrl,
                    govtIdBackUrl: govtIdBackUrl,
                })
                .where(eq(mistriProfiles.userId, userId as string))
                .returning();
            insertedProfile = updatedProfiles[0];
        } else {
            // Insert new profile - ensure userId is string
            console.log('Inserting new mistri profile...');
            const insertedProfiles = await db.insert(mistriProfiles).values({
                userId: userId as string, // Cast to string for UUID
                serviceId: Number(serviceId),
                profilePhotoUrl: profilePhotoUrl,
                currentLocation: currentLocation,
                bio: bio,
                experienceLevel: experienceLevel,
                govtIdType: govtIdType,
                govtIdFrontUrl: govtIdFrontUrl,
                govtIdBackUrl: govtIdBackUrl,
                isAvailable: true,
                averageRating: "0", // Cast to string if your schema expects string
                jobsCompleted: 0,
            } as any).returning(); // Use 'as any' to bypass type checking temporarily
            insertedProfile = insertedProfiles[0];
        }
        
        console.log('Mistri profile saved:', insertedProfile);

        // Update user
        console.log('Updating user...');
        const updatedUsers = await db.update(users)
            .set({ 
                fullName: fullName, 
                isOnboarded: true, 
                role: 'mistri'
            })
            .where(eq(users.id, userId as string))
            .returning();
        
        const updatedUser = updatedUsers[0];
        console.log('User updated:', updatedUser);

        return res.status(200).json({ 
            message: "Profile created successfully", 
            user: updatedUser,
            profile: insertedProfile
        });
    } catch (error) {
        console.error('Mistri profile error details:', error);
        return res.status(500).json({ 
            message: "Failed to create mistri profile",
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

// Get nearby mistris for customers
export const getNearbyMistris = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId || (req as any).user?.id;

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

        const availableMistris = await db
            .select({
                id: users.id,
                fullName: users.fullName,
                currentLocation: mistriProfiles.currentLocation,
                serviceId: mistriProfiles.serviceId,
                profilePhotoUrl: mistriProfiles.profilePhotoUrl,
                bio: mistriProfiles.bio,
                averageRating: mistriProfiles.averageRating,
                jobsCompleted: mistriProfiles.jobsCompleted,
                serviceName: services.serviceName,
            })
            .from(mistriProfiles)
            .innerJoin(users, eq(mistriProfiles.userId, users.id))
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
                    } else if (mistri.currentLocation !== null && typeof mistri.currentLocation === 'object') {
                        const location = mistri.currentLocation as any;
                        mistriLat = location.lat || location.latitude;
                        mistriLng = location.lng || location.longitude;
                    } else {
                        console.error('Mistri location is invalid for mistri:', mistri.id);
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
                    console.error('Error parsing mistri location:', mistri.currentLocation, error);
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
        console.error("Error fetching nearby mistris:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch nearby mistris",
        });
    }
};

// Get targeted requests for a mistri
export const getTargetedRequests = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId || (req as any).user?.id;
        const role = (req as any).user?.role;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }

        if (role !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Only mistri users can view targeted requests",
            });
        }

        const targetedRequests = await db
            .select({
                id: serviceRequests.id,
                type: serviceRequests.type,
                lat: serviceRequests.lat,
                lng: serviceRequests.lng,
                address: serviceRequests.address,
                status: serviceRequests.status,
                createdAt: serviceRequests.createdAt,
                customerName: users.fullName,
                customerId: users.id,
                customerPhone: users.phoneNumber,
            })
            .from(serviceRequests)
            .innerJoin(users, eq(serviceRequests.customerId, users.id))
            .where(
                and(
                    eq(serviceRequests.assignedMistriId, userId),
                    eq(serviceRequests.status, 'pending')
                )
            )
            .orderBy(desc(serviceRequests.createdAt));

        return res.status(200).json({
            success: true,
            requests: targetedRequests,
            count: targetedRequests.length,
        });
    } catch (error) {
        console.error("Error fetching targeted requests:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch targeted requests",
        });
    }
};

// Get mistri's own profile
export const getMistriProfile = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId || (req as any).user?.id;
        const role = (req as any).user?.role;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }

        if (role !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Only mistri users can view their profile",
            });
        }

        const profile = await db
            .select({
                userId: mistriProfiles.userId,
                fullName: users.fullName,
                phoneNumber: users.phoneNumber,
                serviceId: mistriProfiles.serviceId,
                serviceName: services.serviceName,
                profilePhotoUrl: mistriProfiles.profilePhotoUrl,
                bio: mistriProfiles.bio,
                currentLocation: mistriProfiles.currentLocation,
                isAvailable: mistriProfiles.isAvailable,
                averageRating: mistriProfiles.averageRating,
                jobsCompleted: mistriProfiles.jobsCompleted,
                experienceLevel: mistriProfiles.experienceLevel,
                govtIdType: mistriProfiles.govtIdType,
                govtIdFrontUrl: mistriProfiles.govtIdFrontUrl,
                govtIdBackUrl: mistriProfiles.govtIdBackUrl,
            })
            .from(mistriProfiles)
            .innerJoin(users, eq(mistriProfiles.userId, users.id))
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
            .where(eq(mistriProfiles.userId, userId))
            .limit(1);

        if (profile.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Mistri profile not found",
            });
        }

        return res.status(200).json({
            success: true,
            profile: profile[0],
        });
    } catch (error) {
        console.error("Error fetching mistri profile:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch mistri profile",
        });
    }
};

// Get accepted jobs for a mistri
export const getAcceptedJobs = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId || (req as any).user?.id;
        const role = (req as any).user?.role;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }

        if (role !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Only mistri users can view accepted jobs",
            });
        }

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
                customerName: users.fullName,
                customerId: users.id,
                customerPhone: users.phoneNumber,
            })
            .from(serviceRequests)
            .innerJoin(users, eq(serviceRequests.customerId, users.id))
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
        console.error("Error fetching accepted jobs:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch accepted jobs",
        });
    }
};

// Update mistri profile
export const updateMistriProfile = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId || (req as any).user?.id;
        const role = (req as any).user?.role;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (role !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Only mistri users can update their profile",
            });
        }

        const { 
            serviceId, 
            profilePhotoBase64, 
            currentLocation, 
            fullName, 
            bio, 
            isAvailable
        } = req.body;

        const mistriProfileUpdates: any = {};
        const userUpdates: any = {};

        if (serviceId !== undefined) {
            const SERVICE_MAP: Record<number, string> = {
                1: 'plumber',
                2: 'electrician',
                3: 'carpenter',
                4: 'painter',
                5: 'mechanic',
                6: 'gardener',
                7: 'cleaner',
                8: 'driver',
                9: 'cook',
                10: 'tutor',
            };
            const serviceName = SERVICE_MAP[Number(serviceId)];
            if (!serviceName) {
                return res.status(400).json({ message: "Invalid service ID" });
            }
            await db.insert(services)
                .values({ id: Number(serviceId), serviceName: serviceName })
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

        if (fullName !== undefined) {
            userUpdates.fullName = fullName;
        }

        if (Object.keys(mistriProfileUpdates).length > 0) {
            await db.update(mistriProfiles)
                .set(mistriProfileUpdates)
                .where(eq(mistriProfiles.userId, userId));
        }

        if (Object.keys(userUpdates).length > 0) {
            await db.update(users)
                .set(userUpdates)
                .where(eq(users.id, userId));
        }

        const updatedProfile = await db
            .select({
                userId: mistriProfiles.userId,
                fullName: users.fullName,
                phoneNumber: users.phoneNumber,
                serviceId: mistriProfiles.serviceId,
                serviceName: services.serviceName,
                profilePhotoUrl: mistriProfiles.profilePhotoUrl,
                bio: mistriProfiles.bio,
                currentLocation: mistriProfiles.currentLocation,
                isAvailable: mistriProfiles.isAvailable,
                averageRating: mistriProfiles.averageRating,
                jobsCompleted: mistriProfiles.jobsCompleted,
            })
            .from(mistriProfiles)
            .innerJoin(users, eq(mistriProfiles.userId, users.id))
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
            .where(eq(mistriProfiles.userId, userId))
            .limit(1);

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            profile: updatedProfile[0],
        });
    } catch (error) {
        console.error('Mistri profile update error', error);
        return res.status(500).json({ 
            message: "Failed to update mistri profile",
            error: error instanceof Error ? error.message : String(error)
        });
    }
};

// Update mistri availability status
export const updateAvailability = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId || (req as any).user?.id;
        const { isAvailable } = req.body;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        if (isAvailable !== undefined) {
            await db.update(mistriProfiles)
                .set({ isAvailable: isAvailable })
                .where(eq(mistriProfiles.userId, userId));
        }

        return res.status(200).json({
            success: true,
            message: "Availability updated successfully",
        });
    } catch (error) {
        console.error('Error updating availability:', error);
        return res.status(500).json({
            success: false,
            message: "Failed to update availability",
        });
    }
};

// Get mistri statistics
export const getMistriStats = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId || (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const profile = await db
            .select({
                jobsCompleted: mistriProfiles.jobsCompleted,
                averageRating: mistriProfiles.averageRating,
            })
            .from(mistriProfiles)
            .where(eq(mistriProfiles.userId, userId))
            .limit(1);

        if (profile.length === 0) {
            return res.status(404).json({ message: "Profile not found" });
        }

        // Get completed jobs count
        const completedJobs = await db
            .select({ count: sql<number>`count(*)` })
            .from(serviceRequests)
            .where(
                and(
                    eq(serviceRequests.assignedMistriId, userId),
                    eq(serviceRequests.status, 'completed')
                )
            );

        // Get total earnings
        const earnings = await db
            .select({ total: sql<number>`sum(unpaid)` })
            .from(serviceRequests)
            .where(
                and(
                    eq(serviceRequests.assignedMistriId, userId),
                    eq(serviceRequests.status, 'completed')
                )
            );

        return res.status(200).json({
            success: true,
            stats: {
                jobsCompleted: profile[0].jobsCompleted,
                averageRating: profile[0].averageRating,
                totalEarnings: earnings[0]?.total || 0,
            },
        });
    } catch (error) {
        console.error('Error fetching mistri stats:', error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch statistics",
        });
    }
};