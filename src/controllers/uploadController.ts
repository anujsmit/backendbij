import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { z } from "zod";

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
);

// Update the enum to include 'platform-services'
const uploadSchema = z.object({
    fileBase64: z.string().min(1),
    folder: z.enum([
        "banners", 
        "service-categories", 
        "service-icons", 
        "platform-services",  // Add this line
        "mistri-profiles", 
        "misc"
    ]).optional().default("misc"),
    fileName: z.string().optional(),
});

export const uploadAsset = async (req: Request, res: Response): Promise<Response> => {
    try {
        console.log('Upload request received');
        
        const parsed = uploadSchema.safeParse(req.body);
        if (!parsed.success) {
            console.error('Validation error:', parsed.error.format());
            return res.status(400).json({ 
                success: false, 
                message: "Invalid data", 
                errors: parsed.error.format() 
            });
        }

        const { fileBase64, folder, fileName } = parsed.data;
        console.log(`Processing upload: folder=${folder}, fileName=${fileName}`);
        
        const rawBuffer = Buffer.from(fileBase64, "base64");
        console.log(`Buffer size: ${rawBuffer.length} bytes`);

        if (rawBuffer.length === 0 || rawBuffer.length > 5 * 1024 * 1024) {
            return res.status(413).json({ 
                success: false, 
                message: "File too large. Max size is 5MB." 
            });
        }

        // Compress image - use appropriate format based on file type
        let compressed: Buffer;
        let contentType: string;
        
        // Check if it's likely an SVG (starts with <svg or xml)
        const base64String = fileBase64.substring(0, 100);
        const isSvg = base64String.includes('PHN2Zw') || base64String.includes('xml');
        
        if (isSvg) {
            // For SVG, don't compress with sharp, just decode
            compressed = rawBuffer;
            contentType = "image/svg+xml";
        } else {
            // For raster images, compress with sharp
            compressed = await sharp(rawBuffer)
                .resize({ width: 200, height: 200, fit: "inside", withoutEnlargement: true })
                .png({ quality: 80, compressionLevel: 8 })
                .toBuffer();
            contentType = "image/png";
        }
        
        console.log(`Compressed size: ${compressed.length} bytes, type: ${contentType}`);

        const baseName = fileName
            ? fileName.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_")
            : `icon_${Date.now()}`;

        const extension = isSvg ? 'svg' : 'png';
        const storagePath = `${folder}/${baseName}_${Date.now()}.${extension}`;
        console.log(`Storage path: ${storagePath}`);

        // Ensure bucket exists
        const { data: buckets } = await supabase.storage.listBuckets();
        const bucketExists = buckets?.some((b) => b.name === "assets");
        
        if (!bucketExists) {
            console.log('Creating assets bucket...');
            await supabase.storage.createBucket("assets", { public: true });
        }

        const { error } = await supabase.storage
            .from("assets")
            .upload(storagePath, compressed, { 
                upsert: true, 
                contentType: contentType,
                cacheControl: "3600"
            });

        if (error) {
            console.error('Supabase upload error:', error);
            throw error;
        }

        const { data } = supabase.storage.from("assets").getPublicUrl(storagePath);
        console.log(`Upload successful: ${data.publicUrl}`);

        return res.status(201).json({ 
            success: true, 
            cdnUrl: data.publicUrl 
        });
    } catch (error) {
        console.error("Error uploading asset:", error);
        return res.status(500).json({ 
            success: false, 
            message: error instanceof Error ? error.message : "Failed to upload asset" 
        });
    }
};