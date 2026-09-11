<?php

use Dotenv\Dotenv;
use Illuminate\Foundation\Application;
use Illuminate\Http\Request;
use Illuminate\Support\Env;

define('LARAVEL_START', microtime(true));

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Shared Apache mod_php workers serve Apps / Wunderbar / Colourwave.
// Sibling apps leave putenv() values behind; force this app's .env to win.
Dotenv::createMutable(dirname(__DIR__))->load();
Env::enablePutenv();

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

$app->handleRequest(Request::capture());
