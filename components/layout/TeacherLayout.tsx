import { redirect } from "next/navigation";
import { resolveTeacherContext } from "@/lib/auth/teacher-context";
import GuidedTour from "@/components/onboarding/GuidedTour";
import AppHeader from "./AppHeader";
import DesktopSidebar from "./DesktopSidebar";
import MobileBottomNav from "./MobileBottomNav";

export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  // Every page in here acts as a teacher: one who signed in, opened the demo, or (outside
  // production) the development fallback. Anyone else goes to the landing page.
  const context = await resolveTeacherContext();
  if (!context) redirect("/");

  return (
    <div className="flex h-dvh w-full gap-4 overflow-hidden bg-gray-50 p-4 dark:bg-gray-900">
      <DesktopSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg">
        <AppHeader />
        <main className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg p-4 pb-20 md:mt-0 md:p-6 md:pb-0">
          {children}
        </main>
        <MobileBottomNav />
      </div>
      <GuidedTour />
    </div>
  );
}
