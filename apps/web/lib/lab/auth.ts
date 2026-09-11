import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/current-user";
import type { User } from "@pulse/shared";

/** Require a signed-in admin operator. Returns the user or a NextResponse error. */
export async function requireLabOperator(): Promise<User | NextResponse> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!user.is_admin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return user;
}

export function isErrorResponse(value: User | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}
