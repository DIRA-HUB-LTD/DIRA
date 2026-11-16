import Image from "next/image";
import Link from "next/link";

/** Pages anyone can open: the landing page, sign-in and sign-up. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-dira-cream text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="border-b border-dira-teal/10 dark:border-gray-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/images/logo.png" alt="DIRA" width={40} height={40} />
            <span className="text-lg font-semibold text-dira-teal dark:text-dira-amber">DIRA Hub</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm font-medium">
            <Link href="/sign-in" className="text-dira-teal hover:underline dark:text-gray-200">
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-md bg-dira-teal px-3 py-2 text-white hover:bg-dira-teal-deep"
            >
              Open an account
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
      <footer className="border-t border-dira-teal/10 py-6 text-center text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
        DIRA Hub · Evidence for every learner&apos;s next step
      </footer>
    </div>
  );
}
