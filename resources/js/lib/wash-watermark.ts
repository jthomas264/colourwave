function luma(red: number, green: number, blue: number): number {
    return 0.299 * red + 0.587 * green + 0.114 * blue;
}

export function isDarkInk(red: number, green: number, blue: number): boolean {
    return luma(red, green, blue) < 72;
}

export function isWatermarkCandidate(
    red: number,
    green: number,
    blue: number,
): boolean {
    const value = luma(red, green, blue);
    const blueTint = blue - red;
    const cyanTint = Math.min(green, blue) - red;

    return (
        value >= 145 &&
        value <= 238 &&
        blue >= 140 &&
        (blueTint >= 8 || cyanTint >= 6)
    );
}

function dilateMask(
    mask: Uint8Array,
    width: number,
    height: number,
    candidates: Uint8Array,
): Uint8Array {
    const dilated = mask.slice();

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;

            if (mask[index] !== 1) {
                continue;
            }

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;

                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
                        continue;
                    }

                    const neighbor = ny * width + nx;

                    if (candidates[neighbor] === 1) {
                        dilated[neighbor] = 1;
                    }
                }
            }
        }
    }

    return dilated;
}

export function stripLargeWatermark(image: ImageData): ImageData {
    const { data, width, height } = image;
    const count = width * height;
    const candidates = new Uint8Array(count);

    for (let index = 0; index < count; index++) {
        const offset = index * 4;

        if (
            isWatermarkCandidate(
                data[offset] ?? 255,
                data[offset + 1] ?? 255,
                data[offset + 2] ?? 255,
            )
        ) {
            candidates[index] = 1;
        }
    }

    const seen = new Uint8Array(count);
    const remove = new Uint8Array(count);
    const minWidth = Math.max(24, Math.round(width * 0.2));
    const minHeight = Math.max(24, Math.round(height * 0.32));
    const minPixels = Math.max(400, Math.round(count * 0.02));

    for (let start = 0; start < count; start++) {
        if (candidates[start] !== 1 || seen[start] === 1) {
            continue;
        }

        const stack = [start];
        const cells: number[] = [];
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;

        seen[start] = 1;

        while (stack.length > 0) {
            const index = stack.pop() ?? 0;
            const x = index % width;
            const y = Math.floor(index / width);

            cells.push(index);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);

            const neighbors = [
                index - 1,
                index + 1,
                index - width,
                index + width,
            ];

            for (const neighbor of neighbors) {
                if (
                    neighbor < 0 ||
                    neighbor >= count ||
                    seen[neighbor] === 1 ||
                    candidates[neighbor] !== 1
                ) {
                    continue;
                }

                const nx = neighbor % width;
                const ny = Math.floor(neighbor / width);

                if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) {
                    continue;
                }

                seen[neighbor] = 1;
                stack.push(neighbor);
            }
        }

        const boxWidth = maxX - minX + 1;
        const boxHeight = maxY - minY + 1;

        if (
            boxWidth >= minWidth ||
            boxHeight >= minHeight ||
            cells.length >= minPixels
        ) {
            for (const index of cells) {
                remove[index] = 1;
            }
        }
    }

    const erased = dilateMask(remove, width, height, candidates);
    const cleaned = new ImageData(width, height);
    const output = cleaned.data;

    for (let index = 0; index < count; index++) {
        const offset = index * 4;

        if (erased[index] === 1) {
            output[offset] = 255;
            output[offset + 1] = 255;
            output[offset + 2] = 255;
            output[offset + 3] = 255;
            continue;
        }

        output[offset] = data[offset] ?? 255;
        output[offset + 1] = data[offset + 1] ?? 255;
        output[offset + 2] = data[offset + 2] ?? 255;
        output[offset + 3] = 255;
    }

    return cleaned;
}
