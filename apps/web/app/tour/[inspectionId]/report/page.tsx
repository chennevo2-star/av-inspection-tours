import { ReportScreen } from "./report-screen";

export default async function ReportPage(props: { params: Promise<{ inspectionId: string }> }) {
  const params = await props.params;
  return <ReportScreen inspectionId={params.inspectionId} />;
}
