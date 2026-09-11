import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerSrc;

export function copyPdfBytes(data: ArrayBuffer | Uint8Array): Uint8Array {
    return data instanceof Uint8Array
        ? data.slice()
        : new Uint8Array(data.slice(0));
}

export function hasPdfHeader(bytes: Uint8Array): boolean {
    try {
        return (
            bytes.byteLength >= 5 &&
            bytes[0] === 0x25 &&
            bytes[1] === 0x50 &&
            bytes[2] === 0x44 &&
            bytes[3] === 0x46 &&
            bytes[4] === 0x2d
        );
    } catch {
        return false;
    }
}

export async function openPdfDocument(data: ArrayBuffer | Uint8Array): Promise<{
    document: PDFDocumentProxy;
    destroy: () => Promise<void>;
}> {
    // pdf.js may transfer/detach the ArrayBuffer it is given. Always pass a copy.
    const loadingTask = getDocument({
        data: copyPdfBytes(data),
        disableAutoFetch: true,
        disableStream: true,
    });
    const documentProxy = await loadingTask.promise;

    return {
        document: documentProxy,
        destroy: async () => {
            await documentProxy.cleanup();
            await loadingTask.destroy();
        },
    };
}
