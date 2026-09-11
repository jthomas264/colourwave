<?php

namespace App\Providers;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // CLI (joseph) and Apache (www-data) must not share compiled views:
        // BladeCompiler::touch($path, $mtime) requires file ownership.
        if (PHP_SAPI === 'cli' || PHP_SAPI === 'phpdbg') {
            $cliViews = storage_path('framework/views-cli');

            if (! is_dir($cliViews)) {
                mkdir($cliViews, 0775, true);
            }

            config(['view.compiled' => $cliViews]);
        }
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();

        // Keep request URL root in sync for HTTP; leave console unset so
        // wayfinder:generate emits path-prefixed relative URLs (/colourwave/...).
        if (! $this->app->runningInConsole() && ($root = config('app.url'))) {
            URL::forceRootUrl($root);
        }
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(12)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised()
            : null,
        );
    }
}
