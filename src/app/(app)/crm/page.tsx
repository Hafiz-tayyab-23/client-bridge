"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Building2, ContactRound, Kanban, SlidersHorizontal, Workflow } from "lucide-react";
import { Loading, PageHead } from "@/components/ui/primitives";
import { CompaniesTab, ContactsTab } from "@/components/crm/contacts-tab";
import { BoardTab } from "@/components/crm/board-tab";
import { FieldsTab, PipelinesTab } from "@/components/crm/config-tabs";

const TABS: [string, string, React.ReactNode][] = [
  ["contacts", "Contacts", <ContactRound key="c" size={16} />], ["companies", "Companies", <Building2 key="b" size={16} />],
  ["opps", "Opportunities", <Kanban key="k" size={16} />], ["pipes", "Pipelines", <Workflow key="w" size={16} />], ["fields", "Custom Fields", <SlidersHorizontal key="s" size={16} />],
];

function Crm() {
  const sp = useSearchParams();
  const router = useRouter();
  const tab = sp.get("tab") ?? "contacts";
  return (
    <>
      <PageHead title="CRM" sub="Contacts, companies and opportunities in one customizable record system." />
      <div className="tabs" role="tablist" aria-label="CRM sections">
        {TABS.map(([k, label, icon]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => router.replace(`/crm?tab=${k}`)}>{icon}{label}</button>)}
      </div>
      {tab === "contacts" && <ContactsTab initialQ={sp.get("q") ?? undefined} key={sp.get("q") ?? ""} />}
      {tab === "companies" && <CompaniesTab />}
      {tab === "opps" && <BoardTab />}
      {tab === "pipes" && <PipelinesTab />}
      {tab === "fields" && <FieldsTab />}
    </>
  );
}

export default function CrmPage() {
  return <Suspense fallback={<Loading />}><Crm /></Suspense>;
}
