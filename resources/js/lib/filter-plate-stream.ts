import type { PdfBox } from '@/lib/detect-plate';
import { isWatermarkCandidate } from '@/lib/wash-watermark';

type Token = {
    start: number;
    end: number;
    kind: 'op' | 'other';
    text: string;
};

type Matrix = [number, number, number, number, number, number];

type Color = {
    red: number;
    green: number;
    blue: number;
    alpha: number;
};

type Paint = {
    faint: boolean;
    box: PdfBox | null;
};

type Operation = {
    index: number;
    op: string;
    start: number;
    end: number;
    paint: Paint | null;
    pathStart: number | null;
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const PATH_BUILD = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
const PATH_PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*']);
const TEXT_SHOW = new Set(['Tj', 'TJ', "'", '"']);

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

function boxFromPoints(points: Array<{ x: number; y: number }>): PdfBox | null {
    if (points.length === 0) {
        return null;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }

    return {
        x: minX,
        y: minY,
        width: Math.max(0, maxX - minX),
        height: Math.max(0, maxY - minY),
    };
}

function unionBox(boxes: PdfBox[]): PdfBox | null {
    return boxFromPoints(
        boxes.flatMap((box) => [
            { x: box.x, y: box.y },
            { x: box.x + box.width, y: box.y + box.height },
        ]),
    );
}

function intersects(a: PdfBox, b: PdfBox, slack = 2): boolean {
    return (
        a.x <= b.x + b.width + slack &&
        a.x + a.width + slack >= b.x &&
        a.y <= b.y + b.height + slack &&
        a.y + a.height + slack >= b.y
    );
}

function isWhitespace(char: string): boolean {
    return (
        char === ' ' ||
        char === '\n' ||
        char === '\r' ||
        char === '\t' ||
        char === '\f' ||
        char === '\0'
    );
}

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let index = 0;

    const push = (start: number, end: number, kind: Token['kind']) => {
        tokens.push({
            start,
            end,
            kind,
            text: source.slice(start, end),
        });
    };

    while (index < source.length) {
        const char = source[index] ?? '';

        if (isWhitespace(char)) {
            index += 1;
            continue;
        }

        if (char === '%') {
            while (index < source.length && source[index] !== '\n') {
                index += 1;
            }
            continue;
        }

        if (char === '(') {
            const start = index;
            let depth = 1;
            index += 1;

            while (index < source.length && depth > 0) {
                if (source[index] === '\\') {
                    index += 2;
                    continue;
                }

                if (source[index] === '(') {
                    depth += 1;
                } else if (source[index] === ')') {
                    depth -= 1;
                }

                index += 1;
            }

            push(start, index, 'other');
            continue;
        }

        if (char === '<' && source[index + 1] === '<') {
            const start = index;
            index += 2;
            let depth = 1;

            while (index < source.length && depth > 0) {
                if (source[index] === '<' && source[index + 1] === '<') {
                    depth += 1;
                    index += 2;
                    continue;
                }

                if (source[index] === '>' && source[index + 1] === '>') {
                    depth -= 1;
                    index += 2;
                    continue;
                }

                index += 1;
            }

            push(start, index, 'other');
            continue;
        }

        if (char === '<') {
            const start = index;
            index += 1;

            while (index < source.length && source[index] !== '>') {
                index += 1;
            }

            index += 1;
            push(start, index, 'other');
            continue;
        }

        if (
            char === '/' ||
            char === '[' ||
            char === ']' ||
            char === '{' ||
            char === '}'
        ) {
            const start = index;
            index += 1;

            if (char === '/') {
                while (
                    index < source.length &&
                    !isWhitespace(source[index] ?? '') &&
                    !'()<>[]{}/%'.includes(source[index] ?? '')
                ) {
                    index += 1;
                }
            }

            push(start, index, 'other');
            continue;
        }

        if (
            char === '+' ||
            char === '-' ||
            char === '.' ||
            (char >= '0' && char <= '9')
        ) {
            const start = index;
            index += 1;

            while (
                index < source.length &&
                /[0-9.+\-eE]/.test(source[index] ?? '')
            ) {
                index += 1;
            }

            push(start, index, 'other');
            continue;
        }

        if (/[A-Za-z*'"]/.test(char)) {
            const start = index;
            index += 1;

            while (
                index < source.length &&
                /[A-Za-z*'"]/.test(source[index] ?? '')
            ) {
                index += 1;
            }

            if (source.slice(start, index) === 'BI') {
                const id = source.indexOf('ID', index);
                const ei = id >= 0 ? source.indexOf('EI', id + 2) : -1;

                if (ei >= 0) {
                    push(start, ei + 2, 'op');
                    index = ei + 2;
                    continue;
                }
            }

            push(start, index, 'op');
            continue;
        }

        push(index, index + 1, 'other');
        index += 1;
    }

    return tokens;
}

function operations(tokens: Token[]): Operation[] {
    const ops: Operation[] = [];
    let argsStart: number | null = null;
    let pathStart: number | null = null;

    tokens.forEach((token, tokenIndex) => {
        if (token.kind !== 'op') {
            if (argsStart === null) {
                argsStart = token.start;
            }

            return;
        }

        const start = argsStart ?? token.start;
        const op: Operation = {
            index: ops.length,
            op: token.text,
            start,
            end: token.end,
            paint: null,
            pathStart: PATH_PAINT.has(token.text) ? pathStart : null,
        };

        if (PATH_BUILD.has(token.text) && pathStart === null) {
            pathStart = start;
        }

        if (
            PATH_PAINT.has(token.text) ||
            token.text === 'n' ||
            token.text === 'W' ||
            token.text === 'W*'
        ) {
            pathStart = null;
        }

        ops.push(op);
        argsStart = null;
        void tokenIndex;
    });

    return ops;
}

function numbersBefore(source: string, op: Operation, count: number): number[] {
    const chunk = source.slice(op.start, op.end).trim();
    const parts = chunk.split(/[\s]+/);
    const values: number[] = [];

    for (
        let index = parts.length - 2;
        index >= 0 && values.length < count;
        index--
    ) {
        const value = Number.parseFloat(parts[index] ?? '');

        if (!Number.isNaN(value)) {
            values.unshift(value);
        }
    }

    return values;
}

function nameBefore(source: string, op: Operation): string {
    const match = source
        .slice(op.start, op.end)
        .match(/\/([^\s]+)\s+[A-Za-z*'"]+$/);

    return match?.[1] ?? '';
}

function cmykToRgb(c: number, m: number, y: number, k: number): Color {
    return {
        red: (1 - c) * (1 - k) * 255,
        green: (1 - m) * (1 - k) * 255,
        blue: (1 - y) * (1 - k) * 255,
        alpha: 1,
    };
}

function isFaint(color: Color): boolean {
    if (color.alpha < 0.5) {
        return true;
    }

    return isWatermarkCandidate(color.red, color.green, color.blue);
}

function isLargeForPlate(box: PdfBox, plate: PdfBox): boolean {
    return box.width >= plate.width * 0.22 || box.height >= plate.height * 0.28;
}

export function filterPlateContent(
    source: string,
    plate: PdfBox,
    alphas: Record<string, number> = {},
): string {
    const tokens = tokenize(source);
    const ops = operations(tokens);
    const stack: Array<{
        ctm: Matrix;
        fill: Color;
        stroke: Color;
        fontSize: number;
        text: Matrix;
    }> = [];
    let ctm: Matrix = IDENTITY;
    let fill: Color = { red: 0, green: 0, blue: 0, alpha: 1 };
    let stroke: Color = { red: 0, green: 0, blue: 0, alpha: 1 };
    let fontSize = 12;
    let textMatrix: Matrix = IDENTITY;
    let pathPoints: Array<{ x: number; y: number }> = [];

    const applyColor = (kind: 'fill' | 'stroke', color: Color) => {
        if (kind === 'fill') {
            fill = { ...color, alpha: fill.alpha };
        } else {
            stroke = { ...color, alpha: stroke.alpha };
        }
    };

    for (const op of ops) {
        if (op.op === 'q') {
            stack.push({ ctm, fill, stroke, fontSize, text: textMatrix });
        } else if (op.op === 'Q') {
            const previous = stack.pop();

            if (previous) {
                ctm = previous.ctm;
                fill = previous.fill;
                stroke = previous.stroke;
                fontSize = previous.fontSize;
                textMatrix = previous.text;
            }
        } else if (op.op === 'cm') {
            const values = numbersBefore(source, op, 6);

            if (values.length === 6) {
                ctm = multiply(ctm, values as Matrix);
            }
        } else if (op.op === 'gs') {
            const name = nameBefore(source, op);
            const alpha = alphas[name] ?? fill.alpha;
            fill = { ...fill, alpha };
            stroke = { ...stroke, alpha };
        } else if (op.op === 'rg') {
            const [red, green, blue] = numbersBefore(source, op, 3);
            applyColor('fill', {
                red: (red ?? 0) * 255,
                green: (green ?? 0) * 255,
                blue: (blue ?? 0) * 255,
                alpha: fill.alpha,
            });
        } else if (op.op === 'RG') {
            const [red, green, blue] = numbersBefore(source, op, 3);
            applyColor('stroke', {
                red: (red ?? 0) * 255,
                green: (green ?? 0) * 255,
                blue: (blue ?? 0) * 255,
                alpha: stroke.alpha,
            });
        } else if (op.op === 'g') {
            const [gray] = numbersBefore(source, op, 1);
            const value = (gray ?? 0) * 255;
            applyColor('fill', {
                red: value,
                green: value,
                blue: value,
                alpha: fill.alpha,
            });
        } else if (op.op === 'G') {
            const [gray] = numbersBefore(source, op, 1);
            const value = (gray ?? 0) * 255;
            applyColor('stroke', {
                red: value,
                green: value,
                blue: value,
                alpha: stroke.alpha,
            });
        } else if (op.op === 'k') {
            const [c, m, y, k] = numbersBefore(source, op, 4);
            applyColor('fill', cmykToRgb(c ?? 0, m ?? 0, y ?? 0, k ?? 0));
        } else if (op.op === 'K') {
            const [c, m, y, k] = numbersBefore(source, op, 4);
            applyColor('stroke', cmykToRgb(c ?? 0, m ?? 0, y ?? 0, k ?? 0));
        } else if (op.op === 'Tf') {
            const values = numbersBefore(source, op, 1);
            fontSize = values.at(-1) ?? fontSize;
        } else if (op.op === 'Tm') {
            const values = numbersBefore(source, op, 6);

            if (values.length === 6) {
                textMatrix = multiply(ctm, values as Matrix);
            }
        } else if (op.op === 'Td' || op.op === 'TD') {
            const [tx, ty] = numbersBefore(source, op, 2);
            textMatrix = multiply(textMatrix, [1, 0, 0, 1, tx ?? 0, ty ?? 0]);
        } else if (op.op === 'BT') {
            textMatrix = ctm;
        } else if (PATH_BUILD.has(op.op)) {
            const values = numbersBefore(source, op, 8);

            if (op.op === 're' && values.length >= 4) {
                const x = values[0] ?? 0;
                const y = values[1] ?? 0;
                const width = values[2] ?? 0;
                const height = values[3] ?? 0;
                pathPoints.push(
                    apply(ctm, x, y),
                    apply(ctm, x + width, y + height),
                );
            } else {
                for (let offset = 0; offset + 1 < values.length; offset += 2) {
                    pathPoints.push(
                        apply(
                            ctm,
                            values[offset] ?? 0,
                            values[offset + 1] ?? 0,
                        ),
                    );
                }
            }
        } else if (PATH_PAINT.has(op.op)) {
            const usesFill = !['S', 's'].includes(op.op);
            const usesStroke = !['f', 'F', 'f*'].includes(op.op);
            const color = usesFill ? fill : stroke;
            op.paint = {
                faint:
                    (usesFill && isFaint(fill)) ||
                    (usesStroke && isFaint(stroke)) ||
                    isFaint(color),
                box: boxFromPoints(pathPoints),
            };
            pathPoints = [];
        } else if (TEXT_SHOW.has(op.op)) {
            const origin = apply(textMatrix, 0, 0);
            const width = Math.max(18, fontSize * 4);
            op.paint = {
                faint: isFaint(fill) || isFaint(stroke),
                box: {
                    x: origin.x,
                    y: origin.y,
                    width,
                    height: Math.abs(fontSize),
                },
            };
        } else if (op.op === 'Do') {
            const box = boxFromPoints([apply(ctm, 0, 0), apply(ctm, 1, 1)]);
            const coversPlate =
                !!box &&
                box.width >= plate.width * 0.9 &&
                box.height >= plate.height * 0.9;
            op.paint = {
                faint:
                    !!box &&
                    !coversPlate &&
                    box.width >= plate.width * 0.22 &&
                    box.height >= plate.height * 0.22,
                box,
            };
        } else if (op.op === 'n' || op.op === 'W' || op.op === 'W*') {
            pathPoints = [];
        }
    }

    const drop = new Set<number>();

    for (const op of ops) {
        if (op.paint?.box && !intersects(op.paint.box, plate)) {
            drop.add(op.index);
        }
    }

    const runs: number[][] = [];
    let current: number[] = [];

    for (const op of ops) {
        if (op.paint?.faint) {
            current.push(op.index);
        } else if (op.paint && !op.paint.faint) {
            if (current.length > 0) {
                runs.push(current);
                current = [];
            }
        }
    }

    if (current.length > 0) {
        runs.push(current);
    }

    for (const run of runs) {
        const boxes = run
            .map((index) => ops[index]?.paint?.box)
            .filter(Boolean) as PdfBox[];
        const unified = unionBox(boxes);

        if (
            unified &&
            (isLargeForPlate(unified, plate) ||
                run.some((index) => {
                    const box = ops[index]?.paint?.box;

                    return box ? isLargeForPlate(box, plate) : false;
                }))
        ) {
            for (const index of run) {
                drop.add(index);
            }
        }
    }

    let output = '';
    let cursor = 0;

    for (const op of ops) {
        if (!drop.has(op.index)) {
            continue;
        }

        const from = op.pathStart ?? op.start;

        if (from > cursor) {
            output += source.slice(cursor, from);
        }

        cursor = op.end;
    }

    output += source.slice(cursor);

    return output;
}
