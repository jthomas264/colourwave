import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import {
    clampBox,
    detectPlateBox,
    inflateBox,
    type PdfBox,
} from '@/lib/detect-plate';
import { extractVectorPlate } from '@/lib/extract-vector-plate';
import { copyPdfBytes, openPdfDocument } from '@/lib/pdf-document';
import { isDarkInk } from '@/lib/wash-watermark';

export type ExtractedPlate = {
    id: string;
    file: File;
    name: string;
    bytes: Uint8Array;
    pageNumber: number;
    box: PdfBox;
    pageWidth: number;
    pageHeight: number;
    previewUrl: string;
};

export async function extractPlateFromCertificate(
    file: File,
): Promise<ExtractedPlate> {
    const bytes = copyPdfBytes(await file.arrayBuffer());
    const { document, destroy } = await openPdfDocument(bytes);

    try {
        for (
            let pageNumber = 1;
            pageNumber <= document.numPages;
            pageNumber++
        ) {
            const page = await document.getPage(pageNumber);
            const view = page.view;
            const pageBox = {
                x: view[0],
                y: view[1],
                width: view[2] - view[0],
                height: view[3] - view[1],
            };

            try {
                const detected = clampBox(await detectPlateBox(page), pageBox);
                const box = await tightenPlateBox(page, detected, pageBox);
                const plateBytes = await extractVectorPlate(
                    bytes,
                    pageNumber,
                    box,
                );
                const previewUrl = await previewPlatePdf(plateBytes);

                return {
                    id: crypto.randomUUID(),
                    file,
                    name: file.name,
                    bytes: plateBytes,
                    pageNumber: 1,
                    box: {
                        x: 0,
                        y: 0,
                        width: box.width,
                        height: box.height,
                    },
                    pageWidth: box.width,
                    pageHeight: box.height,
                    previewUrl,
                };
            } catch (error) {
                if (pageNumber === document.numPages) {
                    throw error;
                }
            }
        }

        throw new Error('Could not find the vehicle plate in this PDF.');
    } finally {
        await destroy();
    }
}

function canvasCrop(
    box: PdfBox,
    scale: number,
    pageHeight: number,
    canvas: HTMLCanvasElement,
): { sx: number; sy: number; sw: number; sh: number } {
    const sx = Math.max(0, Math.floor(box.x * scale));
    const sy = Math.max(
        0,
        Math.floor((pageHeight - box.y - box.height) * scale),
    );
    const sw = Math.max(
        1,
        Math.min(canvas.width - sx, Math.ceil(box.width * scale)),
    );
    const sh = Math.max(
        1,
        Math.min(canvas.height - sy, Math.ceil(box.height * scale)),
    );

    return { sx, sy, sw, sh };
}

function tightenBoxToInk(
    image: ImageData,
    search: PdfBox,
    pageBox: PdfBox,
    scale: number,
): PdfBox {
    const { data, width, height } = image;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            const red = data[index] ?? 255;
            const green = data[index + 1] ?? 255;
            const blue = data[index + 2] ?? 255;

            if (isDarkInk(red, green, blue)) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }

    if (maxX < 0) {
        return search;
    }

    const padPx = 1;

    return clampBox(
        {
            x: search.x + Math.max(0, minX - padPx) / scale,
            y:
                search.y +
                search.height -
                Math.min(height, maxY + 1 + padPx) / scale,
            width:
                (Math.min(width, maxX + 1 + padPx) -
                    Math.max(0, minX - padPx)) /
                scale,
            height:
                (Math.min(height, maxY + 1 + padPx) -
                    Math.max(0, minY - padPx)) /
                scale,
        },
        pageBox,
    );
}

async function tightenPlateBox(
    page: PDFPageProxy,
    detected: PdfBox,
    pageBox: PdfBox,
): Promise<PdfBox> {
    const scale = 96 / 72;
    const viewport = page.getViewport({ scale });
    const canvas = window.document.createElement('canvas');

    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));

    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
        return detected;
    }

    await page.render({
        canvas,
        canvasContext: context,
        viewport,
    }).promise;

    const search = clampBox(inflateBox(detected, 12), pageBox);
    const region = canvasCrop(search, scale, pageBox.height, canvas);

    return tightenBoxToInk(
        context.getImageData(region.sx, region.sy, region.sw, region.sh),
        search,
        pageBox,
        scale,
    );
}

async function previewPlatePdf(bytes: Uint8Array): Promise<string> {
    const { document, destroy } = await openPdfDocument(bytes);

    try {
        const page = await document.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = window.document.createElement('canvas');

        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));

        const context = canvas.getContext('2d');

        if (!context) {
            throw new Error('Canvas is not available in this browser.');
        }

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
            canvas,
            canvasContext: context,
            viewport,
        }).promise;

        return canvas.toDataURL('image/png');
    } finally {
        await destroy();
    }
}
