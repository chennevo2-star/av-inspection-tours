import { TourScreen } from "./tour-screen";

export default async function TourPage(props: { params: Promise<{ inspectionId: string }> }) {
  const params = await props.params;
  return <TourScreen inspectionId={params.inspectionId} />;
}
