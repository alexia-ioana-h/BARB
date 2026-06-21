import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const MediRouteDashboard = lazy(() => import("@/components/MediRouteDashboard"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MediRoute — Supply Chain Climate Risk" },
      { name: "description", content: "Live UK pharmaceutical supply chain map with flood risk overlay." },
      { property: "og:title", content: "MediRoute — Supply Chain Climate Risk" },
      { property: "og:description", content: "Live UK pharmaceutical supply chain map with flood risk overlay." },
    ],
  }),
  component: Index,
});

function Index() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div style={{ width: "100vw", height: "100vh", background: "#0f1117" }} />;
  return (
    <Suspense fallback={<div style={{ width: "100vw", height: "100vh", background: "#0f1117" }} />}>
      <MediRouteDashboard />
    </Suspense>
  );
}
