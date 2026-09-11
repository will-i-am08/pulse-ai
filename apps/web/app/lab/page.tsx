import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/current-user";
import { LabClient } from "./LabClient";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const user = await currentUser();
  if (!user) redirect("/login?redirectTo=/lab");
  if (!user.is_admin) redirect("/app");

  return <LabClient />;
}
