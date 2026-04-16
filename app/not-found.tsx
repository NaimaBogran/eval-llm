import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-stone-100 p-8 text-center">
      <h1 className="text-lg font-semibold text-stone-900">Page not found</h1>
      <Link
        href="/"
        className="text-sm font-semibold text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-800"
      >
        Back home
      </Link>
    </div>
  );
}
