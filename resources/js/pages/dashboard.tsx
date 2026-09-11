import { Head } from '@inertiajs/react';
import { Download, FileText, Sticker, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { buildVectorSheet, downloadBytes } from '@/lib/build-sheet';
import {
    extractPlateFromCertificate,
    type ExtractedPlate,
} from '@/lib/extract-plate';
import {
    defaultPlateTemplate,
    parsePlateTemplate,
    rowCounts,
    sheetLayout,
    type PlateTemplate,
} from '@/lib/plate-template';
import { dashboard } from '@/routes';

function isPdf(file: File): boolean {
    return (
        file.type === 'application/pdf' ||
        file.name.toLowerCase().endsWith('.pdf')
    );
}

function isSvg(file: File): boolean {
    return (
        file.type === 'image/svg+xml' ||
        file.name.toLowerCase().endsWith('.svg')
    );
}

export default function Dashboard() {
    const pdfInputRef = useRef<HTMLInputElement>(null);
    const svgInputRef = useRef<HTMLInputElement>(null);
    const [plates, setPlates] = useState<ExtractedPlate[]>([]);
    const [template, setTemplate] =
        useState<PlateTemplate>(defaultPlateTemplate);
    const [templateName, setTemplateName] = useState('Default plate SVG');
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);

    const layout = sheetLayout(template, plates.length);
    const rows = rowCounts(plates.length, template.columns);

    async function addCertificates(list: FileList | File[] | null) {
        if (!list || list.length === 0) {
            return;
        }

        const pdfs = Array.from(list).filter(isPdf);

        if (pdfs.length === 0) {
            toast.error('Please upload certificate PDFs.');

            return;
        }

        setBusy(true);

        try {
            const extracted: ExtractedPlate[] = [];

            for (const [index, file] of pdfs.entries()) {
                setStatus(`Reading ${index + 1} of ${pdfs.length}…`);
                extracted.push(await extractPlateFromCertificate(file));
            }

            setPlates((current) => [...current, ...extracted]);
            toast.success(
                `Added ${extracted.length} plate${extracted.length === 1 ? '' : 's'}.`,
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Could not extract a plate from one of the PDFs.',
            );
        } finally {
            setBusy(false);
            setStatus(null);
        }
    }

    async function handleTemplate(file: File | undefined) {
        if (!file || !isSvg(file)) {
            toast.error('Please upload an SVG template.');

            return;
        }

        try {
            setTemplate(parsePlateTemplate(await file.text()));
            setTemplateName(file.name);
            toast.success('Loaded the SVG template.');
        } catch {
            toast.error('Could not read that SVG template.');
        }
    }

    async function handleDownload() {
        if (plates.length === 0 || busy) {
            return;
        }

        setBusy(true);

        try {
            setStatus('Building PDF…');
            const bytes = await buildVectorSheet(
                plates.map((plate) => ({
                    name: plate.name,
                    file: plate.file,
                    bytes: plate.bytes,
                    pageNumber: plate.pageNumber,
                    box: plate.box,
                })),
                template,
            );

            downloadBytes(bytes, 'sticker-plate.pdf', 'application/pdf');
            toast.success('Plate PDF downloaded.');
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Could not build the plate PDF.',
            );
        } finally {
            setBusy(false);
            setStatus(null);
        }
    }

    return (
        <>
            <Head title="Sticker plate" />

            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-1">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="space-y-1">
                        <h1 className="text-xl font-semibold tracking-tight">
                            Sticker plate
                        </h1>
                        <p className="text-muted-foreground max-w-xl text-sm">
                            Each certificate PDF is one sticker. Upload as many
                            as you want, then download the sheet as PDF.
                        </p>
                    </div>
                    <Button
                        size="lg"
                        disabled={plates.length === 0 || busy}
                        onClick={() => void handleDownload()}
                        data-test="download-plate-button"
                    >
                        <Download />
                        {busy && status ? status : 'Download PDF'}
                    </Button>
                </div>

                <input
                    ref={pdfInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    className="sr-only"
                    onChange={(event) => {
                        void addCertificates(event.target.files);
                        event.target.value = '';
                    }}
                />
                <input
                    ref={svgInputRef}
                    type="file"
                    accept="image/svg+xml,.svg"
                    className="sr-only"
                    onChange={(event) => {
                        void handleTemplate(event.target.files?.[0]);
                        event.target.value = '';
                    }}
                />

                <button
                    type="button"
                    disabled={busy}
                    onClick={() => pdfInputRef.current?.click()}
                    onDragEnter={(event) => {
                        event.preventDefault();
                        setDragging(true);
                    }}
                    onDragOver={(event) => {
                        event.preventDefault();
                        setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                        event.preventDefault();
                        setDragging(false);
                        void addCertificates(event.dataTransfer.files);
                    }}
                    className={`rounded-xl border border-dashed px-6 py-10 text-center transition-colors ${
                        dragging
                            ? 'border-primary bg-primary/5'
                            : 'border-sidebar-border hover:border-primary/50 hover:bg-muted/40'
                    }`}
                >
                    <Upload className="mx-auto mb-3 size-8 opacity-70" />
                    <p className="font-medium">
                        Drop certificate PDFs here, or click to upload
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Multiple files are fine. Each extra upload is added. One
                        PDF = one sticker.
                    </p>
                </button>

                <div className="grid gap-2">
                    <Label>SVG template</Label>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            disabled={busy}
                            onClick={() => svgInputRef.current?.click()}
                        >
                            Upload SVG
                        </Button>
                        <span className="text-muted-foreground truncate text-sm">
                            {templateName} · {template.stickerWidthMm} ×{' '}
                            {template.stickerHeightMm} mm · sheet{' '}
                            {template.sheetWidthMm} mm
                        </span>
                    </div>
                </div>

                {plates.length > 0 && (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-sm">
                                {plates.length} sticker
                                {plates.length === 1 ? '' : 's'} ·{' '}
                                {rows.join(' + ')} · sheet{' '}
                                {template.sheetWidthMm} ×{' '}
                                {((layout.heightPt * 25.4) / 72).toFixed(1)} mm
                            </p>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                onClick={() => setPlates([])}
                            >
                                Clear all
                            </Button>
                        </div>

                        <div className="overflow-x-auto rounded-xl border bg-black p-3">
                            <div
                                className="grid"
                                style={{
                                    gridTemplateColumns: `repeat(${template.columns}, minmax(0, 1fr))`,
                                    gap: '0.45rem',
                                    width: '100%',
                                }}
                            >
                                {plates.map((plate) => (
                                    <div
                                        key={plate.id}
                                        className="relative overflow-hidden bg-white"
                                        style={{
                                            aspectRatio: `${template.stickerWidthMm} / ${template.stickerHeightMm}`,
                                            border: `2px solid ${template.cutlineHex}`,
                                        }}
                                    >
                                        <img
                                            src={plate.previewUrl}
                                            alt={plate.name}
                                            className="absolute object-fill"
                                            style={{
                                                left: `${((template.stickerWidthMm - template.artworkWidthMm) / 2 / template.stickerWidthMm) * 100}%`,
                                                top: `${((template.stickerHeightMm - template.artworkHeightMm) / 2 / template.stickerHeightMm) * 100}%`,
                                                width: `${(template.artworkWidthMm / template.stickerWidthMm) * 100}%`,
                                                height: `${(template.artworkHeightMm / template.stickerHeightMm) * 100}%`,
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className="absolute top-1 right-1 rounded-md bg-black/70 p-1 text-white"
                                            onClick={() =>
                                                setPlates((current) =>
                                                    current.filter(
                                                        (item) =>
                                                            item.id !==
                                                            plate.id,
                                                    ),
                                                )
                                            }
                                            aria-label={`Remove ${plate.name}`}
                                        >
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <ul className="divide-y rounded-xl border">
                            {plates.map((plate) => (
                                <li
                                    key={`${plate.id}-row`}
                                    className="flex items-center gap-3 px-3 py-2 text-sm"
                                >
                                    <FileText className="text-muted-foreground size-4 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate">
                                        {plate.name}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {plates.length === 0 && (
                    <div className="text-muted-foreground flex items-start gap-2 text-sm">
                        <Sticker className="mt-0.5 size-4 shrink-0" />
                        <p>
                            Up to {template.columns} stickers per row on a{' '}
                            {template.sheetWidthMm} mm PDF sheet. A short final
                            row is left as-is. Cutline {template.cutlineHex}.
                        </p>
                    </div>
                )}
            </div>
        </>
    );
}

Dashboard.layout = {
    breadcrumbs: [
        {
            title: 'Sticker plate',
            href: dashboard(),
        },
    ],
};
