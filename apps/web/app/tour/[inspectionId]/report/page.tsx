import { ReportScreen } from "./report-screen";

export default function ReportPage({ params }: { params: { inspectionId: string } }) {
  return <ReportScreen inspectionId={params.inspectionId} />;
}
