import { ProjectScreen } from "./project-screen";

export default function ProjectPage({ params }: { params: { id: string } }) {
  return <ProjectScreen projectId={params.id} />;
}
