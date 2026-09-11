<?php

use Tests\TestCase;

uses(TestCase::class);

test('the plate template uses the specified cutline and artwork sizes', function () {
    $svg = (string) file_get_contents(resource_path('plate/template.svg'));

    expect($svg)
        ->toContain('data-sheet-width-mm="560.004"')
        ->toContain('data-columns="4"')
        ->toContain('data-sticker-width-mm="137.001"')
        ->toContain('data-sticker-height-mm="63.301"')
        ->toContain('data-artwork-width-mm="134.001"')
        ->toContain('data-artwork-height-mm="60.547"')
        ->toContain('data-cutline-color="#FF00FF"')
        ->toContain('stroke="#FF00FF"');
});

test('quantity fills rows of at most four and leaves the final row short', function () {
    $columns = 4;

    $rows = function (int $quantity) use ($columns): array {
        $rows = [];
        $remaining = $quantity;

        while ($remaining > 0) {
            $count = min($columns, $remaining);
            $rows[] = $count;
            $remaining -= $count;
        }

        return $rows;
    };

    expect($rows(4))->toBe([4])
        ->and($rows(7))->toBe([4, 3])
        ->and($rows(10))->toBe([4, 4, 2])
        ->and($rows(11))->toBe([4, 4, 3])
        ->and($rows(12))->toBe([4, 4, 4]);
});

test('sheet width stays the same when the final row is short', function () {
    $svg = (string) file_get_contents(resource_path('plate/template.svg'));

    preg_match('/data-sheet-width-mm="([^"]+)"/', $svg, $width);
    preg_match('/data-sticker-width-mm="([^"]+)"/', $svg, $stickerWidth);
    preg_match('/data-sticker-height-mm="([^"]+)"/', $svg, $stickerHeight);
    preg_match('/data-gap-mm="([^"]+)"/', $svg, $gap);
    preg_match('/data-margin-mm="([^"]+)"/', $svg, $margin);

    $sheetWidth = (float) $width[1];
    $cellWidth = (float) $stickerWidth[1];
    $cellHeight = (float) $stickerHeight[1];
    $gapMm = (float) $gap[1];
    $marginMm = (float) $margin[1];

    $height = function (int $quantity) use ($cellHeight, $gapMm, $marginMm): float {
        $rows = max(1, (int) ceil($quantity / 4));

        return $marginMm * 2 + $rows * $cellHeight + max(0, $rows - 1) * $gapMm;
    };

    expect($sheetWidth)->toBe(560.004)
        ->and($cellWidth)->toBe(137.001)
        ->and($cellHeight)->toBe(63.301)
        ->and($sheetWidth)->toBe($marginMm * 2 + 4 * $cellWidth + 3 * $gapMm)
        ->and($height(3))->toBe($height(4))
        ->and($height(5))->toBeGreaterThan($height(4));
});
