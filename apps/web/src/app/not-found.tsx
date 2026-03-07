import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="space-y-4 text-center">
        <p className="text-sm font-mono text-muted-foreground">404</p>
        <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          The resource you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="inline-block text-sm text-primary hover:text-primary/80 transition-colors"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
