import { Request, Response } from "express";
import { db } from "../db";
import { users, mistriProfiles, services, serviceRequests } from "../db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

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

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

async function compressAndUploadProfileImage(
    profilePhotoBase64: string,
    userId: string | number
): Promise<string> {
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
}

async function uploadGovtIdImage(
    base64: string,
    label: 'front' | 'back',
    userId: string | number
): Promise<string> {
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
}

export const createMistriProfile = async (req: Request, res: Response) => {
    try {
        // FIXED: Use req.user.id instead of req.user.userId
        const userId = req.user?.id;
        
        console.log('Create Mistri Profile - User ID:', userId);
        console.log('Create Mistri Profile - Request body keys:', Object.keys(req.body));
        
        if (!userId) {
            return res.status(401).json({ 
                success: false,
                message: "Unauthorized. Please login again." 
            });
        }

        // Check if user exists
        const user = await db.query.users.findFirst({
            where: eq(users.id, userId),
        });

        if (!user) {
            return res.status(404).json({ 
                success: false,
                message: "User not found" 
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

        // Check if mistri profile already exists
        const existingProfile = await db.query.mistriProfiles.findFirst({
            where: eq(mistriProfiles.userId, userId),
        });

        if (existingProfile) {
            return res.status(400).json({ 
                success: false,
                message: "Mistri profile already exists for this user" 
            });
        }

        const SERVICE_MAP: Record<number, string> = {
            1: 'plumber',
            2: 'electrician',
        };
        const serviceName = SERVICE_MAP[serviceId];
        if (!serviceName) {
            return res.status(400).json({ 
                success: false,
                message: "Invalid service ID. Allowed: 1 (plumber), 2 (electrician)" 
            });
        }
        
        await db.insert(services)
            .values({ id: serviceId, serviceName })
            .onConflictDoNothing();

        // Upload images
        let profilePhotoUrl = null;
        let govtIdFrontUrl = null;
        let govtIdBackUrl = null;

        try {
            [profilePhotoUrl, govtIdFrontUrl, govtIdBackUrl] = await Promise.all([
                compressAndUploadProfileImage(profilePhotoBase64, userId),
                uploadGovtIdImage(govtIdFrontBase64, 'front', userId),
                uploadGovtIdImage(govtIdBackBase64, 'back', userId),
            ]);
        } catch (uploadError) {
            console.error('Image upload error:', uploadError);
            return res.status(500).json({ 
                success: false,
                message: "Failed to upload images. Please try again." 
            });
        }

        // Create mistri profile
        const [newProfile] = await db.insert(mistriProfiles).values({
            userId,
            serviceId,
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

        // Update user
        const [updatedUser] = await db.update(users)
            .set({ 
                fullName, 
                role: "mistri",
                isOnboarded: true, 
                onboardingCompletedAt: new Date(),
                roleSelectedAt: new Date(),
            })
            .where(eq(users.id, userId))
            .returning();

        return res.status(200).json({ 
            success: true, 
            message: "Profile created successfully. Awaiting admin approval.", 
            profile: newProfile,
            user: updatedUser
        });
    } catch (error) {
        console.error('Mistri profile error', error);
        return res.status(500).json({ 
            success: false,
            message: "Failed to create mistri profile: " + (error as Error).message 
        });
    }
};

export const getNearbyMistris = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;

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
                serviceMapIconColor: services.mapIconColor,
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
                    } else if (mistri.currentLocation !== null) {
                        const location = JSON.parse(mistri.currentLocation as unknown as string);
                        mistriLat = location.lat;
                        mistriLng = location.lng;
                    } else {
                        console.error('Mistri location is null for mistri:', mistri.id);
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

export const getTargetedRequests = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const role = req.user?.role;

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
            })
            .from(serviceRequests)
            .innerJoin(users, eq(serviceRequests.customerId, users.id))
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
        console.error("Error fetching targeted requests:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch targeted requests",
        });
    }
};

export const getMistriProfile = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const role = req.user?.role;

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
            .innerJoin(users, eq(mistriProfiles.userId, users.id))
            .innerJoin(services, eq(mistriProfiles.serviceId, services.id))
            .where(eq(mistriProfiles.userId, userId))
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
        console.error("Error fetching mistri profile:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch mistri profile",
        });
    }
};

export const getAcceptedJobs = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const role = req.user?.role;

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

export const updateMistriProfile = async (req: Request, res: Response) => {
    try {
        const userId = req.user?.id;
        const role = req.user?.role;

        if (!userId) {
            return res.status(401).json({ 
                success: false,
                message: "Unauthorized" 
            });
        }

        if (role !== 'mistri') {
            return res.status(403).json({
                success: false,
                message: "Only mistri users can update their profile",
            });
        }

        const { serviceId, profilePhotoBase64, currentLocation, fullName, bio, isAvailable, availabilityStatus } = req.body;

        const mistriProfileUpdates: any = {};
        const userUpdates: any = {};

        if (serviceId !== undefined) {
            const SERVICE_MAP: Record<number, string> = {
                1: 'plumber',
                2: 'electrician',
            };
            const serviceName = SERVICE_MAP[serviceId];
            if (!serviceName) {
                return res.status(400).json({ 
                    success: false,
                    message: "Invalid service ID" 
                });
            }
            await db.insert(services)
                .values({ id: serviceId, serviceName })
                .onConflictDoNothing();
            mistriProfileUpdates.serviceId = serviceId;
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
            success: false,
            message: "Failed to update mistri profile" 
        });
    }
};