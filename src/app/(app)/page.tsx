"use client";
import { useMe } from "@/components/temp/app-shell";

export default function Home() {
  const me = useMe();
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">Welcome, {me.user.name}</h1>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt>Workspace</dt><dd>{me.workspace.name} <code className="text-xs">{me.workspace.id}</code></dd>
        <dt>Level</dt><dd>{me.user.baseRole}</dd>
        <dt>Permissions</dt><dd>{me.user.permissions.join(", ") || "none"}</dd>
        <dt>Public lead form</dt><dd><a className="underline" href={`/f/${me.workspace.id}`}>/f/{me.workspace.id}</a></dd>
      </dl>
      <p className="text-sm">Dashboard figures arrive with the approved design (F5).</p>
    </section>
  );
}
