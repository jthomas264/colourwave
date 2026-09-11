<?php

use App\Http\Controllers\SsoController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    if (auth()->check()) {
        return redirect()->route('dashboard');
    }

    return redirect()->route('sso.redirect');
})->name('home');

Route::get('auth/redirect', [SsoController::class, 'redirect'])->name('sso.redirect');
Route::get('auth/callback', [SsoController::class, 'callback'])->name('sso.callback');
Route::post('auth/logout', [SsoController::class, 'logout'])->name('sso.logout');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::inertia('dashboard', 'dashboard')->name('dashboard');
});

require __DIR__.'/settings.php';
