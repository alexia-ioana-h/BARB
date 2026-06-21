import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const KnowledgeGraph3D = lazy(() => import("@/components/KnowledgeGraph3D"));

export const Route = createFileRoute("/graph3d")({
  head: () => ({
    meta: [
      { title: "MediRoute — 3D Knowledge Graph" },
      {
        name: "description",
        content: "3D force-directed knowledge graph of the UK pharmaceutical supply chain.",
      },
    ],
  }),
  component: Graph3DPage,
});

function Graph3DPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted)
    return <div style={{ width: "100vw", height: "100vh", background: "#030712" }} />;
  return (
    <Suspense
      fallback={<div style={{ width: "100vw", height: "100vh", background: "#030712" }} />}
    >
      <KnowledgeGraph3D />
    </Suspense>
  );
}
