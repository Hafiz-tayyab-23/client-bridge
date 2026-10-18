// Customer-facing return page after Stripe Checkout. Status is confirmed by webhook, not by this redirect.
export default async function PayDone({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const { cancelled } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
      <h1 className="mb-3 text-2xl font-semibold">{cancelled ? "Payment cancelled" : "Thank you"}</h1>
      <p>{cancelled ? "No payment was taken. You can reopen the payment link if you change your mind." : "Your payment was submitted to Stripe. You can close this page."}</p>
    </main>
  );
}
