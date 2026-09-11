<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use RuntimeException;

class AppsOAuthClient
{
    /**
     * @return array{url: string, state: string}
     */
    public function authorizationRedirect(): array
    {
        $state = Str::random(40);

        $query = http_build_query([
            'client_id' => config('services.apps.client_id'),
            'redirect_uri' => config('services.apps.redirect'),
            'response_type' => 'code',
            'scope' => '',
            'state' => $state,
        ]);

        return [
            'url' => rtrim((string) config('services.apps.url'), '/').'/oauth/authorize?'.$query,
            'state' => $state,
        ];
    }

    /**
     * @return array{access_token: string, refresh_token?: string, token_type?: string, expires_in?: int}
     */
    public function exchangeCode(string $code): array
    {
        $response = $this->http()
            ->asForm()
            ->acceptJson()
            ->post(rtrim((string) config('services.apps.url'), '/').'/oauth/token', [
                'grant_type' => 'authorization_code',
                'client_id' => config('services.apps.client_id'),
                'client_secret' => config('services.apps.client_secret'),
                'redirect_uri' => config('services.apps.redirect'),
                'code' => $code,
            ]);

        if ($response->failed()) {
            throw new RuntimeException('Failed to exchange authorization code: '.$response->body());
        }

        /** @var array{access_token: string, refresh_token?: string, token_type?: string, expires_in?: int} $payload */
        $payload = $response->json();

        return $payload;
    }

    /**
     * @return array{id: int, name: string, email: string, email_verified_at: ?string, role: ?string}
     */
    public function fetchUser(string $accessToken): array
    {
        try {
            $response = $this->http()
                ->withToken($accessToken)
                ->acceptJson()
                ->get(rtrim((string) config('services.apps.url'), '/').'/api/user')
                ->throw();
        } catch (RequestException $exception) {
            throw new RuntimeException('Failed to fetch SSO user: '.$exception->getMessage(), 0, $exception);
        }

        /** @var array{id: int, name: string, email: string, email_verified_at: ?string, role: ?string} $user */
        $user = $response->json();

        return $user;
    }

    public function logoutUrl(): string
    {
        return rtrim((string) config('services.apps.url'), '/').'/sso/logout';
    }

    private function http(): PendingRequest
    {
        $request = Http::timeout(15);

        if (! config('services.apps.verify_ssl', true)) {
            $request = $request->withoutVerifying();
        }

        return $request;
    }
}
