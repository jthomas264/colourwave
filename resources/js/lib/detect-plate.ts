import { OPS } from 'pdfjs-dist';
import type { PDFPageProxy, TextItem } from 'pdfjs-dist/types/src/display/api';

export type PdfBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const TITLE_PATTERNS = [
    /MAXIMUM\s+WEIGHTS/i,
    /FIT FOR USE/i,
    /THIS VEHICLE IS FIT/i,
];

const ANCHOR_PATTERNS = [
    ...TITLE_PATTERNS,
    /Vehicle\s+Make/i,
    /Chassis\s+No/i,
    /\bGVM\b/i,
    /\bGTM\b/i,
    /\bAXLE\b/i,
    /CHASSIS/i,
];

const FOOTER_PATTERNS = [
    /www\.svtech/i,
    /\bTel\./i,
    /\bFax\./i,
    /Lancashire/i,
    /\+44\s*\(0\)\s*1772/i,
];

export function isPlateAspect(box: PdfBox): boolean {
    const ratio = box.width / Math.max(box.height, 1);

    return ratio >= 2 && ratio <= 4.2;
}

export function isPlateTitle(text: string): boolean {
    return TITLE_PATTERNS.some((pattern) => pattern.test(text));
}

export function isFooterText(text: string): boolean {
    return FOOTER_PATTERNS.some((pattern) => pattern.test(text));
}

export function isPlateAnchor(text: string): boolean {
    const value = text.trim();

    if (value.length === 0) {
        return false;
    }

    return ANCHOR_PATTERNS.some((pattern) => pattern.test(value));
}

export function isPlateSeed(text: string): boolean {
    return (
        isPlateTitle(text) ||
        /Vehicle\s+Make/i.test(text) ||
        /Chassis\s+No/i.test(text)
    );
}

