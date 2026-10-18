"use client";
import { CircleCheck, CircleDot, CircleSlash, Plane } from "lucide-react";
import { availLabel } from "@/lib/format";
import { Pill, type Tone } from "@/components/ui/primitives";

const AV: Record<string, [Tone, React.ReactNode]> = {
  available: ["green", <CircleCheck key="a" size={12} />], busy: ["blue", <CircleDot key="b" size={12} />],
  on_leave: ["amber", <Plane key="c" size={12} />], offline: ["gray", <CircleSlash key="d" size={12} />],
};
export const AvailPill = ({ v }: { v: string }) => <Pill tone={AV[v]?.[0] ?? "gray"} icon={AV[v]?.[1]}>{availLabel(v)}</Pill>;
