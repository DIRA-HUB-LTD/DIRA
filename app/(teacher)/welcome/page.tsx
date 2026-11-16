import { redirect } from "next/navigation";
import CalendarConnectCard from "@/components/onboarding/CalendarConnectCard";
import SchoolImportCard from "@/components/onboarding/SchoolImportCard";
import SkipSetup from "@/components/onboarding/SkipSetup";
import { getSignedInTeacher } from "@/lib/auth/teacher-session";
import { getPool } from "@/lib/db/client";
import { getConnectionStatus } from "@/lib/services/calendar-connection";

export const dynamic = "force-dynamic";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ calendar?: string }>;
}) {
  const teacher = await getSignedInTeacher();
  if (!teacher) redirect("/sign-in");

  const { calendar } = await searchParams;
  const firstName = teacher.display_name.split(" ")[0];
  const isSchool = teacher.workspace_kind === "school";

  const pool = getPool();
  const imported = isSchool
    ? (
        await pool.query<{ n: number }>(
          "SELECT COUNT(*)::int AS n FROM data_imports WHERE school_id = $1",
          [teacher.school_id],
        )
      ).rows[0].n > 0
    : false;
  const connection = isSchool ? null : await getConnectionStatus(teacher);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Welcome, {firstName}</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          {isSchool
            ? "One step to set up your school. You can also do this later."
            : "One step to set up your workspace. You can also do this later."}
        </p>
      </div>

      {isSchool ? (
        teacher.role === "admin" ? (
          <SchoolImportCard alreadyImported={imported} />
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Your school administrator uploads the school&apos;s data. You do not need to do anything
            here.
          </p>
        )
      ) : (
        <CalendarConnectCard
          configured={connection!.configured}
          status={connection!.status}
          justReturned={calendar === "connected" || calendar === "failed" ? calendar : null}
        />
      )}

      <div className="text-center">
        <SkipSetup />
      </div>
    </div>
  );
}
