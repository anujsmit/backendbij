import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { z } from "zod";

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

const BUCKET = "assets";

const uploadSchema = z.object({
    fileBase64: z.string().min(1),

    folder: z
        .enum([
            "banners",
            "service-categories",
            "mistri-profiles",
            "misc",
        ])
        .optional()
        .default("misc"),

    fileName: z.string().optional(),
});

const MAX_UPLOAD_BYTES =
    5 * 1024 * 1024;

const MAX_IMAGE_DIMENSION = 2000;

/**
 * CHECK JPEG / PNG MAGIC BYTES
 */

function isAllowedImageBuffer(
    buffer: Buffer
): boolean {
    const isJpeg =
        buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff;

    const isPng =
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a;

    return isJpeg || isPng;
}

/**
 * ENSURE BUCKET EXISTS
 */

async function ensureBucket(): Promise<void> {
    const { data: buckets, error } =
        await supabase.storage.listBuckets();

    if (error) {
        throw error;
    }

    const exists = buckets?.some(
        (b) => b.name === BUCKET
    );

    if (!exists) {
        const { error: createError } =
            await supabase.storage.createBucket(
                BUCKET,
                {
                    public: true,
                }
            );

        if (
            createError &&
            !createError.message.includes(
                "already exists"
            )
        ) {
            throw createError;
        }
    }
}

/**
 * REMOVE DATA URL PREFIX
 */

function cleanBase64(
    value: string
): string {
    if (value.includes(",")) {
        return value.split(",")[1];
    }

    return value;
}

/**
 * UPLOAD CONTROLLER
 */

export const uploadAsset = async (
    req: Request,
    res: Response
): Promise<Response> => {
    try {
        const parsed =
            uploadSchema.safeParse(req.body);

        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid data",
                errors:
                    parsed.error.format(),
            });
        }

        const {
            fileBase64,
            folder,
            fileName,
        } = parsed.data;

        /**
         * CLEAN BASE64
         */

        const cleaned =
            cleanBase64(fileBase64);

        const rawBuffer = Buffer.from(
            cleaned,
            "base64"
        );

        /**
         * SIZE VALIDATION
         */

        if (
            rawBuffer.length === 0 ||
            rawBuffer.length >
                MAX_UPLOAD_BYTES
        ) {
            return res.status(413).json({
                success: false,
                message:
                    "File too large. Max size is 5MB.",
            });
        }

        /**
         * FILE TYPE VALIDATION
         */

        if (
            !isAllowedImageBuffer(
                rawBuffer
            )
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Only JPEG and PNG images are allowed.",
            });
        }

        /**
         * SHARP VALIDATION
         */

        const metadata = await sharp(
            rawBuffer
        ).metadata();

        if (
            !metadata.width ||
            !metadata.height
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid image.",
            });
        }

        if (
            metadata.width >
                MAX_IMAGE_DIMENSION ||
            metadata.height >
                MAX_IMAGE_DIMENSION
        ) {
            return res.status(400).json({
                success: false,
                message: `Image dimensions must be at most ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION}.`,
            });
        }

        /**
         * COMPRESS IMAGE
         */

        const compressed =
            await sharp(rawBuffer)
                .rotate()
                .resize({
                    width: 1200,
                    fit: "inside",
                    withoutEnlargement: true,
                })
                .jpeg({
                    quality: 80,
                    progressive: true,
                })
                .toBuffer();

        /**
         * SANITIZE FILE NAME
         */

        const safeName = (
            fileName || "asset"
        )
            .replace(/\.[^/.]+$/, "")
            .replace(
                /[^a-zA-Z0-9_-]/g,
                "_"
            );

        const storagePath = `${folder}/${safeName}_${Date.now()}.jpg`;

        /**
         * ENSURE BUCKET
         */

        await ensureBucket();

        /**
         * UPLOAD
         */

        const { error } =
            await supabase.storage
                .from(BUCKET)
                .upload(
                    storagePath,
                    compressed,
                    {
                        upsert: true,
                        contentType:
                            "image/jpeg",
                    }
                );

        if (error) {
            throw error;
        }

        /**
         * PUBLIC URL
         */

        const { data } =
            supabase.storage
                .from(BUCKET)
                .getPublicUrl(
                    storagePath
                );

        return res.status(201).json({
            success: true,
            cdnUrl:
                data.publicUrl,
        });
    } catch (error) {
        console.error(
            "Error uploading asset:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Failed to upload asset",
        });
    }
};