import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, devPassEnabled, profileComplete } from "@/lib/auth";
import { LoginFlow } from "./LoginFlow";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign In · Plate Studio" };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

/** Only same-site paths, so ?next= can't send someone off to another site. */
const safeNext = (v: unknown) => (typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/login") ? v : "/");

/** Sign in with an emailed code, then (first time) tell us about you and your restaurant. */
export default async function LoginPage({ searchParams }: Props) {
  const next = safeNext((await searchParams).next);
  const user = await currentUser();
  if (profileComplete(user)) redirect(next);
  return <LoginFlow next={next} profile={user} devPass={devPassEnabled()} />;
}
