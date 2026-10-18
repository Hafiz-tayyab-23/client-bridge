import { TempBanner } from "@/components/temp/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TempBanner />
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-10">{children}</main>
    </>
  );
}
