import { TourScreen } from "./tour-screen";

export default function TourPage({ params }: { params: { inspectionId: string } }) {
  return <TourScreen inspectionId={params.inspectionId} />;
}
