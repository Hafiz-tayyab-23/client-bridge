"use client";
import { Check, Clock, DoorOpen, TimerOff, Undo2, X } from "lucide-react";
import { Pill, type Tone } from "@/components/ui/primitives";

const PS: Record<string, [string, Tone, React.ReactNode]> = {
  paid: ["Paid", "green", <Check key="a" size={12} />], pending: ["Pending", "amber", <Clock key="b" size={12} />],
  failed: ["Failed", "red", <X key="c" size={12} />], expired: ["Expired", "gray", <TimerOff key="d" size={12} />],
  refunded: ["Refunded", "blue", <Undo2 key="e" size={12} />], partially_refunded: ["Partly refunded", "blue", <Undo2 key="f" size={12} />],
  abandoned: ["Abandoned", "pink", <DoorOpen key="g" size={12} />],
  cancelled: ["Cancelled", "pink", <DoorOpen key="h" size={12} />],
};
export function PayPill({ s }: { s: string }) {
  const [label, tone, icon] = PS[s] ?? [s, "gray" as Tone, null];
  return <Pill tone={tone} icon={icon}>{label}</Pill>;
}
