import { Head } from '@inertiajs/react';
import { Spinner } from '@/components/ui/spinner';
import { redirect as ssoRedirect } from '@/routes/sso';

export default function Login() {
    if (typeof window !== 'undefined') {
        window.location.href = ssoRedirect.url();
    }

    return (
        <>
            <Head title="Log in" />
            <div className="flex flex-col items-center gap-4 py-8">
                <Spinner />
                <p className="text-sm text-muted-foreground">
                    Redirecting to Apps sign-in…
                </p>
            </div>
        </>
    );
}
