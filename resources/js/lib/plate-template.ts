import defaultTemplateSvg from '../../plate/template.svg?raw';

export type PlateTemplate = {
    sheetWidthMm: number;
    columns: number;
    gapMm: number;
    marginMm: number;
    stickerWidthMm: number;
    stickerHeightMm: number;
    artworkWidthMm: number;
    artworkHeightMm: number;
    cutlineHex: string;
    cutlineStrokePt: number;
};

export type SheetLayout = {
    widthPt: number;
    heightPt: number;
    rows: number;
    columns: number;
    gapPt: number;
    marginPt: number;
    stickerWidthPt: number;
    stickerHeightPt: number;
    quantity: number;
};

function attribute(svg: string, name: string, fallback: string): string {
    const match = svg.match(new RegExp(`${name}="([^"]+)"`));

    return match?.[1] ?? fallback;
}

function firstCutlineRect(svg: string): {
    x: number;
    y: number;
    width: number;
    height: number;
} | null {
    const match = svg.match(
        /class="cutline"[^>]*\sx="([^"]+)"[^>]*\sy="([^"]+)"[^>]*\swidth="([^"]+)"[^>]*\sheight="([^"]+)"/,
    );

    if (!match) {
        return null;
    }

    return {
        x: Number.parseFloat(match[1] ?? '0'),
        y: Number.parseFloat(match[2] ?? '0'),
        width: Number.parseFloat(match[3] ?? '0'),
        height: Number.parseFloat(match[4] ?? '0'),
    };
}

export function parsePlateTemplate(
    svg: string = defaultTemplateSvg,
): PlateTemplate {
    const rect = firstCutlineRect(svg);
    const strokeMatch = svg.match(
        /class="cutline"[^>]*stroke="(#[0-9A-Fa-f]{6})"/,
    );

    return {
        sheetWidthMm: Number.parseFloat(
            attribute(svg, 'data-sheet-width-mm', '560.004'),
        ),
        columns: Number.parseInt(attribute(svg, 'data-columns', '4'), 10),
        gapMm: Number.parseFloat(attribute(svg, 'data-gap-mm', '2')),
        marginMm: Number.parseFloat(
            attribute(svg, 'data-margin-mm', rect ? String(rect.x) : '3'),
        ),
        stickerWidthMm: Number.parseFloat(
            attribute(
                svg,
                'data-sticker-width-mm',
                rect ? String(rect.width) : '137.001',
            ),
        ),
        stickerHeightMm: Number.parseFloat(
            attribute(
                svg,
                'data-sticker-height-mm',
                rect ? String(rect.height) : '63.301',
            ),
        ),
        artworkWidthMm: Number.parseFloat(
            attribute(svg, 'data-artwork-width-mm', '134.001'),
        ),
        artworkHeightMm: Number.parseFloat(
            attribute(svg, 'data-artwork-height-mm', '60.547'),
        ),
        cutlineHex: attribute(
            svg,
            'data-cutline-color',
            strokeMatch?.[1] ?? '#FF00FF',
        ).toUpperCase(),
        cutlineStrokePt: Number.parseFloat(
            attribute(svg, 'data-cutline-stroke-pt', '0.25'),
        ),
    };
}

export const defaultPlateTemplate: PlateTemplate = parsePlateTemplate();

export function mmToPt(mm: number): number {
    return (mm * 72) / 25.4;
}

export function ptToMm(pt: number): number {
    return (pt * 25.4) / 72;
}

export function hexToCmyk(hex: string): {
    c: number;
    m: number;
    y: number;
    k: number;
} {
    const value = hex.replace('#', '');
    const r = Number.parseInt(value.slice(0, 2), 16) / 255;
    const g = Number.parseInt(value.slice(2, 4), 16) / 255;
    const b = Number.parseInt(value.slice(4, 6), 16) / 255;
    const k = 1 - Math.max(r, g, b);

    if (k >= 1) {
        return { c: 0, m: 0, y: 0, k: 1 };
    }

    return {
        c: (1 - r - k) / (1 - k),
        m: (1 - g - k) / (1 - k),
        y: (1 - b - k) / (1 - k),
        k,
    };
}

export function rowCounts(quantity: number, columns: number): number[] {
    const safeQuantity = Math.max(0, Math.floor(quantity));
    const rows: number[] = [];
    let remaining = safeQuantity;

    while (remaining > 0) {
        const count = Math.min(columns, remaining);
        rows.push(count);
        remaining -= count;
    }

    return rows;
}

export function sheetLayout(
    template: PlateTemplate,
    quantity: number,
): SheetLayout {
    const counts = rowCounts(quantity, template.columns);
    const rows = Math.max(1, counts.length);
    const gapPt = mmToPt(template.gapMm);
    const marginPt = mmToPt(template.marginMm);

    return {
        widthPt: mmToPt(template.sheetWidthMm),
        heightPt:
            marginPt * 2 +
            rows * mmToPt(template.stickerHeightMm) +
            Math.max(0, rows - 1) * gapPt,
        rows,
        columns: template.columns,
        gapPt,
        marginPt,
        stickerWidthPt: mmToPt(template.stickerWidthMm),
        stickerHeightPt: mmToPt(template.stickerHeightMm),
        quantity: Math.max(0, Math.floor(quantity)),
    };
}

export function artworkRect(
    origin: { x: number; y: number },
    layout: SheetLayout,
    template: PlateTemplate,
): { x: number; y: number; width: number; height: number } {
    const width = mmToPt(template.artworkWidthMm);
    const height = mmToPt(template.artworkHeightMm);

    return {
        x: origin.x + (layout.stickerWidthPt - width) / 2,
        y: origin.y + (layout.stickerHeightPt - height) / 2,
        width,
        height,
    };
}

export function cellOrigin(
    index: number,
    layout: SheetLayout,
): { x: number; y: number } {
    const col = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const x = layout.marginPt + col * (layout.stickerWidthPt + layout.gapPt);
    const yFromTop =
        layout.marginPt + row * (layout.stickerHeightPt + layout.gapPt);

    return {
        x,
        y: layout.heightPt - yFromTop - layout.stickerHeightPt,
    };
}
