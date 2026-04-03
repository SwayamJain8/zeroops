import AppShell from "@/components/AppShell";

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
