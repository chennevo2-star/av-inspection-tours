import { ProjectScreen } from "./project-screen";

export default async function ProjectPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <ProjectScreen projectId={params.id} />;
}
