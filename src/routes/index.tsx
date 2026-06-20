import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import MediRouteDashboard from "@/components/MediRouteDashboard";

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
  return <MediRouteDashboard />;
}
