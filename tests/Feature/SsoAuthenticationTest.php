<?php

use App\Models\User;
use Illuminate\Support\Facades\Http;

test('guests are redirected to sso from the dashboard', function () {
    $this->get(route('dashboard'))
        ->assertRedirect(route('sso.redirect'));
});

test('authenticated users can visit the colourwave dashboard', function () {
    $user = User::factory()->create([
        'email_verified_at' => now(),
    ]);

    $this->actingAs($user)
        ->get(route('dashboard'))
        ->assertOk();
});

test('sso callback creates a local user from apps', function () {
    config([
        'services.apps.url' => 'https://apps.test',
        'services.apps.client_id' => 'client-id',
        'services.apps.client_secret' => 'secret',
        'services.apps.redirect' => 'https://colourwave.test/auth/callback',
    ]);

    Http::fake([
        'apps.test/oauth/token' => Http::response([
            'access_token' => 'access-token',
            'token_type' => 'Bearer',
            'expires_in' => 3600,
        ]),
        'apps.test/api/user' => Http::response([
            'id' => 42,
            'name' => 'Colourwave User',
            'email' => 'colour@example.test',
            'email_verified_at' => now()->toIso8601String(),
            'role' => null,
        ]),
    ]);

    $state = 'cw-state';

    $this->withSession(['apps_oauth_state' => $state])
        ->get(route('sso.callback', [
            'code' => 'auth-code',
            'state' => $state,
        ]))
        ->assertRedirect(route('dashboard'));

    $user = User::query()->where('sso_id', 42)->first();

    expect($user)->not->toBeNull()
        ->and($user->email)->toBe('colour@example.test');

    $this->assertAuthenticatedAs($user);
});
