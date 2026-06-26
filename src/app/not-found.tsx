import Link from "next/link";
import { Button } from "@/components/Button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-5 text-center">
      <h1 className="text-8xl font-black text-brand italic tracking-tighter mb-4">404</h1>
      <h2 className="text-3xl font-bold text-fg mb-4">Page not found</h2>
      <p className="text-muted max-w-md mx-auto mb-8">
        We couldn't find the page you were looking for. It might have been moved or doesn't exist.
      </p>
      <Button href="/" variant="brand" size="lg">
        Return Home
      </Button>
    </div>
  );
}
