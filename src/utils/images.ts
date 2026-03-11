import sharp from "sharp";
import { logger } from "@stimsdesign/core/logger";

/**
 * Processes an image from a URL, resizes it to 300x300 (without enlargement),
 * and returns a base64 Data URI.
 * 
 * @param url - The URL of the image to fetch and process.
 * @returns A base64 Data URI string, or null if the fetch or processing fails.
 */
export async function processImageFromUrl(url: string): Promise<string | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            logger.error(`[processImageFromUrl] Failed to fetch image from ${url}: ${response.statusText}`);
            return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        return await processImageFromBuffer(buffer);
    } catch (error) {
        logger.error(`[processImageFromUrl] Error processing image from ${url}:`, error);
        return null;
    }
}

/**
 * Processes an image from a buffer, resizes it to 300x300 (without enlargement),
 * and returns a base64 Data URI.
 * 
 * @param buffer - The image buffer to process.
 * @returns A base64 Data URI string.
 */
export async function processImageFromBuffer(buffer: Buffer): Promise<string> {
    // Resize to max 300x300, without enlargement, discarding metadata and extraneous layers 
    const processedBuffer = await sharp(buffer)
        .resize(300, 300, {
            fit: 'cover',
            position: 'center',
            withoutEnlargement: true
        })
        .toFormat('png')    // standardizing to safely carry transparency
        .toBuffer();
        
    const base64String = processedBuffer.toString('base64');
    return `data:image/png;base64,${base64String}`;
}