export function unionBoxes(boxes: PdfBox[]): PdfBox | null {
    if (boxes.length === 0) {
        return null;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const box of boxes) {
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
    }

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

export function inflateBox(box: PdfBox, padding: number): PdfBox {
    return {
        x: box.x - padding,
        y: box.y - padding,
        width: box.width + padding * 2,
        height: box.height + padding * 2,
    };
}

function area(box: PdfBox): number {
    return Math.max(0, box.width) * Math.max(0, box.height);
}

function contains(outer: PdfBox, inner: PdfBox, slack = 0): boolean {
    return (
        outer.x <= inner.x + slack &&
        outer.y <= inner.y + slack &&
        outer.x + outer.width >= inner.x + inner.width - slack &&
        outer.y + outer.height >= inner.y + inner.height - slack
    );
}

function intersects(a: PdfBox, b: PdfBox, slack = 0): boolean {
    return (
        a.x <= b.x + b.width + slack &&
        a.x + a.width + slack >= b.x &&
        a.y <= b.y + b.height + slack &&
        a.y + a.height + slack >= b.y
    );
}

function multiply(a: Matrix, b: Matrix): Matrix {
    return [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ];
}

function apply(matrix: Matrix, x: number, y: number): { x: number; y: number } {
    return {
        x: matrix[0] * x + matrix[2] * y + matrix[4],
        y: matrix[1] * x + matrix[3] * y + matrix[5],
    };
}

function textItemBox(item: TextItem): PdfBox {
    const [, , , , x, y] = item.transform as Matrix;
    const width = Math.max(item.width, 1);
    const height = Math.max(item.height, 1);

    return {
        x,
        y,
        width,
        height,
    };
}

export function clusterPlateText(
    items: TextItem[],
    maxGap = 16,
): PdfBox | null {
    const boxes = items
        .filter((item) => item.str.trim().length > 0)
        .map((item) => ({
            item,
            box: textItemBox(item),
        }));

    const titleIndex = boxes.findIndex((entry) => isPlateTitle(entry.item.str));
    const seedIndex =
        titleIndex >= 0
            ? titleIndex
            : boxes.findIndex((entry) => isPlateSeed(entry.item.str));

    if (seedIndex < 0) {
        return null;
    }

    const used = new Set<number>([seedIndex]);
    let grew = true;

    while (grew) {
        grew = false;
        const cluster = unionBoxes(
            [...used]
                .map((index) => boxes[index]?.box)
                .filter(Boolean) as PdfBox[],
        );

        if (!cluster) {
            break;
        }

        boxes.forEach((entry, index) => {
            if (used.has(index)) {
                return;
            }

            if (isFooterText(entry.item.str) && !isPlateTitle(entry.item.str)) {
                return;
            }

            const close = intersects(inflateBox(cluster, maxGap), entry.box);
            const relatedAnchor =
                isPlateAnchor(entry.item.str) &&
                intersects(inflateBox(cluster, maxGap * 2), entry.box);

            if (close || relatedAnchor) {
                used.add(index);
                grew = true;
            }
        });
    }

    return unionBoxes(
        [...used].map((index) => boxes[index]?.box).filter(Boolean) as PdfBox[],
    );
}

function boxFromPoints(points: Array<{ x: number; y: number }>): PdfBox | null {
    if (points.length < 2) {
        return null;
    }

    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

function isAxisAlignedRectangle(
    points: Array<{ x: number; y: number }>,
): boolean {
    if (points.length < 4) {
        return false;
    }

    const xs = new Set(points.map((point) => Math.round(point.x * 10)));
    const ys = new Set(points.map((point) => Math.round(point.y * 10)));

    return xs.size === 2 && ys.size === 2;
}

export function pickPlateRectangle(
    rectangles: PdfBox[],
    cluster: PdfBox,
    page: PdfBox,
): PdfBox | null {
    const pageArea = area(page);
    const candidates = rectangles.filter((rectangle) => {
        const rectangleArea = area(rectangle);

        return (
            isPlateAspect(rectangle) &&
            rectangle.height >= Math.max(36, cluster.height * 0.85) &&
            rectangle.width >= cluster.width * 0.85 &&
            rectangleArea < pageArea * 0.8 &&
            rectangleArea > area(cluster) * 0.7 &&
            contains(rectangle, cluster, 12)
        );
    });

    if (candidates.length === 0) {
        return null;
    }

    candidates.sort((left, right) => area(left) - area(right));

    return candidates[0] ?? null;
}

async function collectRectangles(page: PDFPageProxy): Promise<PdfBox[]> {
    const operatorList = await page.getOperatorList();
    const stack: Matrix[] = [];
    let ctm: Matrix = IDENTITY;
    const rectangles: PdfBox[] = [];
    let pathPoints: Array<{ x: number; y: number }> = [];

    const pushRectangle = (
        x: number,
        y: number,
        width: number,
        height: number,
    ) => {
        const a = apply(ctm, x, y);
        const b = apply(ctm, x + width, y + height);
        const box = boxFromPoints([a, b]);

        if (box && box.width > 8 && box.height > 8) {
            rectangles.push(box);
        }
    };

    for (let index = 0; index < operatorList.fnArray.length; index++) {
        const fn = operatorList.fnArray[index];
        const args = operatorList.argsArray[index] as unknown[] | undefined;

        if (fn === OPS.save) {
            stack.push(ctm);
            continue;
        }

        if (fn === OPS.restore) {
            ctm = stack.pop() ?? IDENTITY;
            continue;
        }

        if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
            ctm = multiply(ctm, args as Matrix);
            continue;
        }

        if (fn === OPS.rectangle && Array.isArray(args) && args.length >= 4) {
            pushRectangle(
                Number(args[0]),
                Number(args[1]),
                Number(args[2]),
                Number(args[3]),
            );
            continue;
        }

        if (fn === OPS.constructPath && Array.isArray(args)) {
            const coords = args[1];

            if (coords instanceof Float32Array || Array.isArray(coords)) {
                const values = Array.from(coords as ArrayLike<number>);

                if (values.length === 4) {
                    pushRectangle(
                        values[0] ?? 0,
                        values[1] ?? 0,
                        values[2] ?? 0,
                        values[3] ?? 0,
                    );
                } else {
                    pathPoints = [];

                    for (
                        let offset = 0;
                        offset + 1 < values.length;
                        offset += 2
                    ) {
                        pathPoints.push(
                            apply(
                                ctm,
                                values[offset] ?? 0,
                                values[offset + 1] ?? 0,
                            ),
                        );
                    }

                    if (isAxisAlignedRectangle(pathPoints)) {
                        const box = boxFromPoints(pathPoints);

                        if (box && box.width > 8 && box.height > 8) {
                            rectangles.push(box);
                        }
                    }
                }
            }
        }
    }

    return rectangles;
}

export async function detectPlateBox(page: PDFPageProxy): Promise<PdfBox> {
    const view = page.view;
    const pageBox: PdfBox = {
        x: view[0],
        y: view[1],
        width: view[2] - view[0],
        height: view[3] - view[1],
    };
    const text = await page.getTextContent();
    const items = text.items.filter((item): item is TextItem => 'str' in item);
    const cluster = clusterPlateText(items);
    const rectangles = await collectRectangles(page);

    if (cluster && isPlateAspect(inflateBox(cluster, 10))) {
        const bordered = pickPlateRectangle(rectangles, cluster, pageBox);

        if (bordered) {
            return bordered;
        }

        return inflateBox(cluster, 10);
    }

    const large = rectangles
        .filter(
            (rectangle) =>
                isPlateAspect(rectangle) &&
                rectangle.height >= 36 &&
                area(rectangle) < area(pageBox) * 0.8,
        )
        .sort((left, right) => area(right) - area(left))[0];

    if (large) {
        return large;
    }

    throw new Error(
        'Could not find the vehicle plate on this PDF. Check it contains the finished plate artwork.',
    );
}

export function clampBox(box: PdfBox, page: PdfBox): PdfBox {
    const x = Math.max(page.x, box.x);
    const y = Math.max(page.y, box.y);
    const right = Math.min(page.x + page.width, box.x + box.width);
    const top = Math.min(page.y + page.height, box.y + box.height);

    return {
        x,
        y,
        width: Math.max(1, right - x),
        height: Math.max(1, top - y),
    };
}
