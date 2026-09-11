import {
    PDFArray,
    PDFDict,
    PDFDocument,
    PDFName,
    PDFNumber,
    PDFRawStream,
    PDFStream,
    decodePDFRawStream,
} from 'pdf-lib';
import type { PdfBox } from '@/lib/detect-plate';
import { filterPlateContent } from '@/lib/filter-plate-stream';

function latin1FromBytes(bytes: Uint8Array): string {
    let value = '';

    for (const byte of bytes) {
        value += String.fromCharCode(byte);
    }

    return value;
}

function decodeStream(stream: PDFStream): Uint8Array {
    if (stream instanceof PDFRawStream) {
        return decodePDFRawStream(stream).decode();
    }

    const encoded = stream.getContents();

    try {
        return decodePDFRawStream(
            PDFRawStream.of(stream.dict, encoded),
        ).decode();
    } catch {
        return encoded;
    }
}

function pageContent(page: {
    node: {
        normalize: () => void;
        Contents: () => PDFStream | PDFArray | undefined;
    };
}): string {
    page.node.normalize();
    const contents = page.node.Contents();

    if (!contents) {
        return '';
    }

    const parts: Uint8Array[] = [];

    if (contents instanceof PDFArray) {
        for (let index = 0; index < contents.size(); index++) {
            const stream = contents.lookup(index);

            if (stream instanceof PDFStream) {
                parts.push(decodeStream(stream));
            }
        }
    } else if (contents instanceof PDFStream) {
        parts.push(decodeStream(contents));
    }

    return parts.map((part) => latin1FromBytes(part)).join('\n');
}

function graphicsStateAlphas(page: {
    node: { Resources: () => PDFDict | undefined };
}): Record<string, number> {
    const alphas: Record<string, number> = {};
    const resources = page.node.Resources();
    const ext = resources?.lookup(PDFName.of('ExtGState'));

    if (!(ext instanceof PDFDict)) {
        return alphas;
    }

    for (const [key] of ext.entries()) {
        const dict = ext.lookup(key);

        if (!(dict instanceof PDFDict)) {
            continue;
        }

        const fillAlpha = dict.lookup(PDFName.of('ca'));

        if (fillAlpha instanceof PDFNumber) {
            alphas[key.asString().replace(/^\//, '')] = fillAlpha.asNumber();
        }
    }

    return alphas;
}

function usedXObjectNames(content: string): Set<string> {
    const names = new Set<string>();
    const pattern = /\/([^\s/<]+)\s+Do\b/g;

    for (const match of content.matchAll(pattern)) {
        if (match[1]) {
            names.add(match[1]);
        }
    }

    return names;
}

function pruneUnusedXObjects(
    page: { node: { Resources: () => PDFDict | undefined } },
    content: string,
): void {
    const resources = page.node.Resources();
    const xObjects = resources?.lookup(PDFName.of('XObject'));

    if (!(xObjects instanceof PDFDict)) {
        return;
    }

    const used = usedXObjectNames(content);

    for (const [key] of [...xObjects.entries()]) {
        if (!used.has(key.decodeText())) {
            xObjects.delete(key);
        }
    }
}

export async function extractVectorPlate(
    sourceBytes: Uint8Array,
    pageNumber: number,
    box: PdfBox,
): Promise<Uint8Array> {
    const source = await PDFDocument.load(sourceBytes);
    const output = await PDFDocument.create();
    const [copied] = await output.copyPages(source, [pageNumber - 1]);
    output.addPage(copied);

    const page = output.getPages()[0];

    if (!page) {
        throw new Error('Could not copy the certificate page.');
    }

    const filtered = filterPlateContent(
        pageContent(page),
        box,
        graphicsStateAlphas(page),
    );
    pruneUnusedXObjects(page, filtered);
    const shifted = `q\n1 0 0 1 ${-box.x} ${-box.y} cm\n${filtered}\nQ\n`;
    const stream = output.context.register(output.context.flateStream(shifted));

    page.node.set(PDFName.of('Contents'), stream);
    page.node.delete(PDFName.of('Annots'));
    page.setMediaBox(0, 0, box.width, box.height);
    page.setCropBox(0, 0, box.width, box.height);

    return output.save();
}
