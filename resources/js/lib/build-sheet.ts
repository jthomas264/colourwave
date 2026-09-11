import { PDFDocument, cmyk } from 'pdf-lib';
import type { PdfBox } from '@/lib/detect-plate';
import { copyPdfBytes, hasPdfHeader } from '@/lib/pdf-document';
import {
    artworkRect,
    cellOrigin,
    hexToCmyk,
    sheetLayout,
    type PlateTemplate,
} from '@/lib/plate-template';

export type SourcePlate = {
    name: string;
    file?: File;
    bytes: Uint8Array;
    pageNumber: number;
    box: PdfBox;
};

async function sourcePdfBytes(plate: SourcePlate): Promise<Uint8Array> {
    if (hasPdfHeader(plate.bytes)) {
        return copyPdfBytes(plate.bytes);
    }

    if (plate.file) {
        const fromFile = copyPdfBytes(await plate.file.arrayBuffer());

        if (hasPdfHeader(fromFile)) {
            return fromFile;
        }
    }

    throw new Error(
        `Could not read ${plate.name}. Re-upload the certificate PDF and try again.`,
    );
}

export async function buildVectorSheet(
    plates: SourcePlate[],
    template: PlateTemplate,
): Promise<Uint8Array> {
    if (plates.length === 0) {
        throw new Error('Upload at least one certificate PDF.');
    }

    const layout = sheetLayout(template, plates.length);
    const sheet = await PDFDocument.create();
    const page = sheet.addPage([layout.widthPt, layout.heightPt]);
    const cut = hexToCmyk(template.cutlineHex);

    for (const [index, plate] of plates.entries()) {
        const source = await PDFDocument.load(await sourcePdfBytes(plate));
        const sourcePage = source.getPages()[plate.pageNumber - 1];

        if (!sourcePage) {
            throw new Error(`Could not read ${plate.name}.`);
        }

        const embedded = await sheet.embedPage(sourcePage);
        const origin = cellOrigin(index, layout);

        page.drawPage(embedded, artworkRect(origin, layout, template));

        page.drawRectangle({
            x: origin.x,
            y: origin.y,
            width: layout.stickerWidthPt,
            height: layout.stickerHeightPt,
            borderWidth: template.cutlineStrokePt,
            borderColor: cmyk(cut.c, cut.m, cut.y, cut.k),
        });
    }

    return sheet.save();
}

export function downloadBytes(
    bytes: Uint8Array,
    filename: string,
    type: string,
): void {
    const blob = new Blob([Uint8Array.from(bytes)], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
