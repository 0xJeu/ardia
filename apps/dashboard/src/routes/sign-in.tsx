import { createFileRoute } from "@tanstack/react-router";
import { SignInScreen } from "@/components/sign-in-screen";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" && search.next.startsWith("/") && !search.next.startsWith("//") ? search.next : undefined,
  }),
  component: SignInRoute,
});

function SignInRoute() {
  const { next } = Route.useSearch();
  return <SignInScreen next={next ?? "/"} />;
}
