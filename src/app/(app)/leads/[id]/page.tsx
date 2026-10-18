import { redirect } from "next/navigation";

// Notification links point here; the lead opens in the Leads screen side panel.
export default async function LeadRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/leads?id=${encodeURIComponent(id)}`);
}
