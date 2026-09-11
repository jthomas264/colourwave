<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\AppsOAuthClient;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

class SsoController extends Controller
{
    /**
     * Redirect the user to the Apps identity provider.
     */
    public function redirect(Request $request, AppsOAuthClient $oauth): RedirectResponse
    {
        $authorization = $oauth->authorizationRedirect();

        $request->session()->put('apps_oauth_state', $authorization['state']);

        return redirect()->away($authorization['url']);
    }

    /**
     * Handle the OAuth callback from Apps.
     */
    public function callback(Request $request, AppsOAuthClient $oauth): RedirectResponse
    {
        $state = $request->session()->pull('apps_oauth_state');

        abort_unless(is_string($state) && hash_equals($state, (string) $request->string('state')), 403);

        $token = $oauth->exchangeCode((string) $request->string('code'));
        $ssoUser = $oauth->fetchUser($token['access_token']);

        $user = User::query()->updateOrCreate(
            ['sso_id' => $ssoUser['id']],
            [
                'name' => $ssoUser['name'],
                'email' => $ssoUser['email'],
                'email_verified_at' => $ssoUser['email_verified_at'] ?? now(),
                'password' => Str::password(32),
            ],
        );

        Auth::login($user, remember: true);
        $request->session()->regenerate();
        $request->session()->put('apps_access_token', $token['access_token']);

        return redirect()->intended(route('dashboard'));
    }

    /**
     * Log out of Colourwave and the Apps identity provider.
     */
    public function logout(Request $request, AppsOAuthClient $oauth): Response
    {
        Auth::guard('web')->logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return Inertia::location($oauth->logoutUrl());
    }
}
